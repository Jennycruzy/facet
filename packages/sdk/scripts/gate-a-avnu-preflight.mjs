import { hash, num } from "starknet";

const PAYMASTER_URL = process.env.FACET_PAYMASTER_URL ?? "https://sepolia.paymaster.avnu.fi";
const API_KEY = process.env.FACET_PAYMASTER_API_KEY;
const POOL = process.env.FACET_POOL_ADDRESS
  ?? "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ACCOUNT = "0x7a00bfa75ea68c2baa0d6ef2a10f42905d17f9868bfe2d4424072d06139b135";
const AMOUNT = 500_000_000_000_000_000n;

async function rpc(method, params) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["x-paymaster-api-key"] = API_KEY;
  const response = await fetch(PAYMASTER_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (body.error) {
    const detail = body.error.data === undefined ? "" : `: ${JSON.stringify(body.error.data)}`;
    throw new Error(`${method}: ${body.error.message} (${body.error.code})${detail}`);
  }
  if (body.result === undefined) throw new Error(`${method}: malformed response`);
  return body.result;
}

console.log(`Paymaster: ${PAYMASTER_URL}`);
const available = await rpc("paymaster_isAvailable", {});
console.log(`Available: ${available}`);
if (!available) throw new Error("AVNU reports that the Sepolia paymaster is unavailable.");

if (!API_KEY) {
  throw new Error(
    "Set FACET_PAYMASTER_API_KEY locally, then rerun this preflight. " +
      "No proof was generated and no transaction was submitted.",
  );
}

const amount = { low: AMOUNT & ((1n << 128n) - 1n), high: AMOUNT >> 128n };
const quote = await rpc("paymaster_buildTransaction", {
  transaction: {
    type: "invoke_and_apply_action",
    apply_action: { pool_address: POOL },
    invoke: {
      user_address: ACCOUNT,
      calls: [{
        to: STRK,
        selector: hash.getSelectorFromName("approve"),
        calldata: [POOL, num.toHex(amount.low), num.toHex(amount.high)],
      }],
    },
  },
  parameters: {
    version: "0x1",
    fee_mode: { mode: "sponsored_private", pool_fee_token: STRK, tip: "normal" },
  },
});

if (!quote.fee_action || !quote.typed_data) {
  throw new Error("AVNU accepted the request but returned an incomplete privacy quote.");
}
console.log("Privacy deposit build accepted.");
console.log(`Fee token: ${quote.fee_action.token}`);
console.log(`Fee amount: ${quote.fee_action.amount}`);
console.log(`Fee recipient: ${quote.fee_action.recipient}`);
console.log("Typed data returned: yes");
console.log("Safe to proceed to proof integration: yes");
