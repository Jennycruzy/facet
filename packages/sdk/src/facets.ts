import type { AdapterPlan } from "./adapters.js";

export type FacetState = "launch" | "use" | "hold" | "recover" | "retire";
export type AssetKind = "fungible" | "xstrk" | "lp" | "debt" | "nft" | "receipt";

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

const transitions: Record<FacetState, readonly FacetState[]> = {
  launch: ["use", "retire"], use: ["hold", "recover"], hold: ["use", "recover"],
  recover: ["hold", "retire"], retire: [],
};

export function moveFacet(store: FacetStore, facet: FacetRecord, state: FacetState): FacetRecord {
  if (!transitions[facet.state].includes(state)) {
    throw new Error(`Invalid facet lifecycle transition: ${facet.state} → ${state}.`);
  }
  const next = { ...facet, state, updatedAt: new Date().toISOString() };
  store.set(next);
  return next;
}

export function recoveryPlan(positions: readonly FacetPosition[]) {
  return {
    automatic: positions.filter((position) => position.kind === "fungible"),
    exitRequired: positions.filter((position) => position.kind !== "fungible"),
  };
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
