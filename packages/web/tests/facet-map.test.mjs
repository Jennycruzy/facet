// The launcher's local record and the SDK's lifecycle model must not drift: the SDK owns the state
// machine, the browser renders it, and a transition legal in one has to be legal in the other.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const store = new Map([["facet-wallet-map-v1", '{"0xabc:endur:default":{"wallet":"0xabc"}}']]);
// The cache is session-scoped now; localStorage is kept only so the legacy purge has something to
// delete, and so a test can prove nothing identifying is ever written back to disk.
const disk = new Map([["facet-wallet-map-v1", '{"0xabc:endur:default":{"wallet":"0xabc"}}']]);
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};
globalThis.localStorage = {
  getItem: (k) => (disk.has(k) ? disk.get(k) : null),
  setItem: (k, v) => disk.set(k, v),
  removeItem: (k) => disk.delete(k),
};

const map = await import("../assets/js/facet-map.js");
const sdk = await import("../../sdk/dist/facets.js");
// facet-map imports the deployed bundle, so identity has to be checked against that same module.
const bundle = await import("../assets/js/facet-sdk.js");
const facetsData = JSON.parse(readFileSync(new URL("../data/facets.json", import.meta.url), "utf8"));

const ACCOUNT = "0xabc";
const XSTRK = "0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a";
const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const PASSPHRASE = "a deliberately long recovery passphrase";
const reset = () => store.clear();

test("invalid top-level cache JSON becomes an empty, non-authoritative map", () => {
  for (const raw of ["null", "[]", "1", "\"text\""]) {
    reset();
    store.set("facet-activity-session-v2", raw);
    assert.deepEqual(map.readMap(), {});
  }
  reset();
});

test("malformed nested cache records are discarded rather than rendered", () => {
  reset();
  store.set("facet-activity-session-v2", JSON.stringify({
    bad: { app: "endur", strategy: "default", wallet: ACCOUNT, state: "hold",
      positions: [null], transactions: [] },
  }));
  assert.deepEqual(map.readMap(), {});
  reset();
});

test("invalid lifecycle state fails closed", () => {
  reset();
  const record = { state: "unknown", positions: [] };
  assert.equal(map.recoveryBlockedReason(record), map.LIFECYCLE_STATE_UNAVAILABLE);
  assert.equal(map.retireBlockedReason(record), map.LIFECYCLE_STATE_UNAVAILABLE);
});

test("the browser does not keep its own transition table; it uses the SDK's", () => {
  // Stronger than equality: the launcher must be reading the SDK's object, so the two cannot be
  // edited apart. This is what stops the old hand-maintained mirror from coming back.
  assert.equal(map.TRANSITIONS, bundle.FACET_TRANSITIONS);
  assert.deepEqual(map.TRANSITIONS, sdk.FACET_TRANSITIONS);
});

test("every browser transition decision agrees with the SDK", () => {
  const states = ["launch", "use", "hold", "recover", "retire"];
  for (const from of states) {
    for (const to of states) {
      const record = { key: "k", state: from, wallet: "", app: "", strategy: "", address: "",
        createdAt: "", updatedAt: "", recovery: { positions: [] } };
      let sdkAllows = true;
      try {
        sdk.moveFacet({ get: () => record, set: () => {} }, record, to);
      } catch { sdkAllows = false; }
      assert.equal(map.canMove(from, to), sdkAllows, `${from} → ${to} disagrees`);
    }
  }
});

test("the browser classifies positions with the SDK's function, not a copy", () => {
  const positions = [{ asset: STRK, kind: "fungible" }, { asset: XSTRK, kind: "exit-required" }];
  assert.deepEqual(map.recoveryPlan(positions), sdk.recoveryPlan(positions));
});

test("a new facet starts in launch and uses all five states", () => {
  reset();
  assert.equal(map.retain(ACCOUNT, "endur").state, "launch");
  assert.deepEqual(Object.keys(map.TRANSITIONS).sort(),
    ["hold", "launch", "recover", "retire", "use"]);
});

test("a stake records its hash and lands in hold, because xSTRK is a position", () => {
  reset();
  map.retain(ACCOUNT, "endur");
  const record = map.recordActivity(ACCOUNT, "endur", {
    hash: "0x240d2b82", asset: XSTRK, symbol: "xSTRK", kind: "exit-required", action: "stake",
  });
  assert.equal(record.state, "hold");
  assert.deepEqual(record.positions, [{ asset: XSTRK, symbol: "xSTRK", kind: "exit-required" }]);
  assert.equal(record.transactions.length, 1);
  assert.equal(record.transactions[0].hash, "0x240d2b82");
});

test("a facet holding a position cannot be retired, and says why", () => {
  reset();
  map.retain(ACCOUNT, "endur");
  const held = map.recordActivity(ACCOUNT, "endur", {
    hash: "0x1", asset: XSTRK, symbol: "xSTRK", kind: "exit-required", action: "stake",
  });
  assert.match(map.retireBlockedReason(held), /Exit the position before retiring/);
  assert.match(map.recoveryBlockedReason(held), /Exit the position before recovering/);
  assert.throws(() => map.beginRecovery(ACCOUNT, "endur"), /Exit the position before recovering/);
});

test("a clean facet can recover and retire through explicit controls", () => {
  reset();
  map.retain(ACCOUNT, "swap");
  map.move(ACCOUNT, "swap", "use");
  const recovered = map.beginRecovery(ACCOUNT, "swap");
  assert.equal(recovered.state, "recover");
  const retired = map.move(ACCOUNT, "swap", "retire");
  assert.equal(retired.state, "retire");
});

test("the configured Ekubo exit clears the real Endur position", () => {
  reset();
  map.retain(ACCOUNT, "endur");
  map.recordActivity(ACCOUNT, "endur", {
    hash: "0x1", asset: XSTRK, symbol: "xSTRK", kind: "exit-required", action: "stake",
  });
  const exitRoute = facetsData.apps.find((app) => app.id === "ekubo-exit");
  assert.ok(exitRoute?.lifecycle, "exit route has no lifecycle metadata");
  const exited = map.recordActivity(ACCOUNT, exitRoute.lifecycle.contextApp, {
    hash: "0x2", asset: exitRoute.route.tokenOut, symbol: "STRK", kind: "fungible",
    action: "exit", removeAssets: exitRoute.lifecycle.closesAssets,
  });
  assert.equal(exited.state, "recover");
  assert.deepEqual(exited.positions, []);
  assert.equal(exited.transactions.length, 2);
  assert.equal(map.retireBlockedReason(exited), null);
  assert.equal(map.readMap()[map.mapKey(ACCOUNT, "ekubo-exit")], undefined,
    "the exit route must not create a separate identity record");
});

test("a partial exit keeps the facet in hold until every position is closed", () => {
  reset();
  map.retain(ACCOUNT, "endur");
  map.recordActivity(ACCOUNT, "endur", {
    hash: "0x1", asset: XSTRK, symbol: "xSTRK", kind: "exit-required", action: "stake",
  });
  const partial = map.recordActivity(ACCOUNT, "endur", {
    hash: "0x2", asset: STRK, symbol: "STRK", kind: "fungible", action: "exit",
  });
  assert.equal(partial.state, "hold");
  assert.deepEqual(partial.positions, [{ asset: XSTRK, symbol: "xSTRK", kind: "exit-required" }]);
  assert.match(map.recoveryBlockedReason(partial), /Exit the position before recovering/);
});

test("a swap that settles a fungible asset leaves the facet in use", () => {
  reset();
  map.retain(ACCOUNT, "ekubo");
  const record = map.recordActivity(ACCOUNT, "ekubo", {
    hash: "0x2d3c449e", asset: STRK, symbol: "ETH", kind: "fungible", action: "swap",
  });
  assert.equal(record.state, "use");
  assert.deepEqual(record.positions, []);
});

test("an illegal transition is refused rather than silently applied", () => {
  reset();
  map.retain(ACCOUNT, "ekubo");
  assert.throws(() => map.move(ACCOUNT, "ekubo", "recover"), /Invalid facet lifecycle transition/);
});

test("a configured catalogue names the route that closes the position", () => {
  reset();
  map.configureExitRoutes(facetsData.apps);
  map.retain(ACCOUNT, "endur");
  const held = map.recordActivity(ACCOUNT, "endur", {
    hash: "0x1", asset: XSTRK, symbol: "xSTRK", kind: "exit-required", action: "stake",
  });
  const routing = map.recoveryRouting(held);
  assert.equal(routing.ready, false);
  assert.equal(routing.unsupported.length, 0);
  assert.equal(routing.viaExit[0].route.appId, "ekubo-exit");
  // The user is told where to go, not just that they are stuck.
  assert.match(map.recoveryBlockedReason(held), /Use the ekubo-exit route/);
  map.configureExitRoutes([]);
});

test("an unroutable position is reported as needing an adapter, not as recoverable", () => {
  reset();
  map.configureExitRoutes(facetsData.apps);
  map.retain(ACCOUNT, "endur");
  const held = map.recordActivity(ACCOUNT, "endur", {
    hash: "0x1", asset: "0xdeadbeef", symbol: "LP", kind: "exit-required", action: "stake",
  });
  assert.equal(map.recoveryRouting(held).unsupported[0].code, map.RECOVERY_REQUIRES_ADAPTER);
  assert.match(map.recoveryBlockedReason(held), /RECOVERY_REQUIRES_ADAPTER/);
  assert.throws(() => map.beginRecovery(ACCOUNT, "endur"), /RECOVERY_REQUIRES_ADAPTER/);
  map.configureExitRoutes([]);
});

test("without a catalogue the launcher does not claim a position is unrecoverable", () => {
  reset();
  map.configureExitRoutes([]);
  map.retain(ACCOUNT, "endur");
  const held = map.recordActivity(ACCOUNT, "endur", {
    hash: "0x1", asset: XSTRK, symbol: "xSTRK", kind: "exit-required", action: "stake",
  });
  // Not knowing the routes is not evidence that none exists.
  const reason = map.recoveryBlockedReason(held);
  assert.match(reason, /Exit the position before recovering/);
  assert.doesNotMatch(reason, /RECOVERY_REQUIRES_ADAPTER/);
});

test("a fungible-only facet is ready to recover with no exit at all", () => {
  reset();
  map.configureExitRoutes(facetsData.apps);
  map.retain(ACCOUNT, "ekubo");
  const record = map.recordActivity(ACCOUNT, "ekubo", {
    hash: "0x2", asset: STRK, symbol: "ETH", kind: "fungible", action: "swap",
  });
  const routing = map.recoveryRouting(record);
  assert.equal(routing.ready, true);
  assert.equal(map.recoveryBlockedReason(record), null);
  map.configureExitRoutes([]);
});

test("a malformed cached record degrades instead of taking the render path down", () => {
  reset();
  map.configureExitRoutes(facetsData.apps);
  // Records are read back from a browser cache that may predate the current shape. These helpers
  // run while rendering the facet map, so they must never throw on one.
  const legacy = { state: "hold", positions: [{ asset: "0xdead", symbol: "LP", kind: "exit-required" }] };
  assert.match(map.retireBlockedReason(legacy), /Exit the position before retiring/);
  // 0xdead has no configured route, so the adapter sentinel is the correct answer here.
  assert.match(map.recoveryBlockedReason(legacy), /RECOVERY_REQUIRES_ADAPTER/);
  assert.equal(map.recoveryRouting(legacy).ready, false);
  assert.equal(map.recoveryRouting({ app: 5, positions: [] }).ready, true);
  assert.match(map.retireBlockedReason({ app: "endur", state: "use" }), /state is unavailable/);
  map.configureExitRoutes([]);
});

test("a chain observation can block a transition but cannot create or complete lifecycle state", () => {
  reset();
  const observed = {
    app: "endur", state: "use", positions: [],
    chain: { positions: [{ token: XSTRK, symbol: "xSTRK", amount: "11" }] },
  };
  assert.match(map.retireBlockedReason(observed), /chain observation/);
  assert.match(map.recoveryBlockedReason(observed), /chain observation/);
});

test("the wallet-to-app mapping is never written to disk, and any old one is purged", () => {
  reset();
  // The module deletes the pre-v2 localStorage cache at import time.
  assert.equal(disk.has("facet-wallet-map-v1"), false, "legacy on-disk cache was not purged");
  assert.equal(store.has("facet-wallet-map-v1"), false, "legacy session cache was not purged");

  map.retain(ACCOUNT, "endur");
  map.recordActivity(ACCOUNT, "endur", {
    hash: "0x240d2b82", asset: XSTRK, symbol: "xSTRK", kind: "exit-required", action: "stake",
  });
  // Everything the session records stays in sessionStorage.
  assert.ok(store.get("facet-activity-session-v2").includes(ACCOUNT));
  assert.equal(disk.size, 0, "a wallet-to-app record reached localStorage");
});

test("a new session does not recreate lifecycle state from chain discovery", () => {
  reset();
  map.retain(ACCOUNT, "endur");
  map.recordActivity(ACCOUNT, "endur", {
    hash: "0x1", asset: XSTRK, symbol: "xSTRK", kind: "exit-required", action: "stake",
  });
  // A new tab starts with an empty cache...
  store.clear();
  assert.deepEqual(map.readMap(), {});
  // ...and chain discovery cannot silently turn an unknown facet into an empty record.
  const rebuilt = map.reconcile(ACCOUNT, "endur", {
    address: "0x5709", isDeployed: true, balances: {},
    positions: [{ token: XSTRK, symbol: "xSTRK", amount: "11" }],
  });
  assert.equal(rebuilt, null);
  assert.deepEqual(map.readMap(), {});
  assert.equal(map.retireBlockedReason(null), map.LIFECYCLE_STATE_UNAVAILABLE);
  assert.equal(map.recoveryBlockedReason(null), map.LIFECYCLE_STATE_UNAVAILABLE);
});

test("reconcile updates an existing session record without merging chain positions into lifecycle state", () => {
  reset();
  map.retain(ACCOUNT, "endur");
  const reconciled = map.reconcile(ACCOUNT, "endur", {
    address: "0x5709", isDeployed: true, balances: {},
    positions: [{ token: XSTRK, symbol: "xSTRK", amount: "11" }],
  });
  assert.deepEqual(reconciled.positions, []);
  assert.equal(reconciled.chain.positions[0].symbol, "xSTRK");
});

test("purging is safe in a browser that denies storage entirely", () => {
  const real = globalThis.localStorage;
  globalThis.localStorage = { removeItem: () => { throw new Error("denied"); } };
  assert.equal(map.purgeLegacyDeviceCache(), false);
  globalThis.localStorage = real;
});

test("lifecycle changes fail closed when session storage rejects a write", () => {
  reset();
  const original = globalThis.sessionStorage.setItem;
  globalThis.sessionStorage.setItem = () => { throw new Error("denied"); };
  assert.throws(() => map.retain(ACCOUNT, "endur"), /cannot retain lifecycle state safely/);
  globalThis.sessionStorage.setItem = original;

  map.retain(ACCOUNT, "endur");
  globalThis.sessionStorage.setItem = () => { throw new Error("denied"); };
  assert.throws(() => map.recordActivity(ACCOUNT, "endur", {
    hash: "0xwrite-fails", asset: XSTRK, symbol: "xSTRK", kind: "exit-required", action: "stake",
  }), /cannot retain lifecycle state safely/);
  globalThis.sessionStorage.setItem = original;
  reset();
});

test("persistent recovery seals the complete browser record and restores it after a new tab", async () => {
  reset();
  disk.clear();
  map.retain(ACCOUNT, "endur");
  map.recordActivity(ACCOUNT, "endur", {
    hash: "0xsealed", asset: XSTRK, symbol: "xSTRK", kind: "exit-required", action: "stake",
  });
  const vault = await map.unlockPersistentActivity(ACCOUNT, PASSPHRASE);
  assert.equal(vault.configured, false);
  assert.equal((await map.savePersistentActivity(ACCOUNT, vault)).saved, true);
  const envelope = disk.get(bundle.SEALED_FACETS_KEY);
  assert.match(envelope, /^p1\./);
  assert.doesNotMatch(envelope, new RegExp(ACCOUNT.slice(2), "i"));
  assert.doesNotMatch(envelope, /endur|xSTRK|28d709/i);
  assert.deepEqual([...disk.keys()], [bundle.SEALED_FACETS_KEY]);

  store.clear();
  await assert.rejects(map.unlockPersistentActivity(ACCOUNT, "not the recovery passphrase"));
  assert.deepEqual(map.readMap(), {});
  const restored = await map.unlockPersistentActivity(ACCOUNT, PASSPHRASE);
  assert.equal(restored.configured, true);
  const record = map.readMap()[map.mapKey(ACCOUNT, "endur")];
  assert.equal(record.state, "hold");
  assert.deepEqual(record.positions, [{ asset: XSTRK, symbol: "xSTRK", kind: "exit-required" }]);
  disk.clear();
});

test("a new-tab exit merges with the sealed position instead of dropping unknown recovery state", async () => {
  reset();
  disk.clear();
  map.retain(ACCOUNT, "endur");
  map.recordActivity(ACCOUNT, "endur", {
    hash: "0xstake", asset: XSTRK, symbol: "xSTRK", kind: "exit-required", action: "stake",
  });
  const firstVault = await map.unlockPersistentActivity(ACCOUNT, PASSPHRASE);
  await map.savePersistentActivity(ACCOUNT, firstVault);

  store.clear();
  map.recordActivity(ACCOUNT, "endur", {
    hash: "0xexit", asset: STRK, symbol: "STRK", kind: "fungible", action: "exit",
    removeAssets: [XSTRK],
  });
  const saved = await map.savePersistentActivityWithSecret(ACCOUNT, PASSPHRASE);
  assert.equal(saved.saved, true);
  store.clear();
  await map.unlockPersistentActivity(ACCOUNT, PASSPHRASE);
  const restored = map.readMap()[map.mapKey(ACCOUNT, "endur")];
  assert.equal(restored.state, "recover");
  assert.deepEqual(restored.positions, []);
  assert.deepEqual(restored.transactions.map(({ hash }) => hash), ["0xstake", "0xexit"]);
  disk.clear();
});
