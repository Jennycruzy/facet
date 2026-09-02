// The session activity context.
//
// This is NOT an on-chain facet registry, an authentication mechanism, or an authoritative source
// for balances or existence. It records what this browser did, per (wallet, app), so the launcher
// can label activity during the current tab session. It may contain a wallet-to-application
// association while the tab is open, so sessionStorage is a bounded persistence decision, not
// cryptographic protection against the live page, an extension, injected script, or browser session
// restoration. It must never be moved to persistent plaintext storage.
//
// The optional shadow-account read can rediscover a public address, but the current Mainnet
// wallet-mediated Endur path does not prove the private app association or lifecycle. A chain
// observation may corroborate a session record and may block a dangerous action; it may never
// create an empty lifecycle record or enable recovery/retirement by itself.
//
// The SDK owns the lifecycle; this module owns storage and launcher wording. The state table and
// recovery classification are imported from the deployed bundle rather than mirrored here, so the
// two cannot drift — there is only one implementation to keep correct.

import {
  exitRoutesFromApps,
  FACET_TRANSITIONS,
  planFacetRecovery,
  RECOVERY_REQUIRES_ADAPTER,
  RECOVERY_PASSPHRASE_MIN_LENGTH,
  recoveryPlan as sdkRecoveryPlan,
  saveUnlockedPassphraseSealedFacets,
  unlockPassphraseSealedFacets,
  SEALED_FACETS_KEY,
} from "./facet-sdk.js";

/** The SDK's own table, re-exported rather than copied. */
export const TRANSITIONS = FACET_TRANSITIONS;

export { RECOVERY_REQUIRES_ADAPTER, exitRoutesFromApps };

const KEY = "facet-activity-session-v2";
const LEGACY_KEY = "facet-wallet-map-v1";

export const ACTIVITY_CACHE_VERSION = 2;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCachedPosition(value) {
  return isPlainObject(value)
    && typeof value.asset === "string"
    && typeof value.kind === "string";
}

function isCachedTransaction(value) {
  return isPlainObject(value)
    && typeof value.hash === "string"
    && typeof value.action === "string"
    && (value.asset == null || typeof value.asset === "string")
    && (value.symbol == null || typeof value.symbol === "string")
    && (value.kind == null || typeof value.kind === "string")
    && (value.removeAssets == null
      || (Array.isArray(value.removeAssets) && value.removeAssets.every((asset) => typeof asset === "string")));
}

function isCachedObservation(value) {
  return isPlainObject(value)
    && (!Object.prototype.hasOwnProperty.call(value, "positions")
      || (Array.isArray(value.positions) && value.positions.every(isPlainObject)));
}

function isCachedRecord(value) {
  return isPlainObject(value)
    && (typeof value.wallet === "string" || value.wallet === null)
    && typeof value.app === "string"
    && typeof value.strategy === "string"
    && typeof value.state === "string"
    && Object.prototype.hasOwnProperty.call(TRANSITIONS, value.state)
    && Array.isArray(value.positions)
    && value.positions.every(isCachedPosition)
    && Array.isArray(value.transactions)
    && value.transactions.every(isCachedTransaction)
    && (value.chain == null || isCachedObservation(value.chain));
}

export function readMap() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
    if (!isPlainObject(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, record]) => isCachedRecord(record)));
  } catch { return {}; }
}

function writeMap(records) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

function writeRecordMap(records, recordKey) {
  if (!writeMap(records)) {
    throw new Error("This tab cannot retain lifecycle state safely; the route was not opened.");
  }
  const written = readMap()[recordKey];
  if (!written) {
    throw new Error("This tab cannot retain lifecycle state safely; the route was not opened.");
  }
  return written;
}

/**
 * The only persistent browser value Facet may use for recovery is this opaque envelope. The
 * storage object deliberately has no wallet/app-derived key: those fields are inside ciphertext.
 */
const sealedStorage = {
  getItem(namespace) {
    const storage = globalThis.localStorage;
    if (!storage) throw new Error("Persistent browser storage is unavailable.");
    return storage.getItem(namespace);
  },
  setItem(namespace, value) {
    const storage = globalThis.localStorage;
    if (!storage) throw new Error("Persistent browser storage is unavailable.");
    storage.setItem(namespace, value);
  },
};

const persistentNamespace = SEALED_FACETS_KEY;

function withoutRuntimeFields(record) {
  const { chain: _chain, authority: _authority, ...persistent } = record;
  return persistent;
}

function sameIdentity(left, right) {
  return assetKey(left) === assetKey(right);
}

function recordsForAccount(records, account) {
  return Object.values(records).filter((record) =>
    typeof record.wallet === "string" && sameIdentity(record.wallet, account));
}

function validatePersistentRecords(records) {
  if (!Array.isArray(records)) throw new TypeError("Malformed sealed facet record set.");
  const byKey = Object.create(null);
  for (const record of records) {
    if (!isCachedRecord(record) || typeof record.wallet !== "string") {
      throw new TypeError("Malformed sealed facet activity record.");
    }
    const key = mapKey(assetKey(record.wallet), record.app, record.strategy);
    if (byKey[key]) throw new TypeError("Duplicate sealed facet activity record.");
    byKey[key] = withoutRuntimeFields(record);
  }
  return byKey;
}

function activityHash(transaction) {
  return String(transaction?.hash ?? "").toLowerCase();
}

function addPosition(positions, position) {
  if (!position || typeof position.asset !== "string" || typeof position.kind !== "string") return positions;
  const next = positions.filter((candidate) => !sameIdentity(candidate.asset, position.asset));
  next.push({ asset: position.asset, symbol: position.symbol, kind: position.kind });
  return next;
}

function positionsAfterActivity(positions, activity) {
  const removed = new Set((activity.removeAssets ?? []).map(assetKey));
  if (typeof activity.asset === "string") removed.add(assetKey(activity.asset));
  let next = positions.filter((position) => !removed.has(assetKey(position.asset)));
  if (activity.kind === "exit-required" && typeof activity.asset === "string") {
    next = addPosition(next, { asset: activity.asset, symbol: activity.symbol, kind: activity.kind });
  }
  return next;
}

function stateAfterActivity(state, positions, activity) {
  const exitRequired = recoveryPlan(positions).exitRequired;
  const want = activity.action === "exit"
    ? (exitRequired.length ? "hold" : "recover")
    : (activity.kind === "exit-required" ? "hold" : "use");
  const path = state === "launch" && want === "hold" ? ["use", "hold"]
    : state === "launch" && want === "recover" ? ["use", "recover"]
    : [want];
  let next = state;
  for (const candidate of path) {
    if (candidate !== next && canMove(next, candidate)) next = candidate;
  }
  return next;
}

/** Merge a session action into an older sealed record without ever replacing unknown positions by empty. */
function mergePersistentRecord(existing, current) {
  if (!existing) return withoutRuntimeFields(current);
  // A retired record is a completed version. recordActivity creates the next version before
  // recording a later action; keep that new version rather than resurrecting the retired one.
  if (current.version > existing.version && existing.state === "retire") {
    return withoutRuntimeFields(current);
  }
  if (current.authority === "persistent") return withoutRuntimeFields(current);

  const known = new Set(existing.transactions.map(activityHash));
  const newTransactions = current.transactions.filter((transaction) => {
    const hash = activityHash(transaction);
    if (!hash || known.has(hash)) return false;
    known.add(hash);
    return true;
  });
  let positions = existing.positions.map((position) => ({ ...position }));
  let state = existing.state;
  for (const transaction of newTransactions) {
    positions = positionsAfterActivity(positions, transaction);
    state = stateAfterActivity(state, positions, transaction);
  }
  return withoutRuntimeFields({
    ...existing,
    version: Math.max(existing.version ?? 0, current.version ?? 0),
    positions,
    state,
    transactions: [...existing.transactions, ...newTransactions],
    updatedAt: current.updatedAt ?? existing.updatedAt,
  });
}

function mergePersistentRecords(persisted, current, account) {
  const merged = { ...persisted };
  for (const record of recordsForAccount(current, account)) {
    const key = mapKey(account, record.app, record.strategy);
    merged[key] = mergePersistentRecord(merged[key], record);
  }
  return merged;
}

/**
 * Remove caches written by builds that treated the browser as a persistent identity registry.
 *
 * Moving new writes to sessionStorage does nothing for someone who already has the old records on
 * disk, so a returning visitor's stored wallet-to-app mapping is deleted on first load. The old key
 * is removed from both storage areas because the previous session-only patch used the same key.
 * This runs for its effect at module load and must never throw.
 */
export function purgeLegacyDeviceCache() {
  let ok = true;
  for (const name of ["localStorage", "sessionStorage"]) {
    try { globalThis[name]?.removeItem?.(LEGACY_KEY); }
    catch { ok = false; }
  }
  return ok;
}

purgeLegacyDeviceCache();

export const mapKey = (account, appId, strategy = "default") =>
  [account ?? "", appId, strategy].map((part) => String(part).toLowerCase()).join(":");

export const LIFECYCLE_STATE_UNAVAILABLE =
  "Facet lifecycle state is unavailable in this tab. Restore or unlock the private record before changing it.";

function replaceAccountSessionRecords(base, records, account) {
  const next = { ...base };
  for (const [key, record] of Object.entries(next)) {
    if (typeof record.wallet === "string" && sameIdentity(record.wallet, account)) delete next[key];
  }
  for (const record of Object.values(records)) {
    if (typeof record.wallet !== "string" || !sameIdentity(record.wallet, account)) continue;
    next[mapKey(account, record.app, record.strategy)] = {
      ...record,
      authority: "persistent",
    };
  }
  return next;
}

/**
 * Restore this wallet's records from the encrypted envelope. The passphrase is consumed only by
 * the SDK's PBKDF2 step; the returned vault contains a non-extractable CryptoKey, not the secret.
 * A wrong passphrase or malformed envelope throws and leaves the current session untouched.
 */
export async function unlockPersistentActivity(account, passphrase, canCommit = () => true) {
  if (typeof account !== "string" || !account) throw new TypeError("A wallet account is required.");
  const vault = await unlockPassphraseSealedFacets(sealedStorage, passphrase, persistentNamespace);
  if (!canCommit()) throw new Error("The connected wallet changed before recovery was restored.");
  const persisted = validatePersistentRecords(vault.records);
  const current = readMap();
  const merged = mergePersistentRecords(persisted, current, account);
  const nextSession = replaceAccountSessionRecords(current, merged, account);
  if (!canCommit()) throw new Error("The connected wallet changed before recovery was restored.");
  if (!writeMap(nextSession)) {
    throw new Error("This tab cannot hold restored private state; lifecycle controls remain disabled.");
  }
  return {
    key: vault.key,
    salt: vault.salt,
    configured: vault.configured,
    records: Object.values(merged),
  };
}

/** Persist the current wallet's session changes with an already-unlocked non-extractable key. */
export async function savePersistentActivity(account, vault, canCommit = () => true) {
  if (!vault?.key || !vault?.salt) throw new TypeError("Encrypted recovery is locked.");
  if (typeof account !== "string" || !account) throw new TypeError("A wallet account is required.");
  const persisted = validatePersistentRecords(vault.records ?? []);
  const current = readMap();
  const merged = mergePersistentRecords(persisted, current, account);
  const records = Object.values(merged).map(withoutRuntimeFields);
  if (!canCommit()) return { saved: false, records };
  const saved = await saveUnlockedPassphraseSealedFacets(
    sealedStorage,
    vault,
    records,
    persistentNamespace,
    canCommit,
  );
  if (!saved) return { saved: false, records };
  if (!canCommit()) return { saved: false, records };
  // Keep the just-saved record set authoritative in this tab, even if the storage write was the
  // only operation that changed it (for example, a first-use empty vault).
  if (!writeMap(replaceAccountSessionRecords(current, merged, account))) {
    return { saved: false, records };
  }
  vault.configured = true;
  return { saved: true, records };
}

/** One-shot save used by a route page after a confirmed receipt. It never stores the passphrase. */
export async function savePersistentActivityWithSecret(account, passphrase, canCommit = () => true) {
  if (typeof account !== "string" || !account) throw new TypeError("A wallet account is required.");
  if (String(passphrase ?? "").trim().length < RECOVERY_PASSPHRASE_MIN_LENGTH) {
    throw new TypeError(`Use a recovery passphrase of at least ${RECOVERY_PASSPHRASE_MIN_LENGTH} characters.`);
  }
  const vault = await unlockPassphraseSealedFacets(sealedStorage, passphrase, persistentNamespace);
  const persisted = validatePersistentRecords(vault.records);
  const current = readMap();
  const merged = mergePersistentRecords(persisted, current, account);
  const records = Object.values(merged).map(withoutRuntimeFields);
  if (!canCommit()) throw new Error("The connected wallet changed before recovery was saved.");
  const saved = await saveUnlockedPassphraseSealedFacets(
    sealedStorage,
    vault,
    records,
    persistentNamespace,
    canCommit,
  );
  if (!saved) throw new Error("Encrypted recovery could not be written in this browser.");
  if (!writeMap(replaceAccountSessionRecords(current, merged, account))) {
    throw new Error("Encrypted recovery was saved, but this tab could not restore its activity view.");
  }
  return { saved: true, configured: true, records };
}

/** Offer persistence only after a confirmed route action; cancelling leaves the action session-only. */
export async function offerPersistentActivitySave(account, appName = "this app", canCommit = () => true) {
  if (typeof globalThis.prompt !== "function") return { saved: false, cancelled: true };
  let passphrase = null;
  try {
    passphrase = globalThis.prompt(
      `Optional: save ${appName} recovery encrypted on this device. Enter a unique 16+ character `
      + "passphrase you can reproduce; Facet cannot reset it. Cancel to keep activity in this tab "
      + "only; Facet never receives the passphrase.",
    );
    if (passphrase == null) return { saved: false, cancelled: true };
    return await savePersistentActivityWithSecret(account, passphrase, canCommit);
  } catch (error) {
    return { saved: false, cancelled: false, error };
  } finally {
    // JavaScript cannot guarantee memory erasure, but no caller or storage layer retains this value.
    passphrase = null;
  }
}

/** Remove only this wallet's tab activity when the user disconnects or locks recovery. */
export function clearSessionActivity(account) {
  if (typeof account !== "string" || !account) return;
  const records = readMap();
  const next = Object.fromEntries(Object.entries(records).filter(([, record]) =>
    typeof record.wallet !== "string" || !sameIdentity(record.wallet, account)));
  writeMap(next);
}

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
  if (!record || !Array.isArray(record.positions) || !record.positions.every(isCachedPosition)) return null;
  return planFacetRecovery(record.app, record.positions ?? [], routesFor(apps));
}

function hasUnaccountedChainPosition(record) {
  const observed = record?.chain?.positions;
  if (!Array.isArray(observed) || !observed.length) return false;
  const localAssets = new Set(record.positions.map((position) => assetKey(position?.asset)));
  return observed.some((position) => {
    if (!position || typeof position !== "object") return true;
    const asset = position.asset ?? position.token;
    if (asset == null) return true;
    return !localAssets.has(assetKey(asset));
  });
}

/**
 * The user-facing sentence for why recovery is blocked, including where to go next.
 *
 * When no catalogue has been configured we say only that an exit is required. Not knowing the
 * routes is not evidence that none exists, and claiming a position is unrecoverable is a much
 * stronger statement than the caller has earned.
 */
export function recoveryBlockedReason(record, apps = []) {
  if (!record || typeof record.state !== "string"
    || !Object.prototype.hasOwnProperty.call(TRANSITIONS, record.state)
    || !Array.isArray(record.positions)) {
    return LIFECYCLE_STATE_UNAVAILABLE;
  }
  if (hasUnaccountedChainPosition(record)) {
    return "A chain observation includes a position not present in the local lifecycle record. " +
      "Restore or unlock authoritative facet state before recovery.";
  }
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
  if (!record || typeof record.state !== "string"
    || !Object.prototype.hasOwnProperty.call(TRANSITIONS, record.state)
    || !Array.isArray(record.positions)) {
    return LIFECYCLE_STATE_UNAVAILABLE;
  }
  if (hasUnaccountedChainPosition(record)) {
    return "A chain observation includes a position not present in the local lifecycle record. " +
      "Restore or unlock authoritative facet state before retirement.";
  }
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
    return writeRecordMap(records, key);
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
  const current = records[key];
  // Chain discovery is an observation, not evidence that this wallet used this application. In a
  // new tab there is no session record, so leave the lifecycle state unknown and do not create an
  // empty record that could later be retired over a real position.
  if (!current) return null;
  const fresh = records;
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
  return writeRecordMap(records, key);
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
  if (typeof hash !== "string" || !hash.trim() || typeof action !== "string" || !action.trim()) {
    throw new TypeError("A confirmed activity hash and action are required.");
  }
  const records = readMap();
  const key = mapKey(account, appId);
  if (!records[key] || records[key].state === "retire") retain(account, appId);
  const fresh = readMap();
  const current = fresh[key];
  if (!current) throw new Error("This tab could not retain the activity record safely.");
  const transaction = {
    hash, action, at: new Date().toISOString(),
    ...(typeof asset === "string" ? { asset } : {}),
    ...(typeof symbol === "string" ? { symbol } : {}),
    ...(typeof kind === "string" ? { kind } : {}),
    removeAssets: Array.isArray(removeAssets)
      ? removeAssets.filter((candidate) => typeof candidate === "string")
      : [],
  };
  const positions = positionsAfterActivity(current.positions, transaction);
  // Only call an exit recovered when it closed every persistent position. A partial exit remains
  // visible in hold, so the next protocol action is still explicit rather than silently terminal.
  const state = stateAfterActivity(current.state, positions, transaction);
  const transactions = [...current.transactions, transaction];
  fresh[key] = { ...current, state, positions, transactions, updatedAt: new Date().toISOString() };
  return writeRecordMap(fresh, key);
}
