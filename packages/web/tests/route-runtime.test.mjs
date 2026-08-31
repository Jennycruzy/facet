import assert from "node:assert/strict";
import test from "node:test";

import { candidateWallets, detectReadyX, executionBlockReason } from "../assets/js/route-runtime.js";

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

const readyState = (overrides = {}) => ({
  wallet: wallet("Ready X", "ready"),
  connected: true,
  account: "0x123",
  chainId: "SN_MAIN",
  apiVersions: ["0.10.3"],
  helperDeployed: true,
  balanceWei: 10n,
  amountWei: 1n,
  amountError: "",
  quote: { checkedAt: 1 },
  executing: false,
  ...overrides,
});

test("a complete review is executable only after confirmation", () => {
  const state = readyState();
  assert.equal(executionBlockReason(state), "Check the review box before requesting a transaction.");
  assert.equal(executionBlockReason(state, { confirmChecked: true, protocolName: "Endur" }), null);
});

test("a blocked review explains the first missing prerequisite", () => {
  assert.equal(
    executionBlockReason(readyState({ connected: false }), { confirmChecked: true }),
    "Connect Ready X before requesting a transaction.",
  );
  assert.equal(
    executionBlockReason(readyState({ chainId: "SN_SEPOLIA" }), { confirmChecked: true }),
    "Switch Ready X to Starknet Mainnet before requesting this action.",
  );
  assert.equal(
    executionBlockReason(readyState(), { confirmChecked: true, protocolName: "Endur", protocolReady: false }),
    "The Endur protocol check is not ready.",
  );
});
