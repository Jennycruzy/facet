import type { AdapterPlan } from "./adapters.js";

export type FacetState = "launch" | "use" | "hold" | "recover" | "retire";
export type AssetKind = "fungible" | "xstrk" | "lp" | "debt" | "nft" | "receipt";

export const FACET_STATES = ["launch", "use", "hold", "recover", "retire"] as const;

export const FACET_TRANSITIONS: {
  readonly [State in FacetState]: readonly FacetState[];
} = {
  launch: ["use", "retire"],
  use: ["hold", "recover"],
  hold: ["use", "recover"],
  recover: ["hold", "retire"],
  retire: [],
};

export interface FacetPosition {
  asset: string;
  kind: AssetKind;
  amount?: string;
}

export interface FacetRecord {
  key: string;
  wallet: string;
  app: string;
  strategy: string;
  address: string;
  state: FacetState;
  createdAt: string;
  updatedAt: string;
  recovery: { encryptedMetadata: string; positions: FacetPosition[] };
}

export interface FacetStore {
  get(key: string): FacetRecord | null;
  set(record: FacetRecord): void;
}

export interface FacetExecutor {
  execute(plan: AdapterPlan): Promise<{ transactionHash: string }>;
}

export class FacetLifecycleError extends Error {
  readonly code = "facet_lifecycle" as const;

  constructor(message: string) {
    super(message);
    this.name = "FacetLifecycleError";
  }
}

export const facetKey = (wallet: string, app: string, strategy = "default") =>
  [wallet, app, strategy].map((part) => part.trim().toLowerCase()).join(":");

export function createOrRetainFacet(store: FacetStore, input: Omit<FacetRecord,
  "key" | "state" | "createdAt" | "updatedAt">): FacetRecord {
  const key = facetKey(input.wallet, input.app, input.strategy);
  const current = store.get(key);
  if (current && current.state !== "retire") return current;
  const now = new Date().toISOString();
  const record = { ...input, key, state: "launch" as const, createdAt: now, updatedAt: now };
  store.set(record);
  return record;
}

export function moveFacet(store: FacetStore, facet: FacetRecord, state: FacetState): FacetRecord {
  const allowed = FACET_TRANSITIONS[facet.state];
  if (!allowed?.includes(state)) {
    throw new FacetLifecycleError(`Invalid facet lifecycle transition: ${facet.state} → ${state}.`);
  }

  const positions = facet.recovery.positions;
  if (state === "recover") {
    const exitRequired = recoveryPlan(positions).exitRequired;
    if (exitRequired.length) {
      const held = exitRequired.map((position) => position.asset).join(", ");
      throw new FacetLifecycleError(
        `Cannot recover facet ${facet.key}: exit ${held} through its protocol before recovery.`,
      );
    }
  }
  const exitRequired = recoveryPlan(positions).exitRequired;
  if (state === "retire" && exitRequired.length) {
    const held = exitRequired.map((position) => position.asset).join(", ");
    throw new FacetLifecycleError(`Cannot retire facet ${facet.key}: recover ${held} first.`);
  }
  const next = { ...facet, state, updatedAt: new Date().toISOString() };
  store.set(next);
  return next;
}

export interface FacetRecoveryPlan {
  automatic: FacetPosition[];
  exitRequired: FacetPosition[];
}

export function recoveryPlan(positions: readonly FacetPosition[]): FacetRecoveryPlan {
  return {
    automatic: positions.filter((position) => position.kind === "fungible"),
    exitRequired: positions.filter((position) => position.kind !== "fungible"),
  };
}

/** Begin recovery only when no persistent application position still needs an explicit exit. */
export function beginFacetRecovery(store: FacetStore, facet: FacetRecord): FacetRecord {
  return moveFacet(store, facet, "recover");
}

/** Retire a recovered or unused facet while preserving the position guard in one public API. */
export function retireFacet(store: FacetStore, facet: FacetRecord): FacetRecord {
  return moveFacet(store, facet, "retire");
}

/** The complete dapp-facing flow: app intent is adapted, then Facet executes the resulting plan. */
export async function executeAppIntent<TIntent extends import("./adapters.js").AppIntent>(options: {
  adapter: import("./adapters.js").ProtocolAdapter<TIntent>;
  intent: TIntent;
  context: import("./adapters.js").AdapterContext;
  executor: FacetExecutor;
}) {
  return options.executor.execute(options.adapter.plan(options.intent, options.context));
}
