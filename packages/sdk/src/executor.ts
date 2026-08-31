/**
 * The reference {@link FacetExecutor}: the piece that turns an {@link AdapterPlan} into a
 * submittable private transaction.
 *
 * Facet builds calls; it does not prove, screen, or broadcast them. This executor drives the
 * supported Wallet API path, where the wallet owns the shielded state, the proof, the screening
 * attestation and the submission. It exists so that `executeAppIntent` has something concrete to
 * run — before it, every caller had to write this themselves, which meant every caller had to
 * re-derive the settlement invariants below.
 *
 * It is deliberately the *plain invoke* path: the pool withdraws to a Facet-owned helper bound to
 * one protocol, and invokes that helper. It is not a per-application shadow account — see
 * `docs/FINDINGS.md` §6.33 for why that path is not reachable on Mainnet today.
 */

import type { AdapterPlan } from "./adapters.js";
import { assertRecipientUnlinked } from "./adapters.js";
import type { FacetExecutor, FacetRecord } from "./facets.js";
import { toHexFelt, type CollectPolicy, type FeltLike } from "./gate-a.js";

/** The open-note placeholder the wallet substitutes at assembly time. */
export const OPEN_NOTE_PLACEHOLDER = (index: number) => `\${openNoteIds[${index}]}`;

/** A settled note whose amount the wallet fills in from what the interaction actually gained. */
export const OPEN = "OPEN";

export type Strk20Action =
  | { type: "withdraw"; token: string; amount: string; recipient: string }
  | { type: "transfer"; token: string; amount: string; recipient: string }
  | { type: "invoke"; contract: string; calldata: string[] };

/** The subset of the wallet this executor needs. Any get-starknet v6 wallet satisfies it. */
export interface Strk20WalletLike {
  request(message: { type: string; params?: unknown }): Promise<unknown>;
}

/**
 * How one protocol's plan becomes helper calldata. The helper is Facet-owned and bound to a single
 * protocol, so the shape is per-route rather than generic — an adapter that wants to reach a new
 * protocol ships a binding with it.
 */
export interface HelperBinding {
  /** The Facet-owned helper the pool withdraws to and then invokes. */
  helper: string;
  /** Calldata for the helper, using {@link OPEN_NOTE_PLACEHOLDER} for each settled note. */
  calldata(plan: AdapterPlan): readonly FeltLike[];
}

export class ExecutorPolicyError extends Error {
  readonly code = "executor_policy" as const;
  constructor(message: string) {
    super(message);
    this.name = "ExecutorPolicyError";
  }
}

/**
 * The policy every route must satisfy. It is declared per route rather than per adapter so that a
 * new adapter cannot reach Mainnet without someone stating, explicitly, which assets it may touch,
 * how much it may move, and whether what it receives can be swept back into shielded notes.
 */
export interface RoutePolicy {
  /** Every token the plan names — input and settlements — must appear here. */
  supportedAssets: readonly FeltLike[];
  /** Inclusive bounds on the input amount. */
  amountBounds: { min: FeltLike; max: FeltLike };
  /**
   * How each settled asset behaves on the way out. `fungible` may be settled back into shielded
   * notes; `exit-required` names a persistent protocol position — vault shares, LP, debt, an NFT,
   * a queue ticket — which is received but is *not* automatically recoverable. See FINDINGS 6.34.
   */
  assetKinds: Readonly<Record<string, "fungible" | "exit-required">>;
}

export interface WalletExecutorOptions {
  wallet: Strk20WalletLike;
  /** The connected account whose shielded balance receives the settled notes. */
  owner: string;
  binding: HelperBinding;
  /** Addresses already linked to this user; every public recipient is checked against them. */
  linkedAddresses?: readonly FeltLike[];
  policy: RoutePolicy;
}

/**
 * Builds the action list for a plan and checks the invariants that a hand-written action list has
 * to get right every time:
 *
 * 1. the pool withdraws the input to the bound helper and to nothing else;
 * 2. one `OPEN` transfer exists per settlement, because the wallet fills open notes positionally
 *    and a mismatch silently misassigns the proceeds;
 * 3. the helper calldata references exactly those open notes, in order;
 * 4. no public call in the plan names an address linked to this user;
 * 5. every token the plan names is one the route declared it supports;
 * 6. the input amount is inside the route's declared bounds;
 * 7. every settled asset has a declared kind, and an `exit-required` asset is never collected with
 *    an `all` policy — `all` on an account still holding a position sweeps balances the interaction
 *    did not produce.
 *
 * Settlement recipients are *not* checked against the linked set: an `OPEN` transfer credits the
 * user's own shielded balance inside the pool, so naming the owner there is correct and reveals
 * nothing. Only the plan's own calls reach Starknet in the clear.
 */
export function buildWalletActions(
  plan: AdapterPlan,
  options: Omit<WalletExecutorOptions, "wallet">,
): Strk20Action[] {
  const helper = toHexFelt(options.binding.helper);
  const linked = options.linkedAddresses ?? [];
  const policy = options.policy;

  const supported = new Set(policy.supportedAssets.map((asset) => toHexFelt(asset)));
  const named = [plan.input.token, ...plan.settlements.map((settlement) => settlement.token)];
  for (const token of named) {
    if (!supported.has(toHexFelt(token))) {
      throw new ExecutorPolicyError(
        `${plan.protocol}: token ${toHexFelt(token)} is not a supported asset for this route.`,
      );
    }
  }

  const amount = BigInt(toHexFelt(plan.input.amount));
  const min = BigInt(toHexFelt(policy.amountBounds.min));
  const max = BigInt(toHexFelt(policy.amountBounds.max));
  if (amount < min || amount > max) {
    throw new ExecutorPolicyError(
      `${plan.protocol}: input ${amount} is outside the route's bounds [${min}, ${max}].`,
    );
  }

  for (const settlement of plan.settlements) {
    const token = toHexFelt(settlement.token);
    const kind = policy.assetKinds[token];
    if (!kind) {
      throw new ExecutorPolicyError(
        `${plan.protocol}: settled asset ${token} has no declared kind. Classify it as "fungible" ` +
        `or "exit-required" before this route can run.`,
      );
    }
    if (kind === "exit-required" && settlement.policy.type === "all") {
      throw new ExecutorPolicyError(
        `${plan.protocol}: ${token} is a persistent position and cannot be collected with an "all" ` +
        `policy; "all" sweeps balances this interaction did not produce.`,
      );
    }
  }

  if (plan.settlements.length === 0) {
    throw new ExecutorPolicyError(`${plan.protocol}: a plan must settle at least one token.`);
  }
  for (const call of plan.calls) {
    assertRecipientUnlinked(call.contractAddress, linked, `${plan.protocol} call target`);
  }

  const calldata = options.binding.calldata(plan).map((value) =>
    typeof value === "string" && value.startsWith("${") ? value : toHexFelt(value),
  );
  const referenced = calldata.filter((item) => item.startsWith("${openNoteIds["));
  const expected = plan.settlements.map((_, index) => OPEN_NOTE_PLACEHOLDER(index));
  if (referenced.length !== expected.length || referenced.some((item, i) => item !== expected[i])) {
    throw new ExecutorPolicyError(
      `${plan.protocol}: helper calldata references ${JSON.stringify(referenced)}, but the plan ` +
      `settles ${plan.settlements.length} token(s) and so needs ${JSON.stringify(expected)}.`,
    );
  }

  return [
    { type: "withdraw", token: toHexFelt(plan.input.token), amount: toHexFelt(plan.input.amount),
      recipient: helper },
    ...plan.settlements.map((settlement) => ({
      type: "transfer" as const,
      token: toHexFelt(settlement.token),
      amount: OPEN,
      recipient: toHexFelt(options.owner),
    })),
    { type: "invoke", contract: helper, calldata },
  ];
}

/** The shipped {@link FacetExecutor}. Proves and submits nothing itself; the wallet does both. */
export class WalletFacetExecutor implements FacetExecutor {
  constructor(private readonly options: WalletExecutorOptions) {}

  actions(plan: AdapterPlan): Strk20Action[] {
    return buildWalletActions(plan, this.options);
  }

  /** Dry run: the wallet proves with an empty proof and does not broadcast. */
  async simulate(plan: AdapterPlan): Promise<unknown> {
    return this.options.wallet.request({
      type: "wallet_strk20PrepareInvoke",
      params: { actions: this.actions(plan), simulate: true },
    });
  }

  async execute(plan: AdapterPlan, _facet: FacetRecord): Promise<{ transactionHash: string }> {
    const result = await this.options.wallet.request({
      type: "wallet_strk20InvokeTransaction",
      params: { actions: this.actions(plan) },
    }) as { transaction_hash?: unknown } | undefined;
    const transactionHash = result?.transaction_hash;
    if (typeof transactionHash !== "string" || !transactionHash) {
      throw new Error("The wallet returned no transaction hash.");
    }
    return { transactionHash };
  }
}

/** Helper binding for the deployed Ekubo swap helper (`IEkuboSwapAnonymizer::privacy_invoke`). */
export function ekuboHelperBinding(options: {
  helper: string; router: string; token0: FeltLike; token1: FeltLike;
  fee: FeltLike; tickSpacing: FeltLike; skipAhead?: FeltLike;
}): HelperBinding {
  return {
    helper: options.helper,
    calldata(plan) {
      const minimum = plan.calls.at(-1)?.calldata.slice(-2) ?? [];
      return [
        options.router,
        plan.input.token, plan.input.amount, 0,
        options.token0, options.token1, options.fee, options.tickSpacing, 0,
        ...minimum,
        options.skipAhead ?? 0,
        // The deployed helper's `privacy_invoke` takes exactly one `note_id`. A plan that declares
        // more settlements than the helper can settle is rejected by buildWalletActions rather than
        // silently truncated here.
        OPEN_NOTE_PLACEHOLDER(0),
      ];
    },
  };
}

/** Helper binding for the deployed ERC-4626 helper (`IFacetErc4626Anonymizer::privacy_invoke`). */
export function erc4626HelperBinding(options: {
  helper: string; operation: "deposit" | "withdraw";
}): HelperBinding {
  return {
    helper: options.helper,
    calldata(plan) {
      const settlement = plan.settlements[0];
      if (!settlement) throw new ExecutorPolicyError("ERC-4626 plan settles no token.");
      return [
        options.operation === "deposit" ? 0 : 1,
        plan.input.token, settlement.token,
        plan.input.amount, 0,
        OPEN_NOTE_PLACEHOLDER(0),
      ];
    },
  };
}

export type { CollectPolicy };
