// The web package mirrors the SDK executor because it ships without a build step. A mirror is only
// safe if something proves it is still a mirror: this compares both implementations on the same
// plans — the accepted ones byte-for-byte, the rejected ones by which rule fired.
import assert from "node:assert/strict";
import test from "node:test";

import * as web from "../assets/js/executor.js";
import * as sdk from "../../sdk/dist/executor.js";

const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const XSTRK = "0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a";
const EKUBO_HELPER = "0x2bd92991a0c90757caeb5d0908892637d4288ff4e2013877e0a2707a3788537";
const ENDUR_HELPER = "0x292df14818896b5366a075581471b4dd9436f6590f696e6f9658a777c4a1240";
const ROUTER = "0x199741822c2dc722f6f605204f35e56dbc23bceed54818168c4c49e4fb8737e";
const OWNER = "0x1234";
const FEE = "0x20c49ba5e353f80000000000000000";
const AMOUNT = "0x16345785d8a0000";

const policy = {
  supportedAssets: [STRK, ETH, XSTRK],
  amountBounds: { min: "0x1", max: "0xde0b6b3a7640000" },
  assetKinds: { [STRK]: "fungible", [ETH]: "fungible", [XSTRK]: "exit-required" },
};

const swap = {
  protocol: "ekubo",
  calls: [{ contractAddress: ROUTER, entrypoint: "swap", calldata: ["0x0", "0xea", "0x0"] }],
  input: { token: STRK, amount: AMOUNT },
  settlements: [{ token: ETH, policy: { type: "diff" }, reason: "swap output" }],
};
const stake = {
  protocol: "endur",
  calls: [{ contractAddress: XSTRK, entrypoint: "deposit", calldata: [] }],
  input: { token: STRK, amount: AMOUNT },
  settlements: [{ token: XSTRK, policy: { type: "diff" }, reason: "vault shares" }],
};
const exit = {
  protocol: "ekubo-exit",
  calls: [{ contractAddress: ROUTER, entrypoint: "swap", calldata: ["0x0", "0xb1", "0x0"] }],
  input: { token: XSTRK, amount: "0x12dccd2e9b3fdec" },
  settlements: [{ token: STRK, policy: { type: "diff" }, reason: "recovered underlying" }],
};

const ekuboBinding = (m) => m.ekuboHelperBinding({
  helper: EKUBO_HELPER, router: ROUTER, token0: STRK, token1: ETH, fee: FEE, tickSpacing: 1000,
});
const exitBinding = (m) => m.ekuboHelperBinding({
  helper: EKUBO_HELPER, router: ROUTER, token0: XSTRK, token1: STRK,
  fee: "0x68db8bac710cb4000000000000000", tickSpacing: 200,
});
const endurBinding = (m) => m.erc4626HelperBinding({ helper: ENDUR_HELPER, operation: "deposit" });

const cases = [
  ["ekubo swap", swap, ekuboBinding],
  ["endur stake", stake, endurBinding],
  ["endur exit via ekubo", exit, exitBinding],
];

for (const [name, plan, binding] of cases) {
  test(`web and SDK executors agree on ${name}`, () => {
    const build = (m) => m.buildWalletActions(plan, { owner: OWNER, policy, binding: binding(m) });
    assert.deepEqual(build(web), build(sdk));
  });
}

test("web and SDK executors reject the same plans for the same reason", () => {
  const rejections = [
    ["unsupported asset", { ...swap, input: { token: "0xdead", amount: AMOUNT } }, policy],
    ["out of bounds", { ...swap, input: { token: STRK, amount: "0xde0b6b3a7640001" } }, policy],
    ["undeclared kind", swap, { ...policy, assetKinds: { [STRK]: "fungible" } }],
    ["sweeping a position", { ...stake, settlements: [{ token: XSTRK, policy: { type: "all" }, reason: "x" }] }, policy],
  ];
  for (const [label, plan, used] of rejections) {
    const errors = [web, sdk].map((m) => {
      try {
        m.buildWalletActions(plan, { owner: OWNER, policy: used, binding: ekuboBinding(m) });
        return null;
      } catch (error) { return error.message; }
    });
    assert.ok(errors[0], `${label}: web executor accepted a plan it should refuse`);
    assert.equal(errors[0], errors[1], `${label}: the two executors disagree`);
  }
});
