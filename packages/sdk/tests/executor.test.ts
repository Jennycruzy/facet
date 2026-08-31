import { describe, expect, it, vi } from "vitest";
import {
  buildWalletActions, ekuboHelperBinding, erc4626HelperBinding,
  ExecutorPolicyError, WalletFacetExecutor,
} from "../src/executor.js";
import { buildEkuboSwapPlan, endurAdapter } from "../src/adapters.js";
import type { AdapterPlan } from "../src/adapters.js";
import { executeAppIntent } from "../src/facets.js";

const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const XSTRK = "0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a";
const EKUBO_HELPER = "0x2bd92991a0c90757caeb5d0908892637d4288ff4e2013877e0a2707a3788537";
const ENDUR_HELPER = "0x292df14818896b5366a075581471b4dd9436f6590f696e6f9658a777c4a1240";
const ROUTER = "0x199741822c2dc722f6f605204f35e56dbc23bceed54818168c4c49e4fb8737e";
const OWNER = "0x1234";
const FEE = "0x20c49ba5e353f80000000000000000";
const AMOUNT = "0x16345785d8a0000"; // 0.1e18
const SYNC_VAULT = "0xfeed"; // a vault that pays out in the same transaction
const policy = {
  supportedAssets: [STRK, ETH, XSTRK],
  amountBounds: { min: "0x1", max: "0xde0b6b3a7640000" }, // 1 wei .. 1e18
  assetKinds: { [STRK]: "fungible", [ETH]: "fungible", [XSTRK]: "exit-required" },
} as const;

/** One settlement, matching what the deployed Ekubo helper can actually settle. */
const ekuboPlan: AdapterPlan = {
  protocol: "ekubo",
  calls: [{ contractAddress: ROUTER, entrypoint: "swap", calldata: ["0x0", "0xea", "0x0"] }],
  publicRecipients: [],
  input: { token: STRK, amount: AMOUNT },
  settlements: [{ token: ETH, policy: { type: "diff" }, reason: "swap output" }],
};

describe("the reference wallet executor", () => {
  it("reproduces the action list of the verified Mainnet Ekubo transaction", () => {
    const actions = buildWalletActions(ekuboPlan, {
      owner: OWNER,
      linkedAddresses: [],
      policy,
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

  it("executes the real Endur adapter plan through the reference executor", async () => {
    const request = vi.fn().mockResolvedValue({ transaction_hash: "0xendur" });
    const executor = new WalletFacetExecutor({
      wallet: { request }, owner: OWNER, linkedAddresses: [OWNER], policy,
      binding: erc4626HelperBinding({ helper: ENDUR_HELPER, operation: "deposit" }),
    });
    const result = await executeAppIntent({
      adapter: endurAdapter,
      intent: { action: "stake", parameters: {
        token: STRK, endur: XSTRK, receiver: ENDUR_HELPER, amount: AMOUNT,
      } },
      context: { linkedAddresses: [OWNER] },
      executor,
    });
    expect(result).toEqual({ transactionHash: "0xendur" });
    expect(request).toHaveBeenCalledWith({
      type: "wallet_strk20InvokeTransaction",
      params: { actions: [
        { type: "withdraw", token: STRK, amount: AMOUNT, recipient: ENDUR_HELPER },
        { type: "transfer", token: XSTRK, amount: "OPEN", recipient: OWNER },
        { type: "invoke", contract: ENDUR_HELPER, calldata: [
          "0x0", STRK, XSTRK, AMOUNT, "0x0", "${openNoteIds[0]}",
        ] },
      ] },
    });
  });

  it("emits the withdraw/redeem discriminant the deployed ERC-4626 helper expects", () => {
    const plan: AdapterPlan = {
      protocol: "endur-exit",
      calls: [{ contractAddress: XSTRK, entrypoint: "redeem", calldata: [] }],
      publicRecipients: [],
      input: { token: XSTRK, amount: AMOUNT },
      settlements: [{ token: STRK, policy: { type: "diff" }, reason: "underlying" }],
    };
    const actions = buildWalletActions(plan, {
      owner: OWNER,
      linkedAddresses: [],
      policy,
      binding: erc4626HelperBinding({ helper: ENDUR_HELPER, operation: "withdraw", vault: SYNC_VAULT }),
    });
    expect((actions[2] as { calldata: string[] }).calldata[0]).toBe("0x1");
  });

  it("builds the Ekubo plan with one settlement, matching the deployed helper", () => {
    const plan = buildEkuboSwapPlan({
      router: ROUTER, token0: STRK, token1: ETH, tokenIn: STRK, tokenOut: ETH,
      routeFee: FEE, tickSpacing: 1000, amountIn: AMOUNT, minimumAmountOut: "0xea",
      linkedAddresses: [],
    });
    // Exact-input single hop: the whole input is consumed, so there is no remainder to clear.
    expect(plan.settlements).toHaveLength(1);
    expect(plan.settlements[0].token).toBe(ETH);
  });

  it("refuses a plan whose settlements outnumber the notes the helper can settle", () => {
    const plan: AdapterPlan = {
      protocol: "ekubo",
      calls: ekuboPlan.calls,
      publicRecipients: [],
      input: { token: STRK, amount: AMOUNT },
      settlements: [
        { token: ETH, policy: { type: "diff" }, reason: "output" },
        { token: STRK, policy: { type: "diff" }, reason: "an input remainder this route never has" },
      ],
    };
    expect(plan.settlements).toHaveLength(2);
    expect(() => buildWalletActions(plan, {
      owner: OWNER,
      linkedAddresses: [],
      policy,
      binding: ekuboHelperBinding({
        helper: EKUBO_HELPER, router: ROUTER, token0: STRK, token1: ETH,
        fee: FEE, tickSpacing: 1000,
      }),
    })).toThrow(ExecutorPolicyError);
  });

  it("refuses a token the route did not declare", () => {
    const stray = "0xdead";
    expect(() => buildWalletActions({ ...ekuboPlan, input: { token: stray, amount: AMOUNT } }, {
      owner: OWNER, linkedAddresses: [], policy,
      binding: ekuboHelperBinding({ helper: EKUBO_HELPER, router: ROUTER, token0: STRK,
        token1: ETH, fee: FEE, tickSpacing: 1000 }),
    })).toThrow(/not a supported asset/);
  });

  it("refuses an input outside the route's declared bounds", () => {
    expect(() => buildWalletActions({ ...ekuboPlan, input: { token: STRK, amount: "0xde0b6b3a7640001" } }, {
      owner: OWNER, linkedAddresses: [], policy,
      binding: ekuboHelperBinding({ helper: EKUBO_HELPER, router: ROUTER, token0: STRK,
        token1: ETH, fee: FEE, tickSpacing: 1000 }),
    })).toThrow(/outside the route's bounds/);
  });

  it("refuses a settled asset with no declared kind", () => {
    expect(() => buildWalletActions(ekuboPlan, {
      owner: OWNER,
      linkedAddresses: [],
      policy: { ...policy, assetKinds: { [STRK]: "fungible" } },
      binding: ekuboHelperBinding({ helper: EKUBO_HELPER, router: ROUTER, token0: STRK,
        token1: ETH, fee: FEE, tickSpacing: 1000 }),
    })).toThrow(/no declared kind/);
  });

  it("refuses to sweep a persistent position with an all policy", () => {
    // xSTRK is a vault share: FINDINGS 6.34 shows its protocol exit is a queue, so it is not
    // automatically recoverable and must never be collected with `all`.
    const plan: AdapterPlan = {
      protocol: "endur",
      calls: [{ contractAddress: XSTRK, entrypoint: "deposit", calldata: [] }],
      publicRecipients: [],
      input: { token: STRK, amount: AMOUNT },
      settlements: [{ token: XSTRK, policy: { type: "all" }, reason: "shares" }],
    };
    expect(() => buildWalletActions(plan, {
      owner: OWNER, linkedAddresses: [], policy,
      binding: erc4626HelperBinding({ helper: ENDUR_HELPER, operation: "deposit" }),
    })).toThrow(/persistent position/);
  });

  it("refuses a withdraw binding for a vault that redeems through a queue", () => {
    // FINDINGS 6.34: Endur's redeem mints an ERC-721 ticket and returns no underlying, so the
    // helper's non-zero-output assert would revert the invoke after a proof had been paid for.
    const ENDUR_XSTRK = "0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a";
    expect(() => erc4626HelperBinding({
      helper: ENDUR_HELPER, operation: "withdraw", vault: ENDUR_XSTRK,
    })).toThrow(/withdrawal queue/);
  });

  it("refuses a withdraw binding that does not name its vault", () => {
    expect(() => erc4626HelperBinding({ helper: ENDUR_HELPER, operation: "withdraw" }))
      .toThrow(/must name its vault/);
  });

  it("normalizes zero-padded asset-kind keys", () => {
    const paddedPolicy = {
      ...policy,
      assetKinds: {
        [STRK]: "fungible" as const,
        [ETH]: "fungible" as const,
        [`0x0${XSTRK.slice(2)}`]: "exit-required" as const,
      },
    };
    expect(() => buildWalletActions({
      protocol: "endur",
      calls: [],
      publicRecipients: [],
      input: { token: STRK, amount: AMOUNT },
      settlements: [{ token: XSTRK, policy: { type: "diff" }, reason: "shares" }],
    }, {
      owner: OWNER, linkedAddresses: [], policy: paddedPolicy,
      binding: erc4626HelperBinding({ helper: ENDUR_HELPER, operation: "deposit" }),
    })).not.toThrow();
  });

  it("requires the linked-address set at runtime", () => {
    expect(() => buildWalletActions(ekuboPlan, {
      owner: OWNER, policy,
      binding: ekuboHelperBinding({
        helper: EKUBO_HELPER, router: ROUTER, token0: STRK, token1: ETH,
        fee: FEE, tickSpacing: 1000,
      }),
    } as unknown as Parameters<typeof buildWalletActions>[1])).toThrow(/linkedAddresses/);
  });

  it("refuses an explicit public recipient linked to the user", () => {
    expect(() => buildWalletActions({
      ...ekuboPlan,
      publicRecipients: [{ field: "beneficiary", address: OWNER }],
    }, {
      owner: OWNER,
      policy,
      linkedAddresses: [OWNER],
      binding: ekuboHelperBinding({
        helper: EKUBO_HELPER, router: ROUTER, token0: STRK, token1: ETH,
        fee: FEE, tickSpacing: 1000,
      }),
    })).toThrow(/linked/i);
  });

  it("settles into the owner's shielded balance without treating the owner as a linked leak", () => {
    const actions = buildWalletActions(ekuboPlan, {
      owner: OWNER,
      policy,
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
      wallet: { request }, owner: OWNER, linkedAddresses: [], policy,
      binding: erc4626HelperBinding({ helper: ENDUR_HELPER, operation: "withdraw", vault: SYNC_VAULT }),
    });
    const plan: AdapterPlan = {
      protocol: "endur-exit",
      calls: [{ contractAddress: XSTRK, entrypoint: "redeem", calldata: [] }],
      publicRecipients: [],
      input: { token: XSTRK, amount: AMOUNT },
      settlements: [{ token: STRK, policy: { type: "diff" }, reason: "underlying" }],
    };
    await expect(executor.execute(plan)).resolves.toEqual({ transactionHash: "0xabc" });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      type: "wallet_strk20InvokeTransaction",
    }));
  });

  it("rejects a wallet response with no transaction hash", async () => {
    const executor = new WalletFacetExecutor({
      wallet: { request: async () => ({}) }, owner: OWNER, linkedAddresses: [], policy,
      binding: erc4626HelperBinding({ helper: ENDUR_HELPER, operation: "deposit" }),
    });
    await expect(executor.execute({
      protocol: "endur", calls: [], publicRecipients: [], input: { token: STRK, amount: AMOUNT },
      settlements: [{ token: XSTRK, policy: { type: "diff" }, reason: "shares" }],
    })).rejects.toThrow(/no transaction hash/i);
  });
});
