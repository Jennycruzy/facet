// The browser half of Facet's single execution path.
//
// Both Mainnet route pages used to build their own Ready X action list inline. They now describe a
// *plan* — what goes in, what comes back, which calls run — and this module turns any plan into the
// action list, applying the same policy the SDK's WalletFacetExecutor applies. The two
// implementations are pinned to each other by tests/executor-parity.test.mjs, so a change to one
// that is not made to the other fails the suite rather than reaching Mainnet.
//
// The web package ships without a build step or dependencies, which is why this is a mirror rather
// than an import of @facet/sdk. The parity test is what makes the mirror trustworthy.

export const OPEN = "OPEN";
export const OPEN_NOTE_PLACEHOLDER = (index) => "${openNoteIds[" + index + "]}";

export class ExecutorPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExecutorPolicyError";
    this.code = "executor_policy";
  }
}

const felt = (value) => "0x" + BigInt(value).toString(16);

/**
 * Turns a plan into the reviewed Ready X action list.
 *
 * Invariants, in the order they are checked:
 *  1. every token the plan names is one the route declared it supports;
 *  2. the input amount is inside the route's declared bounds;
 *  3. every settled asset has a declared kind, and an `exit-required` asset is never collected
 *     with an `all` policy;
 *  4. no explicit public recipient in the plan is linked to this user;
 *  5. one OPEN transfer exists per settlement, because the wallet fills open notes positionally;
 *  6. the helper calldata references exactly those open notes, in order.
 *
 * Settlement recipients are deliberately not checked against the linked set: an OPEN transfer
 * credits the user's own shielded balance inside the pool, so naming the owner there reveals
 * nothing. Only the plan's calls reach Starknet in the clear.
 */
export function buildWalletActions(plan, options) {
  const helper = felt(options.binding.helper);
  if (!Array.isArray(options.linkedAddresses)) {
    throw new ExecutorPolicyError(plan.protocol + ": linkedAddresses must be declared explicitly.");
  }
  const linked = options.linkedAddresses.map(felt);
  const policy = options.policy;

  const supported = new Set(policy.supportedAssets.map(felt));
  const assetKinds = new Map(
    Object.entries(policy.assetKinds).map(([asset, kind]) => [felt(asset), kind]),
  );
  for (const token of [plan.input.token, ...plan.settlements.map((s) => s.token)]) {
    if (!supported.has(felt(token))) {
      throw new ExecutorPolicyError(
        plan.protocol + ": token " + felt(token) + " is not a supported asset for this route.",
      );
    }
  }

  const amount = BigInt(plan.input.amount);
  const min = BigInt(policy.amountBounds.min);
  const max = BigInt(policy.amountBounds.max);
  if (amount < min || amount > max) {
    throw new ExecutorPolicyError(
      plan.protocol + ": input " + amount + " is outside the route's bounds [" + min + ", " + max + "].",
    );
  }

  for (const settlement of plan.settlements) {
    const token = felt(settlement.token);
    const kind = assetKinds.get(token);
    if (!kind) {
      throw new ExecutorPolicyError(
        plan.protocol + ": settled asset " + token + " has no declared kind. Classify it as "
        + '"fungible" or "exit-required" before this route can run.',
      );
    }
    if (kind === "exit-required" && settlement.policy.type === "all") {
      throw new ExecutorPolicyError(
        plan.protocol + ": " + token + " is a persistent position and cannot be collected with an "
        + '"all" policy; "all" sweeps balances this interaction did not produce.',
      );
    }
  }

  if (plan.settlements.length === 0) {
    throw new ExecutorPolicyError(plan.protocol + ": a plan must settle at least one token.");
  }
  if (!Array.isArray(plan.publicRecipients)) {
    throw new ExecutorPolicyError(plan.protocol + ": publicRecipients must be declared explicitly.");
  }
  for (const recipient of plan.publicRecipients) {
    if (linked.includes(felt(recipient.address))) {
      throw new ExecutorPolicyError(
        "Refusing " + recipient.field + ": " + felt(recipient.address)
        + " is linked to this user's portfolio.",
      );
    }
  }

  const calldata = options.binding.calldata(plan).map((value) =>
    typeof value === "string" && value.startsWith("${") ? value : felt(value),
  );
  const referenced = calldata.filter((item) => item.startsWith("${openNoteIds["));
  const expected = plan.settlements.map((_, index) => OPEN_NOTE_PLACEHOLDER(index));
  if (referenced.length !== expected.length || referenced.some((item, i) => item !== expected[i])) {
    throw new ExecutorPolicyError(
      plan.protocol + ": helper calldata references " + JSON.stringify(referenced) + ", but the plan settles "
      + plan.settlements.length + " token(s) and so needs " + JSON.stringify(expected) + ".",
    );
  }

  return [
    { type: "withdraw", token: felt(plan.input.token), amount: felt(plan.input.amount), recipient: helper },
    ...plan.settlements.map((settlement) => ({
      type: "transfer",
      token: felt(settlement.token),
      amount: OPEN,
      recipient: felt(options.owner),
    })),
    { type: "invoke", contract: helper, calldata },
  ];
}

/** Binding for the deployed Ekubo swap helper (`IEkuboSwapAnonymizer::privacy_invoke`). */
export function ekuboHelperBinding(options) {
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
        // The deployed helper takes exactly one note_id; a plan declaring more is rejected above.
        OPEN_NOTE_PLACEHOLDER(0),
      ];
    },
  };
}

/**
 * Vaults whose ERC-4626 `redeem` does not return the underlying in the same transaction. The
 * helper asserts a non-zero output balance delta, so a queued redemption reverts the whole invoke.
 */
export const QUEUED_REDEMPTION_VAULTS = {
  // Endur xSTRK: `redeem` burns shares and mints an ERC-721 withdrawal-queue ticket. FINDINGS 6.34.
  "0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a":
    "Endur xSTRK redeems through an ERC-721 withdrawal queue, so no underlying arrives in the "
    + "same transaction. Exit the position on a secondary market instead.",
};

/**
 * Binding for the deployed ERC-4626 helper (`IFacetErc4626Anonymizer::privacy_invoke`).
 *
 * A `withdraw` binding must name its vault: whether redemption settles synchronously is a property
 * of the vault, not of this helper. A queued vault is refused here rather than on chain.
 */
export function erc4626HelperBinding(options) {
  if (options.operation === "withdraw") {
    if (options.vault === undefined) {
      throw new ExecutorPolicyError(
        "A withdraw binding must name its vault so its redemption mode can be checked.",
      );
    }
    const reason = QUEUED_REDEMPTION_VAULTS[felt(options.vault)];
    if (reason) {
      throw new ExecutorPolicyError("Refusing a withdraw binding for " + felt(options.vault) + ": " + reason);
    }
  }
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

/** Submits a plan through the wallet. Facet proves and broadcasts nothing itself. */
export async function submitPlan(wallet, plan, options) {
  const result = await wallet.request({
    type: "wallet_strk20InvokeTransaction",
    params: { actions: buildWalletActions(plan, options) },
  });
  const transactionHash = result?.transaction_hash;
  if (typeof transactionHash !== "string" || !transactionHash) {
    throw new Error("The wallet returned no transaction hash.");
  }
  return transactionHash;
}
