// The device-local activity cache.
//
// This is NOT an on-chain facet registry and it is not authoritative for balances or existence. It
// records what this browser did, per (wallet, app), so the launcher can preserve history between
// visits. It stores app metadata, Mainnet transaction hashes, asset kinds and the latest public
// chain observation — never signatures, private keys, viewing keys, commitments or recovery
// secrets. The launcher must reconcile chain observations separately and label stale local data.
//
// The five states and their legal transitions mirror packages/sdk/src/facets.ts exactly;
// tests/facet-map.test.mjs pins them to each other.

export const TRANSITIONS = {
  launch: ["use", "retire"],
  use: ["hold", "recover"],
  hold: ["use", "recover"],
  recover: ["hold", "retire"],
  retire: [],
};

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

/** Classify browser-held positions with the same recovery boundary as the SDK. */
export function recoveryPlan(positions = []) {
  return {
    automatic: positions.filter((position) => position.kind === "fungible"),
    exitRequired: positions.filter((position) => position.kind !== "fungible"),
  };
}

export function recoveryBlockedReason(record) {
  if (!record) return null;
  const exitRequired = recoveryPlan(record.positions).exitRequired;
  if (!exitRequired.length) return null;
  const held = exitRequired.map((position) => position.symbol ?? position.asset).join(", ");
  return `Holding ${held}. Exit the position before recovering this facet.`;
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

export function move(account, appId, to) {
  const records = readMap();
  const key = mapKey(account, appId);
  const current = records[key];
  if (!current) return null;
  if (!canMove(current.state, to)) {
    throw new Error(`Invalid facet lifecycle transition: ${current.state} → ${to}.`);
  }
  if (to === "recover") {
    const blocked = recoveryBlockedReason(current);
    if (blocked) throw new Error(blocked);
  }
  if (to === "retire") {
    const blocked = retireBlockedReason(current);
    if (blocked) throw new Error(blocked);
  }
  records[key] = { ...current, state: to, updatedAt: new Date().toISOString() };
  writeMap(records);
  return records[key];
}

/** Enter local recovery after the chain-side exit has settled or no persistent position exists. */
export function beginRecovery(account, appId) {
  const records = readMap();
  const current = records[mapKey(account, appId)];
  if (!current) return null;
  const blocked = recoveryBlockedReason(current);
  if (blocked) throw new Error(blocked);
  return move(account, appId, "recover");
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

/** A facet still holding a persistent position must be exited, not retired. */
export function retireBlockedReason(record) {
  if (!record) return null;
  const exitRequired = recoveryPlan(record.positions).exitRequired;
  if (exitRequired.length) {
    const held = exitRequired.map((position) => position.symbol ?? position.asset).join(", ");
    return `Holding ${held}. Exit the position before retiring this facet.`;
  }
  if (!canMove(record.state, "retire")) {
    return `A facet in "${record.state}" cannot be retired directly.`;
  }
  return null;
}
