import { describe, expect, it, vi } from "vitest";
import {
  buildWalletActions, ekuboHelperBinding, erc4626HelperBinding,
  ExecutorPolicyError, WalletFacetExecutor,
} from "../src/executor.js";
import { buildEkuboSwapPlan } from "../src/adapters.js";
import type { AdapterPlan } from "../src/adapters.js";
import type { FacetRecord } from "../src/facets.js";

const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const XSTRK = "0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a";
const EKUBO_HELPER = "0x2bd92991a0c90757caeb5d0908892637d4288ff4e2013877e0a2707a3788537";
const ENDUR_HELPER = "0x292df14818896b5366a075581471b4dd9436f6590f696e6f9658a777c4a1240";
const ROUTER = "0x199741822c2dc722f6f605204f35e56dbc23bceed54818168c4c49e4fb8737e";
const OWNER = "0x1234";
const FEE = "0x20c49ba5e353f80000000000000000";
const AMOUNT = "0x16345785d8a0000"; // 0.1e18
const facet = { address: EKUBO_HELPER } as unknown as FacetRecord;

/** One settlement, matching what the deployed Ekubo helper can actually settle. */
const ekuboPlan: AdapterPlan = {
  protocol: "ekubo",
  calls: [{ contractAddress: ROUTER, entrypoint: "swap", calldata: ["0x0", "0xea", "0x0"] }],
  input: { token: STRK, amount: AMOUNT },
  settlements: [{ token: ETH, policy: { type: "diff" }, reason: "swap output" }],
};

describe("the reference wallet executor", () => {
  it("reproduces the action list of the verified Mainnet Ekubo transaction", () => {
    const actions = buildWalletActions(ekuboPlan, {
      owner: OWNER,
      binding: ekuboHelperBinding({
        helper: EKUBO_HELPER, router: ROUTER, token0: STRK, token1: ETH,
        fee: FEE, tickSpacing: 1000,
      }),
    });
    // Byte-for-byte the shape mainnet-ekubo.js sends to wallet_strk20InvokeTransaction.
    expect(actions).toEqual([
      { type: "withdraw", token: STRK, amount: AMOUNT, recipient: EKUBO_HELPER },
      { type: "transfer", token: ETH, amount: "OPEN", recipient: OWNER },
      { type: "invoke", contract: EKUBO_HELPER, calldata: [
        ROUTER,
        STRK, AMOUNT, "0x0",
        STRK, ETH, FEE, "0x3e8", "0x0",
        "0xea", "0x0",
        "0x0",
        "${openNoteIds[0]}",
      ] },
    ]);
  });

  it("reproduces the action list of the verified Mainnet Endur transaction", () => {
    const plan: AdapterPlan = {
      protocol: "endur",
      calls: [{ contractAddress: XSTRK, entrypoint: "deposit", calldata: [AMOUNT, "0x0", OWNER] }],
      input: { token: STRK, amount: AMOUNT },
      settlements: [{ token: XSTRK, policy: { type: "diff" }, reason: "vault shares" }],
    };
    const actions = buildWalletActions(plan, {
      owner: OWNER,
      binding: erc4626HelperBinding({ helper: ENDUR_HELPER, operation: "deposit" }),
    });
    expect(actions[2]).toEqual({ type: "invoke", contract: ENDUR_HELPER, calldata: [
      "0x0", STRK, XSTRK, AMOUNT, "0x0", "${openNoteIds[0]}",
    ] });
  });

  it("emits the withdraw/redeem discriminant the deployed ERC-4626 helper expects", () => {
    const plan: AdapterPlan = {
      protocol: "endur-exit",
      calls: [{ contractAddress: XSTRK, entrypoint: "redeem", calldata: [] }],
      input: { token: XSTRK, amount: AMOUNT },
      settlements: [{ token: STRK, policy: { type: "diff" }, reason: "underlying" }],
    };
    const actions = buildWalletActions(plan, {
      owner: OWNER,
      binding: erc4626HelperBinding({ helper: ENDUR_HELPER, operation: "withdraw" }),
    });
    expect((actions[2] as { calldata: string[] }).calldata[0]).toBe("0x1");
  });

  it("refuses a plan whose settlements outnumber the notes the helper can settle", () => {
    // buildEkuboSwapPlan declares two settlements (input remainder and output); the deployed
    // helper's privacy_invoke takes exactly one note_id. The live page happens to send one.
    // This mismatch was silent while each page built its own actions — see FINDINGS 6.35.
    const plan = buildEkuboSwapPlan({
      router: ROUTER, token0: STRK, token1: ETH, tokenIn: STRK, tokenOut: ETH,
      routeFee: FEE, tickSpacing: 1000, amountIn: AMOUNT, minimumAmountOut: "0xea",
      linkedAddresses: [],
    });
    expect(plan.settlements).toHaveLength(2);
    expect(() => buildWalletActions(plan, {
      owner: OWNER,
      binding: ekuboHelperBinding({
        helper: EKUBO_HELPER, router: ROUTER, token0: STRK, token1: ETH,
        fee: FEE, tickSpacing: 1000,
      }),
    })).toThrow(ExecutorPolicyError);
  });

  it("refuses a call that targets an address linked to the user", () => {
    expect(() => buildWalletActions(ekuboPlan, {
      owner: OWNER,
      linkedAddresses: [ROUTER],
      binding: ekuboHelperBinding({
        helper: EKUBO_HELPER, router: ROUTER, token0: STRK, token1: ETH,
        fee: FEE, tickSpacing: 1000,
      }),
    })).toThrow(/linked/i);
  });

  it("settles into the owner's shielded balance without treating the owner as a linked leak", () => {
    const actions = buildWalletActions(ekuboPlan, {
      owner: OWNER,
      linkedAddresses: [OWNER],
      binding: ekuboHelperBinding({
        helper: EKUBO_HELPER, router: ROUTER, token0: STRK, token1: ETH,
        fee: FEE, tickSpacing: 1000,
      }),
    });
    expect(actions[1]).toMatchObject({ type: "transfer", recipient: OWNER, amount: "OPEN" });
  });

  it("submits through the wallet and returns the hash", async () => {
    const request = vi.fn().mockResolvedValue({ transaction_hash: "0xabc" });
    const executor = new WalletFacetExecutor({
      wallet: { request }, owner: OWNER,
      binding: erc4626HelperBinding({ helper: ENDUR_HELPER, operation: "withdraw" }),
    });
    const plan: AdapterPlan = {
      protocol: "endur-exit",
      calls: [{ contractAddress: XSTRK, entrypoint: "redeem", calldata: [] }],
      input: { token: XSTRK, amount: AMOUNT },
      settlements: [{ token: STRK, policy: { type: "diff" }, reason: "underlying" }],
    };
    await expect(executor.execute(plan, facet)).resolves.toEqual({ transactionHash: "0xabc" });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      type: "wallet_strk20InvokeTransaction",
    }));
  });

  it("rejects a wallet response with no transaction hash", async () => {
    const executor = new WalletFacetExecutor({
      wallet: { request: async () => ({}) }, owner: OWNER,
      binding: erc4626HelperBinding({ helper: ENDUR_HELPER, operation: "deposit" }),
    });
    await expect(executor.execute({
      protocol: "endur", calls: [], input: { token: STRK, amount: AMOUNT },
      settlements: [{ token: XSTRK, policy: { type: "diff" }, reason: "shares" }],
    }, facet)).rejects.toThrow(/no transaction hash/i);
  });
});
