import { describe, expect, it } from "vitest";
import {
  assertRecipientUnlinked,
  assertFundingDenomination,
  buildEkuboQuoteCall,
  buildEkuboSwapPlan,
  buildEndurStakePlan,
  endurAdapter,
  FundingDenominationError,
  LinkedRecipientError,
} from "../src/index.js";

const linked = ["0xabc", "0xdef"];

describe("protocol adapter builders", () => {
  it("builds Endur approval and ERC-4626-shaped deposit", () => {
    const plan = buildEndurStakePlan({
      token: "0x200",
      endur: "0x500",
      receiver: "0x400",
      amount: 9n,
      linkedAddresses: linked,
    });

    expect(plan.calls).toEqual([
      {
        contractAddress: "0x200",
        entrypoint: "approve",
        calldata: ["0x500", "0x9", "0x0"],
      },
      {
        contractAddress: "0x500",
        entrypoint: "deposit",
        calldata: ["0x9", "0x0", "0x400"],
      },
    ]);
    expect(plan.settlements.map(({ token, policy }) => ({ token, policy }))).toEqual([
      { token: "0x200", policy: { type: "diff" } },
      { token: "0x500", policy: { type: "diff" } },
    ]);
  });

  it("builds the tested Ekubo quote and swap route", () => {
    const route = {
      router: "0x900",
      token0: "0x200",
      token1: "0x300",
      routeFee: 7n,
      tickSpacing: 50n,
      tokenIn: "0x200",
      amountIn: 10n,
    };
    expect(buildEkuboQuoteCall(route)).toEqual({
      contractAddress: "0x900",
      entrypoint: "quote_swap",
      calldata: [
        "0x200", "0x300", "0x7", "0x32", "0x0",
        "0x0", "0x0", "0x0", "0x200", "0xa", "0x0",
      ],
    });

    const plan = buildEkuboSwapPlan({ ...route, tokenOut: "0x300", minimumAmountOut: 4n,
      linkedAddresses: linked });
    expect(plan.calls).toEqual([
      {
        contractAddress: "0x200",
        entrypoint: "transfer",
        calldata: ["0x900", "0xa", "0x0"],
      },
      {
        contractAddress: "0x900",
        entrypoint: "swap",
        calldata: [
          "0x200", "0x300", "0x7", "0x32", "0x0",
          "0x0", "0x0", "0x0", "0x200", "0xa", "0x0",
        ],
      },
      {
        contractAddress: "0x900",
        entrypoint: "clear_minimum",
        calldata: ["0x300", "0x4", "0x0"],
      },
    ]);
  });
});

describe("adapter recipient guard", () => {
  it("compares canonical numeric addresses, not string spelling", () => {
    expect(() => assertRecipientUnlinked("0x0ABC", ["2748"], "receiver"))
      .toThrowError(LinkedRecipientError);
  });

  it.each([
    ["Endur", () => buildEndurStakePlan({
      token: "0x200", endur: "0x500", receiver: "0xabc", amount: 1n, linkedAddresses: linked,
    })],
  ])("refuses a linked %s recipient", (_label, build) => {
    expect(build).toThrowError(LinkedRecipientError);
  });

  it("rejects an Ekubo amount that cannot be represented by i129", () => {
    expect(() => buildEkuboSwapPlan({
      router: "0x900",
      token0: "0x200",
      token1: "0x300",
      routeFee: 7n,
      tickSpacing: 50n,
      tokenIn: "0x200",
      amountIn: 1n << 128n,
      tokenOut: "0x300",
      minimumAmountOut: 1n,
      linkedAddresses: linked,
    })).toThrow(/i129/);
  });

  it("enforces fixed denominations at funding without restricting app spend", () => {
    expect(() => assertFundingDenomination(3n, [1n, 2n, 5n]))
      .toThrowError(FundingDenominationError);
    expect(endurAdapter.plan({ action: "stake", parameters: {
      token: "0x200", endur: "0x500", receiver: "0x400", amount: 3n,
    } }, { linkedAddresses: linked }).input.amount).toBe("0x3");
  });

  it("applies the linked-address guard to Ekubo route addresses", () => {
    expect(() => buildEkuboSwapPlan({
      router: "0xabc", token0: "0x200", token1: "0x300", routeFee: 7n,
      tickSpacing: 50n, tokenIn: "0x200", amountIn: 10n, tokenOut: "0x300",
      minimumAmountOut: 4n, linkedAddresses: linked,
    })).toThrowError(LinkedRecipientError);
  });
});
