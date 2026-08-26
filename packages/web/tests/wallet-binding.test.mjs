import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalWalletBindingMessage,
  detectEoaProvider,
  encodePersonalSignMessage,
  normalizeEoaAddress,
  normalizeStarknetFelt,
  signWalletBinding,
  validatePersonalSignature,
} from "../assets/js/wallet-binding.js";

const wallet = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01";

test("canonical binding message binds origin, network, pool, and wallet", () => {
  const message = canonicalWalletBindingMessage({
    origin: "https://usefacet.xyz",
    network: "SN_SEPOLIA",
    pool: "0x000abc",
    wallet,
  });
  assert.equal(message, [
    "Facet wallet binding",
    "domain: Facet",
    "version: 1",
    "origin: https://usefacet.xyz",
    "starknet_network: SN_SEPOLIA",
    "privacy_pool: 0xabc",
    "wallet: 0xabcdef0123456789abcdef0123456789abcdef01",
    "purpose: derive a private Facet viewing capability",
    "This signature authorizes no transaction and spends no funds.",
  ].join("\n"));
});

test("address and felt normalization rejects malformed values", () => {
  assert.equal(normalizeEoaAddress(wallet), "0xabcdef0123456789abcdef0123456789abcdef01");
  assert.equal(normalizeStarknetFelt("0x000abc", "pool"), "0xabc");
  assert.throws(() => normalizeEoaAddress("0x1234"), /20-byte EOA/);
  assert.throws(() => normalizeStarknetFelt(0, "pool"), /positive/);
});

test("personal_sign payload is UTF-8 hex and signature validation is strict", () => {
  assert.equal(encodePersonalSignMessage("Facet\n✓"), "0x46616365740ae29c93");
  assert.equal(
    validatePersonalSignature(`0x${"11".repeat(64)}1b`),
    `0x${"11".repeat(64)}1b`,
  );
  assert.throws(() => validatePersonalSignature(`0x${"11".repeat(64)}02`), /recovery byte/);
  assert.throws(() => validatePersonalSignature("0x1234"), /unexpected/);
});

test("wallet binding uses personal_sign with the canonical parameter order", async () => {
  const calls = [];
  const provider = {
    request: async (request) => {
      calls.push(request);
      return `0x${"22".repeat(64)}1c`;
    },
  };
  const account = normalizeEoaAddress(wallet);
  const signature = await signWalletBinding(provider, account, "Facet wallet binding");
  assert.equal(signature, `0x${"22".repeat(64)}1c`);
  assert.deepEqual(calls, [{
    method: "personal_sign",
    params: ["0x46616365742077616c6c65742062696e64696e67", account],
  }]);
});

test("provider detection does not require a browser global", () => {
  const provider = { request() {} };
  assert.equal(detectEoaProvider({ ethereum: { providers: [provider] } }), provider);
  assert.equal(detectEoaProvider({}), null);
});
