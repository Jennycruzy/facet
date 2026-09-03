# `@usefacet/sdk`

This package contains Facet's adapter, policy, lifecycle, and private-transaction primitives.
Its reference executor turns a reviewed protocol plan into a Ready X Wallet API action and settles
the result into the wallet's shielded balance. A lower-level builder separately supports the direct
shadow-account path used in the Sepolia rehearsals.

Install the published package:

```bash
npm install @usefacet/sdk
```

Use Node 22.23.0 from the repository's `.nvmrc`; the pinned `starknet` dependency declares
Node 22 or newer.

`buildGateAActionSet` performs the read-only address lookup and queues the first private
account operation:

1. create an open settlement note;
2. withdraw the requested token amount to the anonymizer's authoritative shadow-account address;
3. invoke the dapp call through `shadow_account_invoke`.

The function does not prove or broadcast. The upstream core prover selects the persisted `UseNote`
when it compiles the withdrawal. This keeps note selection in the privacy SDK registry while making
the funding target and action order explicit and testable.

The upstream SDK is a peer dependency because its package is currently published from the
Starknet privacy monorepo rather than the public npm registry. The API is intentionally structural,
so the wrapper remains compatible without copying the upstream source tree.

## Registering the sender

A sender that has never set a viewing key is absent from the pool's registry, and the pool
rejects the entire transaction with `SENDER_NOT_REGISTERED`. The failure surfaces inside the
prover, after the proof work is already spent, so it is worth queueing registration up front.

Registration is `SetViewingKey`, which is `ACCOUNT_PHASE` (0) — earlier than the use-note,
withdraw and invoke phases — so it belongs in the same action set rather than in a separate
transaction. Two upstream paths express it:

- **Explicitly.** Core's `PrivateTransfersBuilder.register()` queues the action. Pass
  `register: true` to `buildGateAActionSet` and it is queued ahead of every other action.
- **Implicitly.** Core's execute options `autoRegister` and `autoSetup`, exported here as
  `GATE_A_REGISTRATION_OPTIONS`, add `SetViewingKey` only when the sender has no channel public
  key, along with the self-channel a newly registering sender cannot already have.

```ts
const set = await buildGateAActionSet(client, { ...options, register: true });
set.registered; // whether SetViewingKey was queued
```

The client-layer `PrivacyBuilder` exposes neither — its `build()` takes no options and it has no
`register()`. Asking for `register: true` there throws rather than queueing a set that cannot
register; use `supportsRegistration` to check first, or build on the core path.

## Protocol adapters

Apps use one public `ProtocolAdapter` contract. They provide a normal app intent; Facet keeps the
private-account machinery behind the executor:

```ts
import {
  WalletFacetExecutor,
  endurAdapter,
  erc4626HelperBinding,
  executeAppIntent,
} from "@usefacet/sdk";

const linkedAddresses = [connectedWallet, fundingWallet, recoveryWallet];
const executor = new WalletFacetExecutor({
  wallet,
  owner: connectedWallet,
  linkedAddresses,
  binding: erc4626HelperBinding({ helper: endurHelper, operation: "deposit" }),
  policy: {
    supportedAssets: [strk, xstrk],
    amountBounds: { min: 1n, max: 1_000n * 10n ** 18n },
    assetKinds: { [xstrk]: "exit-required" },
  },
});

const result = await executeAppIntent({
  adapter: endurAdapter,
  intent: {
    action: "stake",
    parameters: { token: strk, endur: xstrk, receiver: endurHelper, amount },
  },
  context: { linkedAddresses },
  executor,
});
```

That is the complete dapp-facing flow: **app intent → adapter plan → Facet execution**. The app
supplies an intent and reviewed route configuration; it does not select notes, construct Wallet API
actions, handle screening attestations, or run a prover. Ekubo and Endur demonstrate the one public
`ProtocolAdapter` interface; they are not a claim that arbitrary apps are already supported.

### Copy-paste compatible-app example

[`examples/compatible-app.ts`](examples/compatible-app.ts) is the smallest tested integration:
it accepts a wallet-shaped object and reviewed Endur route configuration, creates the public
`WalletFacetExecutor`, and calls `executeAppIntent`. The matching test in
[`tests/compatible-app.test.ts`](tests/compatible-app.test.ts) asserts the exact withdraw,
settlement, and helper-invoke actions. It deliberately leaves signing, screening, proving, and
broadcast to the wallet.

**What it does and does not do.** It builds the action list, enforces the settlement and recipient
invariants, and hands the result to the wallet. The wallet owns the shielded state, the proof, the
screening attestation and the submission — so on this path a developer does not select notes or
run a prover, because the wallet does. It is the plain-invoke path through a protocol-bound
helper, **not** a per-application shadow account; `docs/FINDINGS.md` §6.33 records the transport
measurements behind that choice. A developer wanting a different protocol supplies a
`HelperBinding`; a developer wanting a different submission path implements `FacetExecutor`
themselves, and then notes, keys and proving are theirs to handle.

`src/adapters.ts` contains pure call builders for the two current Facet integrations:

- `buildEndurStakePlan` — ERC-20 approval plus Endur `deposit(assets, receiver)`.
- `buildEkuboQuoteCall` and `buildEkuboSwapPlan` — the live single-hop Ekubo route, including
  the transfer, swap, and minimum-output clear calls.

Pool funding and app spending are separate boundaries. Use `assertFundingDenomination` when adding
money to the private pool; users may choose any valid app spend up to their private balance. Every
plan must declare its explicit public recipient fields, including an empty list when its fixed
helper route exposes no user-selected recipient. The executor checks those declarations against
the required linked-address set before submission. Endur also performs the same check while
building its receiver calldata and throws a typed `LinkedRecipientError`. This guard covers
declared recipient fields; it is not a general calldata decompiler or a guarantee against every
form of correlation. Each plan returns canonical `PrivacyCall`s, the input token and amount, and
settlement policies for each output its bound helper can actually settle. The builders do not
quote, prove, or broadcast. Quote Ekubo immediately before starting a proof because its minimum
output can decay during the proving window.

## Facet lifecycle and recovery

`createOrRetainFacet` keeps one deterministic record per wallet, app, and strategy. Its explicit
state machine is `launch → use → hold → recover → retire`; a held facet can be used again, and a
recovering facet can return to hold when an explicit protocol exit remains.

The store is supplied by the caller. `createMemoryFacetStore` keeps records for the life of the
process; `createStorageFacetStore` persists them through any `getItem`/`setItem` pair, so a facet
outlives the tab that created it and a returning wallet resolves the identity it already had.
Storage writes are defensive: a private-browsing mode that throws degrades the launcher rather
than breaking it, because a record is a cache and never the authority for a facet's existence.

`createStorageFacetStore` writes `wallet`, `app`, `strategy` and `address` in the clear and keys
its map by `wallet:app:strategy`. That is fine for a caller that does not need the mapping hidden
and wrong for one that does — sealing one field alone does **not** make a record private, because
the index beside it stays readable. Use `saveSealedFacets` and
`loadSealedFacets` for that: they persist the entire record set as one opaque envelope, so
nothing identifying and no per-record key reaches storage at all.

`deriveRecoveryKey`, `sealRecoveryRecord`, and `openRecoveryRecord` seal arbitrary record data.
`FacetRecord.recovery` contains positions only; the whole record set is what must be encrypted.
The key is derived by HKDF from a verified secret only the user can reproduce, scoped to the wallet
address, and is non-extractable; the record is sealed with AES-GCM under a fresh IV per write.
Whatever holds the ciphertext learns the envelope's existence and approximate size and nothing
else, and Facet cannot decrypt a user's records by construction rather than by policy. An
EOA-shaped `personal_sign` result must not be assumed to be a valid Ready X Starknet secret.

For a caller that needs a user-facing fallback before a verified wallet-native secret exists,
`unlockPassphraseSealedFacets` and `saveUnlockedPassphraseSealedFacets` use a fresh random salt and
PBKDF2 to derive the same non-extractable AES-GCM key from an explicit recovery passphrase of at
least 16 characters. The passphrase is never stored or returned, and Facet cannot reset it.
`saveSealedFacets` returns `false` when the storage write fails, so callers cannot report persistence
that did not happen.

`recoveryPlan` classifies ordinary fungible-token deltas as automatically recoverable. xSTRK, LP
positions, debt, NFTs, and receipts are persistent positions: they require the protocol's explicit
exit path and are never silently swept or described as recovered.

`planFacetRecovery` answers the next question — through *what*. It resolves each persistent
position against the deployed exit catalogue (`exitRoutesFromApps` reads it straight out of the
app list the execution pages use) and returns the route that closes it. A route only counts for
the facet named in its `contextApp`, so one facet's exit never appears to rescue another's
position. Anything no configured route closes is reported as `RECOVERY_REQUIRES_ADAPTER` instead
of being treated as recoverable: the honest answer is that Facet cannot return it without a new
adapter. `assertFacetRecoverable` is the same routing as a throw.

`beginFacetRecovery` and `retireFacet` are the guarded lifecycle entry points. They enforce the
state transitions and refuse recovery or retirement while a persistent position remains. A route
must record its confirmed protocol exit, or otherwise settle the automatic fungible delta, before
the facet can be considered ready to retire.

These are library primitives, not an end-to-end recovery product. `createOrRetainFacet` retains a
record whose address is supplied by the caller; it does not deploy or derive that account.
`recoveryPlan` classifies positions but does not execute transfers, redemptions, debt repayment, or
protocol exits. The browser launcher mirrors the five states in a smaller local activity map,
offers the same guarded recovery/retirement controls, and records the Endur exit against the Endur
context. That record still does not control an on-chain account or execute a general recovery
sweep.

## Wallet-derived viewing key

`deriveViewingKeyFromSignature` accepts the validated 65-byte result of `personal_sign` and returns
the canonical pool viewing key. It uses the versioned `viewing-key:v1` label, two
Starknet-Keccak limbs, reduction by the Stark curve order, and the pool's strict lower-half fold.
The function is pure and does not persist or log the signature. The browser launcher carries a
dependency-free equivalent in `packages/web/assets/js/wallet-derivation.js`; both implementations
share a golden vector. Deriving the key does not by itself discover notes, prove an action, or
authorize a transaction.

## Sepolia private-transaction runner

The operational private-transaction scripts live in this package so the project owns its integration code while
consuming the Starknet privacy SDK as a dependency. They never store the Sepolia account private key
in the repository.

Until the upstream package is available from the configured npm registry, operational scripts load
its built output from `FACET_PRIVACY_SDK_ROOT`. Set it to your own checkout of the upstream
Starknet privacy SDK — the built-in fallback is the author's local path and will not exist on
another machine — then run `npm run build` in that checkout before running a private transaction:

```bash
export FACET_PRIVACY_SDK_ROOT=/path/to/starknet-privacy/sdk
```

```bash
npm run private:sepolia:preflight
npm run private:sepolia:run
```

The managed Sepolia runner requires `FACET_PAYMASTER_API_KEY`, a tunnel to the trusted prover, and the local Sepolia
A keystore. For the isolated self-hosted path, configure `FACET_PAYMASTER_URL` and
`FACET_USE_TEST_POOL=1`. Setup scripts are exposed as `private:pool:setup` and
`private:paymaster:setup`; do not repeat deployments when their mode-0600 profiles already exist.
For an existing self-hosted profile, use `npm run private:sepolia:selfhost:preflight` and then
`npm run private:sepolia:selfhost:run`; the wrapper loads the API key without printing it.
If the fee sponsor reports a missing private forwarder entrypoint, run `npm run private:paymaster:refresh`
once. It declares the current forwarder class and writes separate `*-v2` profiles, leaving the
old profile recoverable.

The Ekubo adapter is run with:

```bash
npm run private:defi:ekubo
```

The older script names remain as compatibility aliases for existing checklists; new
integrations and documentation should use the private-account names above.
