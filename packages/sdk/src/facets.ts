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

/**
 * A `FacetStore` that keeps records for the life of the process.
 *
 * Useful for tests and for a server-side caller that persists elsewhere; the browser wants
 * {@link createStorageFacetStore}.
 */
export function createMemoryFacetStore(seed: readonly FacetRecord[] = []): FacetStore & {
  all(): FacetRecord[];
  delete(key: string): void;
} {
  const records = new Map<string, FacetRecord>(seed.map((record) => [record.key, record]));
  return {
    get: (key) => records.get(key) ?? null,
    set: (record) => { records.set(record.key, record); },
    all: () => [...records.values()],
    delete: (key) => { records.delete(key); },
  };
}

/** The `getItem`/`setItem` pair this store needs; `localStorage` and `sessionStorage` satisfy it. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * A `FacetStore` backed by a browser storage area, so a facet outlives the tab that created it.
 *
 * This is what makes a facet more than session metadata: the same wallet returning to the same
 * app resolves the same record, and therefore the same app-scoped identity, rather than starting
 * over. Storage is device-local and is *not* authoritative for balances or for a facet's
 * existence on chain — the launcher reconciles those from chain reads and labels stale data.
 *
 * Writes are defensive on purpose. Private-browsing modes throw on `setItem`, and a facet record
 * is a convenience cache: losing it must degrade the launcher, never break it.
 */
export function createStorageFacetStore(
  storage: KeyValueStorage,
  namespace = "facet-records-v1",
): FacetStore & { all(): FacetRecord[]; delete(key: string): void } {
  const readAll = (): Record<string, FacetRecord> => {
    try {
      const raw = storage.getItem(namespace);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed as Record<string, FacetRecord> : {};
    } catch {
      return {};
    }
  };
  const writeAll = (records: Record<string, FacetRecord>) => {
    try { storage.setItem(namespace, JSON.stringify(records)); }
    catch { /* private mode, or the quota is full: the record is a cache, not the truth */ }
  };
  return {
    get: (key) => readAll()[key] ?? null,
    set: (record) => {
      const records = readAll();
      records[record.key] = record;
      writeAll(records);
    },
    all: () => Object.values(readAll()),
    delete: (key) => {
      const records = readAll();
      delete records[key];
      writeAll(records);
    },
  };
}

/** Every non-retired facet a store holds for one wallet, newest activity first. */
export function listFacets(
  store: FacetStore & { all(): FacetRecord[] },
  wallet?: string,
): FacetRecord[] {
  const wanted = wallet?.trim().toLowerCase();
  return store.all()
    .filter((record) => (wanted ? record.wallet.trim().toLowerCase() === wanted : true))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
