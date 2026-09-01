import assert from "node:assert/strict";
import test from "node:test";

import { createChain, decodeShadowAccounts } from "../assets/js/chain.js";

test("decodes deterministic shadow-account view results", () => {
  assert.deepEqual(
    decodeShadowAccounts(["0x2", "0x0", "0x0abc", "0x1", "0x1", "0xdef", "0x0"]),
    [
      { nonce: 0n, address: "0xabc", isDeployed: true },
      { nonce: 1n, address: "0xdef", isDeployed: false },
    ],
  );
});

test("rejects malformed shadow-account spans", () => {
  assert.throws(() => decodeShadowAccounts(["0x1", "0x0"]), /invalid account span/);
  assert.throws(() => decodeShadowAccounts(["not-a-length"]), /invalid length/);
});

test("the chain reader queries the anonymizer with one explicit nonce", async () => {
  const requests = [];
  let cacheWrites = 0;
  globalThis.sessionStorage = {
    getItem: () => null,
    setItem: () => { cacheWrites += 1; },
  };
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ result: ["0x1", "0x7", "0xabc", "0x1"] }) };
  };
  const chain = createChain({ mainnet: { rpc: "https://rpc.invalid" } });
  const result = await chain.shadowAccounts("mainnet", "0x123", "0x456", 7);
  assert.deepEqual(result, [{ nonce: 7n, address: "0xabc", isDeployed: true }]);
  assert.deepEqual(requests[0].params[0].calldata, ["0x456", "0x7", "0x8", "0x0"]);
  assert.equal(cacheWrites, 0, "private commitment discovery must not enter sessionStorage");
});
