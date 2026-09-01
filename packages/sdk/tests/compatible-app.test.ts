import { describe, expect, it, vi } from "vitest";
import { runCompatibleApp } from "../examples/compatible-app.js";

const STRK = "0x200";
const XSTRK = "0x500";
const HELPER = "0x400";
const OWNER = "0xabc";

describe("compatible application example", () => {
  it("uses the public intent-to-executor boundary and returns the wallet hash", async () => {
    const request = vi.fn().mockResolvedValue({ transaction_hash: "0xexample" });
    const result = await runCompatibleApp({
      wallet: { request }, owner: OWNER, token: STRK, applicationToken: XSTRK,
      helper: HELPER, amount: 9n, maxAmount: 100n,
    });

    expect(result).toEqual({ transactionHash: "0xexample" });
    expect(request).toHaveBeenCalledWith({
      type: "wallet_strk20InvokeTransaction",
      params: { actions: [
        { type: "withdraw", token: STRK, amount: "0x9", recipient: HELPER },
        { type: "transfer", token: XSTRK, amount: "OPEN", recipient: OWNER },
        { type: "invoke", contract: HELPER, calldata: [
          "0x0", STRK, XSTRK, "0x9", "0x0", "${openNoteIds[0]}",
        ] },
      ] },
    });
  });
});
