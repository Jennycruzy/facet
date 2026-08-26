import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveViewingKeyFromSignature,
  keccak256Hex,
  MAX_VIEWING_KEY,
} from "../assets/js/wallet-derivation.js";

const SIGNATURE = `0x${"11".repeat(64)}1b`;
const EXPECTED_VIEWING_KEY =
  1303569664237614496489143458037667391579691182938090923584262300633580987291n;

test("browser Keccak implementation uses Keccak padding, not SHA-3 padding", () => {
  assert.equal(
    keccak256Hex(new Uint8Array()),
    "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
  );
});

test("browser viewing-key derivation matches the SDK golden vector", () => {
  const key = deriveViewingKeyFromSignature(SIGNATURE);
  assert.equal(key, EXPECTED_VIEWING_KEY);
  assert.ok(key > 0n && key < MAX_VIEWING_KEY);
});
