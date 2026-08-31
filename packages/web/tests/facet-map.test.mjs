// The launcher's local record and the SDK's lifecycle model must not drift: the SDK owns the state
// machine, the browser renders it, and a transition legal in one has to be legal in the other.
import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
};

const map = await import("../assets/js/facet-map.js");
const sdk = await import("../../sdk/dist/facets.js");

const ACCOUNT = "0xabc";
const XSTRK = "0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a";
const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const reset = () => store.clear();

test("the browser transition table matches the SDK's", () => {
  const states = ["launch", "use", "hold", "recover", "retire"];
  for (const from of states) {
    for (const to of states) {
      const record = { key: "k", state: from, wallet: "", app: "", strategy: "", address: "",
        createdAt: "", updatedAt: "", recovery: { encryptedMetadata: "", positions: [] } };
      let sdkAllows = true;
      try {
        sdk.moveFacet({ get: () => record, set: () => {} }, record, to);
      } catch { sdkAllows = false; }
      assert.equal(map.canMove(from, to), sdkAllows, `${from} → ${to} disagrees`);
    }
  }
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
});

test("the exit clears the position and moves the facet to recover", () => {
  reset();
  map.retain(ACCOUNT, "endur");
  map.recordActivity(ACCOUNT, "endur", {
    hash: "0x1", asset: XSTRK, symbol: "xSTRK", kind: "exit-required", action: "stake",
  });
  const exited = map.recordActivity(ACCOUNT, "endur", {
    hash: "0x2", asset: XSTRK, symbol: "xSTRK", kind: "fungible", action: "exit",
  });
  assert.equal(exited.state, "recover");
  assert.deepEqual(exited.positions, []);
  assert.equal(exited.transactions.length, 2);
  assert.equal(map.retireBlockedReason(exited), null);
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
