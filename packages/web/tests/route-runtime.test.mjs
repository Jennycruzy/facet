import assert from "node:assert/strict";
import test from "node:test";

import { candidateWallets, detectReadyX } from "../assets/js/route-runtime.js";

const wallet = (name, id = name) => ({ name, id, request() {} });

test("Ready X is selected ahead of a generic Starknet injection", () => {
  const ready = wallet("Ready X", "ready");
  const argent = wallet("Argent X", "argentX");
  assert.equal(detectReadyX({ starknet_ready: ready, starknet: argent }), ready);
  assert.deepEqual(candidateWallets({ starknet_ready: ready, starknet: argent }), [
    { name: "starknet_ready", wallet: ready },
  ]);
});

test("a generic injection is accepted only when it identifies itself as Ready", () => {
  const ready = wallet("Ready Wallet", "wallet-ready");
  assert.equal(detectReadyX({ starknet: ready }), ready);
  assert.equal(detectReadyX({ starknet: wallet("Argent X", "argentX") }), null);
  assert.equal(detectReadyX({ starknet_argentX: wallet("Argent X") }), null);
  assert.equal(detectReadyX({ starknet_braavos: wallet("Braavos") }), null);
});

test("a name that merely contains the letters ready is not treated as Ready X", () => {
  const already = wallet("Already Wallet", "already-wallet");
  assert.deepEqual(candidateWallets({ starknet: already }), []);
});

test("the explicit Ready injection remains usable when its metadata is absent", () => {
  const ready = { request() {} };
  assert.equal(detectReadyX({ starknet_ready: ready }), ready);
});
