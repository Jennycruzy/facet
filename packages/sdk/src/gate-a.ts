/**
 * Facet's first executable operation: fund a predicted shadow account and run one dapp call.
 *
 * The upstream client deliberately keeps note selection inside its prover. The builder therefore
 * queues an OPEN settlement note, a withdrawal to the authoritative predicted address, and the
 * shadow-account invoke in one client operation. CorePrivateTransfersProver resolves the existing
 * UseNote from its persisted registry when it compiles that withdrawal.
 */

export type FeltLike = bigint | number | string;

export type CollectPolicy =
  | { type: "all" }
  | { type: "diff" }
  | { type: "exact"; amount: string };

export type CollectPolicyInput =
  | { type: "all" }
  | { type: "diff" }
  | { type: "exact"; amount: FeltLike };

export interface PrivacyCall {
  contractAddress: string;
  entrypoint: string;
  calldata: FeltLike[];
}

export interface GateAShadowAccount {
  nonce: bigint;
  address: bigint;
  is_deployed: boolean;
}

export interface PrivacyTokenBuilderLike {
  createOpenNote(): PrivacyBuilderLike;
  withdraw(args: { amount: FeltLike; recipient: FeltLike }): PrivacyBuilderLike;
}

export interface PrivacyInvokeBuilderLike {
  addresses(range?: {
    start?: number;
    end?: number;
    untilUndeployed?: boolean;
  }): Promise<GateAShadowAccount[]>;
  invoke(
    nonce: FeltLike,
    options: { calls: PrivacyCall[]; collectPolicy?: CollectPolicy }
  ): PrivacyBuilderLike;
}

export interface PrivacyBuilderLike {
  with(token: FeltLike): PrivacyTokenBuilderLike;
  shadowAccounts(dappName: string): PrivacyInvokeBuilderLike;
}

/** Structural seam for @starkware-libs/starknet-privacy-client's PrivacyClient. */
export interface PrivacyClientLike {
  build(): PrivacyBuilderLike;
}

export interface BuildGateAActionSetOptions {
  /** Token held by the source privacy note and used by the withdrawal/settlement note. */
  token: FeltLike;
  /** Amount withdrawn from the pool to the predicted shadow account. */
  amount: FeltLike;
  /** Dapp namespace used by the anonymizer's identity derivation. */
  dappName: string;
  /** Shadow-account nonce. Gate A uses a small, explicit nonce rather than auto-selection. */
  nonce: FeltLike;
  /** The concrete call(s) executed by the shadow account. */
  calls: PrivacyCall[];
  /** How the shadow account's balance settles into the open note. Defaults to all. */
  collectPolicy?: CollectPolicyInput;
}

export interface GateAActionSet {
  /** The upstream client's queued, not-yet-submitted operation. */
  builder: PrivacyBuilderLike;
  /** The address returned by the anonymizer view for this dapp/nonce. */
  shadowAccount: GateAShadowAccount;
  token: string;
  amount: string;
  nonce: bigint;
}

/** Normalize a felt-like value to the canonical Starknet hex form. */
export function toHexFelt(value: FeltLike): string {
  let normalized: bigint;
  try {
    normalized = BigInt(value);
  } catch {
    throw new TypeError(`Expected a felt-like integer, received ${String(value)}`);
  }
  if (normalized < 0n) throw new RangeError("Felt values must be non-negative");
  return `0x${normalized.toString(16)}`;
}

function toSafeNonce(value: FeltLike): { encoded: string; numeric: number; bigint: bigint } {
  const encoded = toHexFelt(value);
  const bigint = BigInt(encoded);
  if (bigint > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Shadow-account nonce must fit in JavaScript's safe integer range");
  }
  return { encoded, numeric: Number(bigint), bigint };
}

function normalizePolicy(policy: CollectPolicyInput | undefined): CollectPolicy {
  if (!policy || policy.type === "all" || policy.type === "diff") return policy ?? { type: "all" };
  const amount = toHexFelt(policy.amount);
  if (BigInt(amount) <= 0n) throw new RangeError("Exact collect policy amount must be positive");
  return { type: "exact", amount };
}

/**
 * Build Gate A without proving or broadcasting.
 *
 * The address lookup is authoritative: it comes from the anonymizer view rather than a local
 * class-hash calculation, so a class upgrade cannot make the withdrawal target stale.
 */
export async function buildGateAActionSet(
  client: PrivacyClientLike,
  options: BuildGateAActionSetOptions
): Promise<GateAActionSet> {
  if (!options.dappName) throw new Error("dappName is required");
  if (options.calls.length === 0) throw new Error("At least one shadow-account call is required");

  const token = toHexFelt(options.token);
  if (BigInt(token) === 0n) throw new RangeError("token must be non-zero");
  const amount = toHexFelt(options.amount);
  if (BigInt(amount) === 0n) throw new RangeError("amount must be positive");
  const nonce = toSafeNonce(options.nonce);
  const collectPolicy = normalizePolicy(options.collectPolicy);

  const builder = client.build();
  const shadowAccounts = builder.shadowAccounts(options.dappName);
  const accounts = await shadowAccounts.addresses({
    start: nonce.numeric,
    end: nonce.numeric + 1,
    untilUndeployed: false,
  });
  const shadowAccount = accounts.find((candidate) => BigInt(candidate.nonce) === nonce.bigint);
  if (!shadowAccount) {
    throw new Error(`Anonymizer returned no shadow account for nonce ${nonce.bigint}`);
  }

  // Keep this order: the open note must exist before the invoke action is assembled, and the
  // withdrawal is the funding leg that the core SDK covers with the persisted UseNote registry.
  builder.with(token).createOpenNote();
  builder.with(token).withdraw({ amount, recipient: toHexFelt(shadowAccount.address) });
  shadowAccounts.invoke(nonce.encoded, {
    calls: options.calls.map((call) => ({ ...call, calldata: [...call.calldata] })),
    collectPolicy,
  });

  return { builder, shadowAccount, token, amount, nonce: nonce.bigint };
}
