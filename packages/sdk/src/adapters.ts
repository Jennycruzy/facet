import {
  toHexFelt,
  type CollectPolicy,
  type FeltLike,
  type PrivacyCall,
} from "./gate-a.js";

const U128_LIMIT = 1n << 128n;
const U256_LIMIT = 1n << 256n;
const U128_MASK = U128_LIMIT - 1n;

export class LinkedRecipientError extends Error {
  readonly code: "linked_recipient" = "linked_recipient";
  readonly recipient: string;
  readonly field: string;

  constructor(field: string, recipient: string) {
    super(`Refusing ${field}: ${recipient} is linked to this user's portfolio.`);
    this.name = "LinkedRecipientError";
    this.field = field;
    this.recipient = recipient;
  }
}

export class FundingDenominationError extends Error {
  readonly code: "invalid_funding_denomination" = "invalid_funding_denomination";

  constructor(readonly amount: string, readonly allowed: readonly string[]) {
    super(`Funding amount ${amount} is not an allowed fixed denomination.`);
    this.name = "FundingDenominationError";
  }
}

export interface AdapterContext {
  /** Wallets, funders, recovery accounts, and other addresses already linked to the user. */
  linkedAddresses: readonly FeltLike[];
}

export interface AppIntent<TAction extends string = string, TParameters = unknown> {
  action: TAction;
  parameters: TParameters;
}

/** One intentionally small integration surface shared by every supported protocol. */
export interface ProtocolAdapter<TIntent extends AppIntent = AppIntent> {
  readonly id: string;
  plan(intent: TIntent, context: AdapterContext): AdapterPlan;
}

export interface AdapterSettlement {
  token: string;
  policy: CollectPolicy;
  reason: string;
}

export interface AdapterPlan {
  protocol: string;
  calls: PrivacyCall[];
  input: {
    token: string;
    amount: string;
  };
  settlements: AdapterSettlement[];
}

function fixedDenomination(amount: FeltLike, allowed: readonly FeltLike[]): string {
  const normalized = felt(amount, "funding amount");
  const denominations = allowed.map((value) => felt(value, "funding denomination"));
  if (denominations.length === 0 || !denominations.some((value) => BigInt(value) === BigInt(normalized))) {
    throw new FundingDenominationError(normalized, denominations);
  }
  return normalized;
}

/** Enforce shared denominations at the pool-funding boundary, independently of app spend size. */
export function assertFundingDenomination(amount: FeltLike, allowed: readonly FeltLike[]): string {
  return fixedDenomination(amount, allowed);
}

function integer(value: FeltLike, label: string): bigint {
  try {
    return BigInt(toHexFelt(value));
  } catch (error) {
    throw new TypeError(`${label} must be a non-negative integer: ${String(error)}`);
  }
}

function felt(value: FeltLike, label: string): string {
  try {
    return toHexFelt(value);
  } catch (error) {
    throw new TypeError(`${label} must be a non-negative felt: ${String(error)}`);
  }
}

function address(value: FeltLike, label: string): string {
  const normalized = felt(value, label);
  if (BigInt(normalized) === 0n) throw new RangeError(`${label} must be non-zero`);
  return normalized;
}

function u128(value: FeltLike, label: string, positive = false): string {
  const normalized = felt(value, label);
  const numeric = BigInt(normalized);
  if (numeric >= U128_LIMIT) throw new RangeError(`${label} must fit in u128`);
  if (positive && numeric === 0n) throw new RangeError(`${label} must be positive`);
  return normalized;
}

function positiveU256(value: FeltLike, label: string): { normalized: string; calldata: string[] } {
  const normalized = felt(value, label);
  const numeric = BigInt(normalized);
  if (numeric === 0n) throw new RangeError(`${label} must be positive`);
  if (numeric >= U256_LIMIT) throw new RangeError(`${label} must fit in u256`);
  return {
    normalized,
    calldata: [`0x${(numeric & U128_MASK).toString(16)}`, `0x${(numeric >> 128n).toString(16)}`],
  };
}

function u256(value: FeltLike, label: string): string[] {
  const numeric = integer(value, label);
  if (numeric >= U256_LIMIT) throw new RangeError(`${label} must fit in u256`);
  return [`0x${(numeric & U128_MASK).toString(16)}`, `0x${(numeric >> 128n).toString(16)}`];
}

function positiveI129(value: FeltLike, label: string): { normalized: string; calldata: string[] } {
  const normalized = felt(value, label);
  const numeric = BigInt(normalized);
  if (numeric === 0n) throw new RangeError(`${label} must be positive`);
  if (numeric >= U128_LIMIT) throw new RangeError(`${label} i129 magnitude must fit in u128`);
  // Ekubo's i129 sign is false for a positive amount.
  return { normalized, calldata: [normalized, "0x0"] };
}

function unlinkedRecipient(
  value: FeltLike,
  field: string,
  linkedAddresses: readonly FeltLike[],
): string {
  const normalized = address(value, field);
  const recipient = BigInt(normalized);
  for (const linked of linkedAddresses) {
    if (BigInt(felt(linked, "linked address")) === recipient) {
      throw new LinkedRecipientError(field, normalized);
    }
  }
  return normalized;
}

/**
 * Refuse a public recipient that is already known to belong to this user.
 *
 * Callers should pass the connected wallet, every address that funded this user's private
 * pool, and every other context account. The guard is intentionally reusable by adapters
 * whose protocol call names the recipient as `user`, `receiver`, or another field.
 */
export function assertRecipientUnlinked(
  recipient: FeltLike,
  linkedAddresses: readonly FeltLike[],
  field = "recipient",
): string {
  return unlinkedRecipient(recipient, field, linkedAddresses);
}

/** Build an ERC-20 `approve(spender, amount)` call with canonical u256 calldata. */
export function buildErc20ApproveCall(options: {
  token: FeltLike;
  spender: FeltLike;
  amount: FeltLike;
}): PrivacyCall {
  const token = address(options.token, "token");
  const spender = address(options.spender, "spender");
  return {
    contractAddress: token,
    entrypoint: "approve",
    calldata: [spender, ...u256(options.amount, "approval amount")],
  };
}

export interface BuildEndurStakePlanOptions {
  token: FeltLike;
  endur: FeltLike;
  receiver: FeltLike;
  amount: FeltLike;
  linkedAddresses: readonly FeltLike[];
}

/** Build Endur's ERC-4626-shaped stake path: STRK approval followed by `deposit`. */
export function buildEndurStakePlan(options: BuildEndurStakePlanOptions): AdapterPlan {
  const token = address(options.token, "Endur input token");
  const endur = address(options.endur, "Endur xSTRK contract");
  const receiver = unlinkedRecipient(options.receiver, "Endur receiver", options.linkedAddresses);
  const amount = positiveU256(options.amount, "Endur stake amount");

  return {
    protocol: "endur",
    calls: [
      buildErc20ApproveCall({ token, spender: endur, amount: amount.normalized }),
      {
        contractAddress: endur,
        entrypoint: "deposit",
        calldata: [...amount.calldata, receiver],
      },
    ],
    input: { token, amount: amount.normalized },
    settlements: [
      {
        token,
        policy: { type: "diff" },
        reason: "Return unused input-token balance without sweeping an earlier context balance.",
      },
      {
        token: endur,
        policy: { type: "diff" },
        reason: "The stake produces xSTRK, so settle the output token independently from STRK.",
      },
    ],
  };
}

export interface EkuboRouteOptions {
  router: FeltLike;
  token0: FeltLike;
  token1: FeltLike;
  routeFee: FeltLike;
  tickSpacing: FeltLike;
  tokenIn: FeltLike;
  amountIn: FeltLike;
  extension?: FeltLike;
}

export interface BuildEkuboSwapPlanOptions extends EkuboRouteOptions {
  tokenOut: FeltLike;
  minimumAmountOut: FeltLike;
  linkedAddresses: readonly FeltLike[];
}

function ekuboRouteCalldata(options: EkuboRouteOptions): {
  router: string;
  token0: string;
  token1: string;
  tokenIn: string;
  amountIn: { normalized: string; calldata: string[] };
  calldata: string[];
} {
  const router = address(options.router, "Ekubo router");
  const token0 = address(options.token0, "Ekubo token0");
  const token1 = address(options.token1, "Ekubo token1");
  if (BigInt(token0) >= BigInt(token1)) {
    throw new RangeError("Ekubo token0 must be numerically lower than token1");
  }
  const tokenIn = address(options.tokenIn, "Ekubo input token");
  if (tokenIn !== token0 && tokenIn !== token1) {
    throw new RangeError("Ekubo input token must be token0 or token1");
  }
  const routeFee = u128(options.routeFee, "Ekubo route fee");
  const tickSpacing = u128(options.tickSpacing, "Ekubo tick spacing", true);
  const extension = options.extension === undefined
    ? "0x0"
    : felt(options.extension, "Ekubo extension");
  const amountIn = positiveI129(options.amountIn, "Ekubo input amount");

  // RouteNode { pool_key, sqrt_ratio_limit: u256, skip_ahead: u128 }
  // TokenAmount { token, amount: i129 }.
  const calldata = [
    token0,
    token1,
    routeFee,
    tickSpacing,
    extension,
    "0x0",
    "0x0",
    "0x0",
    tokenIn,
    ...amountIn.calldata,
  ];
  return { router, token0, token1, tokenIn, amountIn, calldata };
}

/** Build a read-only Ekubo `quote_swap` call for the same route used by the swap plan. */
export function buildEkuboQuoteCall(options: EkuboRouteOptions): PrivacyCall {
  const route = ekuboRouteCalldata(options);
  return {
    contractAddress: route.router,
    entrypoint: "quote_swap",
    calldata: route.calldata,
  };
}

/**
 * Build the tested Ekubo single-hop path: transfer input to the router, swap, then clear the
 * output token only when it meets the caller's quoted minimum.
 */
export function buildEkuboSwapPlan(options: BuildEkuboSwapPlanOptions): AdapterPlan {
  // Ekubo's reviewed route has no user-selected public receiver. Still validate every address
  // named by the intent so adding a receiver later cannot silently bypass the shared guard.
  for (const [field, value] of [["Ekubo router", options.router], ["Ekubo token0", options.token0],
    ["Ekubo token1", options.token1]] as const) {
    assertRecipientUnlinked(value, options.linkedAddresses, field);
  }
  const route = ekuboRouteCalldata(options);
  const tokenOut = address(options.tokenOut, "Ekubo output token");
  if (tokenOut === route.tokenIn) throw new RangeError("Ekubo output token must differ from input token");
  if (tokenOut !== route.token0 && tokenOut !== route.token1) {
    throw new RangeError("Ekubo output token must be token0 or token1");
  }
  const minimumAmountOut = positiveU256(options.minimumAmountOut, "Ekubo minimum output");

  return {
    protocol: "ekubo",
    calls: [
      {
        contractAddress: route.tokenIn,
        entrypoint: "transfer",
        calldata: [route.router, ...u256(route.amountIn.normalized, "Ekubo input amount")],
      },
      {
        contractAddress: route.router,
        entrypoint: "swap",
        calldata: route.calldata,
      },
      {
        contractAddress: route.router,
        entrypoint: "clear_minimum",
        calldata: [tokenOut, ...minimumAmountOut.calldata],
      },
    ],
    input: { token: route.tokenIn, amount: route.amountIn.normalized },
    // One settlement, because this route is an exact-input single hop: the whole input is
    // transferred to the router and consumed by the swap, so there is no input-token remainder to
    // clear. Confirmed on Mainnet in 0x2d3c449e… — the full 0.1 STRK reached the router and the
    // swap's reported input delta equalled it exactly — and matched by the deployed helper, whose
    // `privacy_invoke` accepts exactly one `note_id`. A multi-hop or exact-output route would
    // settle differently and must not reuse this builder unchanged. See FINDINGS 6.35.
    settlements: [
      {
        token: tokenOut,
        policy: { type: "diff" },
        reason: "Settle the output-token delta without sweeping an earlier context balance.",
      },
    ],
  };
}

export type EndurStakeIntent = AppIntent<"stake", Omit<BuildEndurStakePlanOptions,
  "linkedAddresses">>;
export type EkuboSwapIntent = AppIntent<"swap", Omit<BuildEkuboSwapPlanOptions,
  "linkedAddresses">>;

export const endurAdapter: ProtocolAdapter<EndurStakeIntent> = {
  id: "endur",
  plan(intent, context) {
    if (intent.action !== "stake") throw new TypeError("Endur supports only the stake intent.");
    return buildEndurStakePlan({ ...intent.parameters, ...context });
  },
};

export const ekuboAdapter: ProtocolAdapter<EkuboSwapIntent> = {
  id: "ekubo",
  plan(intent, context) {
    if (intent.action !== "swap") throw new TypeError("Ekubo supports only the swap intent.");
    return buildEkuboSwapPlan({ ...intent.parameters, ...context });
  },
};
