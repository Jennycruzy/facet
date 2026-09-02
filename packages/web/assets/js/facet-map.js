// The device-local activity cache.
//
// This is NOT an on-chain facet registry and it is not authoritative for balances or existence. It
// records what this browser did, per (wallet, app), so the launcher can preserve history between
// visits. It stores app metadata, Mainnet transaction hashes, asset kinds and the latest public
// chain observation — never signatures, private keys, viewing keys, commitments or recovery
// secrets. The launcher must reconcile chain observations separately and label stale local data.
//
// The SDK owns the lifecycle; this module owns storage and the wording the launcher shows. The
// state table and the recovery classification are imported from the deployed bundle rather than
// mirrored here, so the two cannot drift — there is only one implementation to keep correct.

import {
  exitRoutesFromApps,
  FACET_TRANSITIONS,
  planFacetRecovery,
  RECOVERY_REQUIRES_ADAPTER,
  recoveryPlan as sdkRecoveryPlan,
} from "./facet-sdk.js";

/** The SDK's own table, re-exported rather than copied. */
export const TRANSITIONS = FACET_TRANSITIONS;

export { RECOVERY_REQUIRES_ADAPTER, exitRoutesFromApps };

const KEY = "facet-wallet-map-v1";

export const ACTIVITY_CACHE_VERSION = 1;

export function readMap() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; }
}

function writeMap(records) {
  try { localStorage.setItem(KEY, JSON.stringify(records)); } catch { /* private mode */ }
}

export const mapKey = (account, appId, strategy = "default") =>
  [account ?? "", appId, strategy].map((part) => String(part).toLowerCase()).join(":");

function assetKey(value) {
  const lowered = String(value).toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(lowered)) return lowered;
  return `0x${lowered.slice(2).replace(/^0+/, "") || "0"}`;
}

export function canMove(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to));
}

/** Classify browser-held positions with the SDK's recovery boundary — not a second copy of it. */
export function recoveryPlan(positions = []) {
  return sdkRecoveryPlan(positions ?? []);
}

/**
 * The deployed exit catalogue, configured once by whichever page loaded data/facets.json.
 *
 * Routing has to know the real routes to be useful, but the lifecycle helpers are called from UI
 * paths that never see the catalogue. Configuring it once here keeps those call sites unchanged
 * and keeps a single source of routes for the whole page.
 */
let configuredRoutes = [];

export function configureExitRoutes(apps = []) {
  configuredRoutes = exitRoutesFromApps(apps);
  return configuredRoutes;
}

const routesFor = (apps) => (apps?.length ? exitRoutesFromApps(apps) : configuredRoutes);

/**
 * Resolve what this facet would actually have to do to be recovered.
 *
 * The result names the exit route for each position that has one and flags anything Facet cannot
 * close as RECOVERY_REQUIRES_ADAPTER, so the launcher can offer the next step instead of only
 * refusing.
 */
export function recoveryRouting(record, apps = []) {
  if (!record) return null;
  return planFacetRecovery(record.app, record.positions ?? [], routesFor(apps));
}

/**
 * The user-facing sentence for why recovery is blocked, including where to go next.
 *
 * When no catalogue has been configured we say only that an exit is required. Not knowing the
 * routes is not evidence that none exists, and claiming a position is unrecoverable is a much
 * stronger statement than the caller has earned.
 */
export function recoveryBlockedReason(record, apps = []) {
  if (!record) return null;
  const routing = recoveryRouting(record, apps);
  if (!routing || routing.ready) return null;
  const known = routesFor(apps).length > 0;
  const name = (step) => step.position.symbol ?? step.position.asset;
  if (known && routing.unsupported.length) {
    return `Holding ${routing.unsupported.map(name).join(", ")}, which no configured route can ` +
      `close. Recovering it needs a new adapter (${RECOVERY_REQUIRES_ADAPTER}).`;
  }
  const held = [...routing.viaExit, ...routing.unsupported].map(name);
  const route = routing.viaExit[0]?.route;
  const via = known && route ? ` Use the ${route.appId} route.` : "";
  return `Holding ${held.join(", ")}. Exit the position before recovering this facet.${via}`;
}

/** A facet still holding a persistent position must be exited, not retired. */
export function retireBlockedReason(record, apps = []) {
  if (!record) return null;
  const routing = recoveryRouting(record, apps);
  if (routing && !routing.ready) {
    const held = [...routing.viaExit, ...routing.unsupported]
      .map((step) => step.position.symbol ?? step.position.asset);
    return `Holding ${held.join(", ")}. Exit the position before retiring this facet.`;
  }
  if (!canMove(record.state, "retire")) {
    return `A facet in "${record.state}" cannot be retired directly.`;
  }
  return null;
}

/** Creates the record on first use, or revives a retired one as a new version. */
export function retain(account, appId) {
  const records = readMap();
  const key = mapKey(account, appId);
  const current = records[key];
  if (!current || current.state === "retire") {
    const now = new Date().toISOString();
    records[key] = {
      app: appId, strategy: "default", wallet: account ?? null, version: (current?.version ?? 0) + 1,
      state: "launch", positions: [], transactions: [], createdAt: now, updatedAt: now,
    };
    writeMap(records);
  }
  return records[key];
}

/**
 * Cache a read-only chain observation without making the local record the source of truth.
 *
 * The observation is deliberately replaceable and timestamped. A refresh may prove that an
 * account is undeployed, empty, or unavailable; callers should render the returned chain object
 * first and use this cache only when the chain is unreachable later.
 */
export function reconcile(account, appId, observation) {
  if (!observation || typeof observation !== "object") {
    throw new TypeError("A chain observation is required.");
  }
  const records = readMap();
  const key = mapKey(account, appId);
  const current = records[key] ?? retain(account, appId);
  const fresh = readMap();
  const observedAt = observation.observedAt ?? new Date().toISOString();
  fresh[key] = {
    ...current,
    wallet: current.wallet ?? account ?? null,
    chain: {
      address: observation.address,
      isDeployed: Boolean(observation.isDeployed),
      balances: { ...(observation.balances ?? {}) },
      positions: Array.isArray(observation.positions)
        ? observation.positions.map((position) => ({
          ...position,
          amount: typeof position.amount === "bigint" ? position.amount.toString() : position.amount,
        }))
        : [],
      observedAt,
    },
    updatedAt: new Date().toISOString(),
  };
  writeMap(fresh);
  return fresh[key];
}

export function move(account, appId, to, apps = []) {
  const records = readMap();
  const key = mapKey(account, appId);
  const current = records[key];
  if (!current) return null;
  if (!canMove(current.state, to)) {
    throw new Error(`Invalid facet lifecycle transition: ${current.state} → ${to}.`);
  }
  if (to === "recover") {
    const blocked = recoveryBlockedReason(current, apps);
    if (blocked) throw new Error(blocked);
  }
  if (to === "retire") {
    const blocked = retireBlockedReason(current, apps);
    if (blocked) throw new Error(blocked);
  }
  records[key] = { ...current, state: to, updatedAt: new Date().toISOString() };
  writeMap(records);
  return records[key];
}

/** Enter local recovery after the chain-side exit has settled or no persistent position exists. */
export function beginRecovery(account, appId, apps = []) {
  const records = readMap();
  const current = records[mapKey(account, appId)];
  if (!current) return null;
  const blocked = recoveryBlockedReason(current, apps);
  if (blocked) throw new Error(blocked);
  return move(account, appId, "recover", apps);
}

/**
 * Records a confirmed Mainnet action against a facet and advances its lifecycle.
 *
 * A route that settles a fungible asset leaves the facet in `use`. A route that settles a
 * persistent position (vault shares, LP, debt, an NFT) leaves it in `hold`, because something is
 * now owned that no automatic sweep can recover — see docs/FINDINGS.md 6.34. An exit route moves
 * it to `recover`.
 */
export function recordActivity(account, appId, {
  hash, asset, symbol, kind, action, removeAssets = [],
}) {
  const records = readMap();
  const key = mapKey(account, appId);
  if (!records[key]) retain(account, appId);
  const fresh = readMap();
  const current = fresh[key];
  const removed = new Set(removeAssets.map(assetKey));
  // Re-settling the same asset replaces its position entry; explicit exits may close a different
  // input asset while receiving an ordinary fungible output asset.
  removed.add(assetKey(asset));
  const positions = current.positions.filter((position) =>
    !removed.has(assetKey(position.asset)));
  if (kind === "exit-required") positions.push({ asset, symbol, kind });
  const transactions = [...current.transactions, { hash, action, at: new Date().toISOString() }];

  let state = current.state;
  // Only call an exit recovered when it closed every persistent position. A partial exit remains
  // visible in hold, so the next protocol action is still explicit rather than silently terminal.
  const exitRequired = recoveryPlan(positions).exitRequired;
  const want = action === "exit"
    ? (exitRequired.length ? "hold" : "recover")
    : (kind === "exit-required" ? "hold" : "use");
  // launch → hold is not a legal edge; step through `use`, which is what actually happened.
  const path = state === "launch" && want === "hold" ? ["use", "hold"]
    : state === "launch" && want === "recover" ? ["use", "recover"]
    : [want];
  for (const next of path) {
    if (next !== state && canMove(state, next)) state = next;
  }

  fresh[key] = { ...current, state, positions, transactions, updatedAt: new Date().toISOString() };
  writeMap(fresh);
  return fresh[key];
}
