// The device-local activity record.
//
// This is NOT an on-chain facet registry. It records what this browser did, per (wallet, app), so
// the launcher can show a portfolio instead of a list of buttons. It stores app metadata,
// Mainnet transaction hashes and the asset kinds a route settled — never signatures, private
// keys, viewing keys or recovery secrets. Until Facet controls on-chain identities, every surface
// that renders this must call it a local activity record.
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

/** Creates the record on first use, or revives a retired one as a new version. */
export function retain(account, appId) {
  const records = readMap();
  const key = mapKey(account, appId);
  const current = records[key];
  if (!current || current.state === "retire") {
    const now = new Date().toISOString();
    records[key] = {
      app: appId, strategy: "default", version: (current?.version ?? 0) + 1,
      state: "launch", positions: [], transactions: [], createdAt: now, updatedAt: now,
    };
    writeMap(records);
  }
  return records[key];
}

export function move(account, appId, to) {
  const records = readMap();
  const key = mapKey(account, appId);
  const current = records[key];
  if (!current) return null;
  if (!canMove(current.state, to)) {
    throw new Error(`Invalid facet lifecycle transition: ${current.state} → ${to}.`);
  }
  records[key] = { ...current, state: to, updatedAt: new Date().toISOString() };
  writeMap(records);
  return records[key];
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
  const want = action === "exit" ? "recover" : (kind === "exit-required" ? "hold" : "use");
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
  if (record.positions.length) {
    const held = record.positions.map((position) => position.symbol ?? position.asset).join(", ");
    return `Holding ${held}. Exit the position before retiring this facet.`;
  }
  if (!canMove(record.state, "retire")) {
    return `A facet in "${record.state}" cannot be retired directly.`;
  }
  return null;
}
