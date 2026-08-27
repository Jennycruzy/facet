# Shadow accounts: the implementation guide

Shadow accounts are the account-separation primitive underneath Facet's private account
and portfolio layer. They let one shielded portfolio present a different deterministic
Starknet account to each application context.

The upstream public documentation is brief. This document supplies the missing engineering
detail, assembled by reading the source, decoding mainnet invocations, and executing the
sequence. For the user-facing product model, start with [`PRODUCT.md`](PRODUCT.md).

Everything here is traceable to `FINDINGS.md`, which carries the file:line and block
references. Where the two disagree, `FINDINGS.md` is authoritative — it is checked against
source and chain, this is prose.

---

## 1. What a shadow account is

A shadow account is a contract account that acts on your behalf, whose address is derived
from a secret you never reveal. You hold one shielded balance in the privacy pool; from it
you can materialise an account per application or strategy. The private funding path does
not publish the link to you or to another facet, but public behaviour, amounts, timing,
recipients, and downstream protocol state can still create a link.

The anonymizer is live on mainnet at
`0x4f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7`, deployed at block
12,199,879 on 23 July 2026. Its pool is `0x0403…812a`.

## 2. Identity derivation

```
identity_key = poseidon(IDENTITY_KEY_TAG:V1, user_addr, user_private_key, anonymizer_addr)
partial      = poseidon(identity_key, dapp_name)
commitment   = poseidon(partial, nonce)
```

Three things follow, and each has practical consequences.

**It is derived inside the proved execution.** `user_private_key` is an input to a virtual
execution that is then proved; it never reaches public calldata. This is the property the
whole design rests on.

**It is bound to the anonymizer address.** Identities derived at a self-deployed anonymizer
are unlinkable to identities derived at the official one — the same user, the same key and
the same `dapp_name` produce different accounts. If you deploy your own anonymizer, your
fork tests must cover *your* class hash; results against the official deployment do not
transfer.

**`dapp_name` is the compartment and `nonce` is the rotation.** One identity per dapp is a
choice the derivation makes easy, not one the contract enforces.

## 3. The two-tier action model — the trap that costs days

`apply_actions` takes `Span<ServerAction>`, **not** `ClientAction`. These are different
types and the distinction is documented nowhere.

`ClientAction`s are what you build. They run inside a virtual Starknet OS execution which is
then proved. `ComputeAndInvoke` — a client action — becomes `ServerAction::InvokeWithComputation`
on chain. This indirection is precisely why `user_private_key` never appears in public
calldata, and it is the single most confusing thing about the primitive on first contact.

Actions execute in phase order, and the ordering is load-bearing:

| Phase | Action |
|---|---|
| 0 | `ACCOUNT_PHASE` — `SetViewingKey` |
| 4 | `UseNote` |
| 6 | `WITHDRAW_PHASE` |
| 7 | `INVOKE_PHASE` |

Because withdrawal precedes invocation, a single transaction can fund an account that does
not exist yet and then act as it. Section 5 is that pattern.

## 4. The interface

```cairo
fn privacy_invoke_with_computation(
    ref self: T,
    identity_commitment: IdentityCommitment,
    calls: Array<Call>,
    open_notes: Span<OpenNote>,
) -> Span<OpenNoteDeposit>;
```

```cairo
pub enum CollectPolicy {
    All,          // collect the entire token balance
    Diff,         // collect only the balance gained this interaction
    Exact: u128,  // collect exactly this amount
}
```

**Pass at most one note per token.** A second note for the same token overwrites the first
approval and the transaction fails later, inside the privacy contract, with an error that
does not name the cause. Enforce this in your own types; the contract will not help you.

**`calls` is plural, and that matters.** `test_multiple_invokes_run_in_one_call` passes two
calls in one `Array<Call>`; both execute as the shadow account and their outputs combine
into a single deposit. So "one invoke action per transaction" does **not** mean one dapp
call per transaction — approve-then-swap fits comfortably. The real limit is one
`identity_commitment` per action: acting as *two different facets* requires two
transactions.

Reverts you will meet: `UNAUTHORIZED_CALLER` (the caller is not the configured privacy
contract), `ZERO_BALANCE`, `NEGATIVE_DIFF`, `INSUFFICIENT_BALANCE`, `AMOUNT_OVERFLOW`.

## 5. The funding gap, and the pattern that closes it

**`privacy_invoke_with_computation` moves no tokens into the shadow account.** It asserts
the caller, resolves or deploys the account, snapshots balances, executes the calls, and
collects. Nothing more. So the account must already hold funds when the calls run, and
getting them there is the entire problem.

There are two answers, and the choice between them is the privacy decision.

### 5.1 The public answer: pre-approval

Seven mainnet transactions do it this way. An externally owned, funded account issues a
public `approve` naming the shadow account as spender; the shadow account's first call is a
`transfer_from` pulling the funds in; `CollectPolicy::Diff` settles the gain into a note.

It works. It also **publicly ties a real, funded address to the facet in the same receipt** —
which defeats the purpose. If you do nothing else, do not do this.

### 5.2 The private answer: withdraw from a shielded note

```
UseNote → Withdraw (to the predicted address) → ComputeAndInvoke
```

Valid because of three independent facts:

1. `WithdrawInput.to_addr` is asserted only to be non-zero. A withdrawal may target any
   address, including one where no contract exists yet.
2. The shadow account's address is derivable before deployment. `get_shadow_accounts`
   predicts it with
   `calculate_contract_address_from_deploy_syscall(salt: commitment, class_hash, [], deployer)`,
   and `get_or_deploy_shadow_account` deploys with identical parameters — so prediction and
   deployment agree by construction, not by luck.
3. `WITHDRAW_PHASE` (6) precedes `INVOKE_PHASE` (7).

The funding leg's sender is the pool. No personal address appears anywhere in it.

**Before 25 August 2026, this sequence had not been executed by this project.** It was
then executed twice on Sepolia; the transactions and their event-level decode are
`FINDINGS.md` §§6.17–6.18.

### 5.3 The empty-constructor requirement

Address derivation passes `constructor_calldata: array![].span()`. **Any constructor argument
on your account class breaks deterministic addressing and therefore breaks the entire funding
pattern.** If your account needs a signer key, set it write-once on first use, owner-gated —
not in a constructor.

## 6. What leaks

State this before anyone asks.

- **The funding amount is public.** The withdrawal names the token and the exact amount in
  the clear. Distinctive or repeated amounts correlate facets with each other regardless of
  the cryptography.
- **Timing is public.** Two facets funded seconds apart, for identical amounts, are
  correlated in practice.
- **The shadow account's address and activity are public.** What is hidden is *whose* it is,
  not *that it exists*.
- **The dapp call is public.** If the call itself names you — sending to your own address,
  for instance — the receipt links the facet to you no matter how private the funding was.
  This is easy to do by accident in a smoke test. Facet's first Sepolia smoke test did
  exactly that; the second facet used `facet-second` and sent its 1 wei call to
  `0x…dead` instead. See `FINDINGS.md` §§6.17–6.18.
- **A reverting dapp call takes the whole invoke down.** The pool applies actions through
  `call_contract_syscall(...).unwrap_syscall()`, so the panic propagates out of
  `apply_actions` and the same-transaction `Withdraw` reverts with it. Nothing strands on
  this path. Funding and invoking in *separate* transactions can leave a balance sitting —
  recoverable, because a commitment resolves to the same address permanently, so an already
  deployed and emptied account still sweeps a later top-up in full.
- **The official anonymizer is upgradeable** via `ReplaceabilityComponent` with
  `upgrade_delay: 0`. No timelock. Whoever holds the role can replace the implementation, and
  that is true of StarkWare's deployment, not only of forks.

## 7. Registration, which is not optional

A sender that has never set a viewing key is absent from the pool's registry, and the pool
rejects the **entire transaction** with `SENDER_NOT_REGISTERED`. The failure surfaces inside
the prover, *after* the proof work has already been spent — minutes wasted per attempt.

Registration is `SetViewingKey`, which is `ACCOUNT_PHASE` (0), earlier than use-note,
withdraw and invoke. It is still part of a proved `apply_actions` transaction; it is not a
proof-free public registration. The same is true of a private note deposit. The deployed pool
does not expose a public write that lets this path avoid the prover.

For an already registered account, registration can be included in the same action set as
the rest of the private sequence. The current Mainnet runner deliberately submits registration
as a separate **proved** transaction when the account is new: the compiler cannot read the
deferred registry write while compiling the later self-channel setup, and combining them
produces `SENDER_NOT_REGISTERED`. That is an implementation constraint of the current route,
not evidence that registration is cheap or proof-free.

## 8. Practical notes on proving and submission

These cost us a day each and are invisible in the SDK documentation.

- **Proving takes minutes, not seconds.** Measured 290–485s on a 2-vCPU Zen 2 host, peaking
  ~6.6 GiB. Treat it as a product constraint, not an infrastructure detail.
- **The official prover image may abort with SIGILL** on older AMD hosts: it is compiled for
  a newer CPU. Rebuilding the identical upstream revision for the host CPU fixes it. See
  `PROVER.md`.
- **Fee estimation runs *after* proving.** A misconfigured paymaster or forwarder rejects the
  transaction seconds after a five-minute proof has already been generated. Estimate with a
  trivial call *before* spending prover time.
- **A queue changes the wait users experience, not the proof cost.** The product should return
  a job id, keep a compatible worker warm, expose `queued`, `preflight`, `proving`,
  `proof_ready`, `broadcasting`, and `confirmed` stages, and resume polling after a page
  closes. It must still re-check quote expiry and proof-aware preflight before broadcast.
- **The proved transaction hash is not the on-chain transaction hash.** The prover proves the
  user's invoke, whose hash never appears on chain; what is broadcast is the relayer's
  `apply_actions` call, under a different hash. Looking up the proved hash returns
  "Transaction hash not found" on a run that fully succeeded — it reads exactly like failure
  and has caused at least one wrong conclusion.
- **Proofs expire.** They anchor to a recent block and are invalid outside
  `proof_validity_blocks`. At multi-minute proving times this is a real failure mode, not a
  theoretical one.
- **Someone must pay the fee.** Ours is a self-hosted paymaster whose relayer needed roughly
  6.7 STRK of resource bounds per transaction. An underfunded relayer fails with
  `ValidationFailure: Resources bounds … exceed balance`, which does not obviously mean
  "top up the relayer".

## 9. Corrections we had to make

Recorded because the mistakes are instructive, and because a document that never corrects
itself should not be trusted.

- We claimed all 39 mainnet invocations were `balance_of` smoke tests, generalising from a
  five-transaction sample. Wrong: 32 are `balance_of`, **seven are `transfer_from`** pulling
  pre-approved funds. Decode the whole set before making a public claim.
- We read "one invoke-phase action per transaction" as "one dapp call per transaction". Also
  wrong — see section 4.
- We read the pool address in a `SENDER_NOT_REGISTERED` error as one of our own anonymizers.
  It was the official Sepolia pool.

## 10. Browser key derivation — resolved

**Yes: a facet can be derived from a wallet signature alone, with an important product
constraint.** The wallet does not release its raw private key. Instead, the browser asks the
wallet to sign one canonical, chain-and-pool-bound message, then derives the private viewing-key
scalar from the returned signature in memory. `privacy-bridge/packages/bridge-core` derives both
a Starknet private key and a privacy viewing key from one `personal_sign` signature; the privacy
SDK needs only `{ address, signer }` plus a `viewingKeyProvider`, and never asks for a raw private
key. The proving factory passes the viewing key privately into `compile_actions` and signs the
proof invocation with the derived signer.

**The constraint: this currently requires a standard EOA signature.** Argent X and Braavos are
smart-contract accounts, and their signatures are not the 65-byte recoverable form this
derivation depends on. A browser product built this way therefore connects an EOA wallet and
derives its Starknet identity from that signature; it does not derive facets from the user's
existing Starknet wallet. That onboarding distinction must be explicit.

Facet now has one fixed domain-separated message, strict EVM signature-shape/recovery-byte checks,
and an in-memory viewing-key derivation matching the preserved bridge-core recipe. The browser
launcher still needs cryptographic signer/address recovery, rejection of contract-owned EOA
addresses, note discovery, and the end-to-end proving/submission path. Do not persist the
signature or a derived signing key; the current launcher keeps the viewing key in memory too.
- **Whether slippage survives the proving window.** Calls are built before proving. A swap
  quote computed five minutes before execution may fail its slippage check.
- Whether a user can submit directly, without a relayer, and at what cost.

---

MIT licensed, like the rest of this repository. Corrections are welcome — particularly ones
that contradict something above.
