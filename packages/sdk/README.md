# `@facet/sdk`

This package is the Facet-specific action builder over
`@starkware-libs/starknet-privacy-sdk`. Facet is the integration layer for a private Starknet
app launcher:
the SDK turns a shielded note into a context-specific shadow-account call and settles
the result back into private notes.

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
import { ekuboAdapter, executeAppIntent } from "@facet/sdk";

const result = await executeAppIntent({
  adapter: ekuboAdapter,
  intent: { action: "swap", parameters: {
    router, token0, token1, tokenIn: strk, tokenOut: eth,
    routeFee, tickSpacing, amountIn: 5n * 10n ** 18n, minimumAmountOut,
  } },
  context: {
    linkedAddresses: [connectedWallet, fundingWallet, recoveryWallet],
  },
  facet: ekuboFacet,
  executor: facetExecutor,
});
```

That is the dapp-facing flow: **app intent → adapter plan → Facet execution**. Ekubo and Endur
demonstrate the interface; they are not a claim that arbitrary apps are already supported.

`WalletFacetExecutor` is the reference `FacetExecutor` and ships with the package, so
`executeAppIntent` runs end to end against a Wallet API wallet:

```ts
import { WalletFacetExecutor, erc4626HelperBinding } from "@facet/sdk";

const facetExecutor = new WalletFacetExecutor({
  wallet, owner: connectedWallet, linkedAddresses,
  binding: erc4626HelperBinding({ helper: endurHelper, operation: "deposit" }),
});
```

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
money to the private pool; users may choose any valid app spend up to their private balance. Each
adapter enforces the shared linked-address guard before it returns a plan. Each plan returns
canonical `PrivacyCall`s, the input token and amount, and independent
settlement policies for every token whose balance can change. Endur requires a list of addresses
already linked to the user and refuses a matching protocol recipient with a typed
`LinkedRecipientError`; this is a hard privacy guard, not a warning. The builders do not quote,
prove, or broadcast. Quote Ekubo immediately before starting a proof because its minimum output
can decay during the proving window.

## Facet lifecycle and recovery

`createOrRetainFacet` keeps one deterministic record per wallet, app, and strategy. Its explicit
state machine is `launch → use → hold → recover → retire`; a held facet can be used again, and a
recovering facet can return to hold when an explicit protocol exit remains. The user supplies the
store, so recovery metadata can remain local or be encrypted before persistence.

`recoveryPlan` classifies ordinary fungible-token deltas as automatically recoverable. xSTRK, LP
positions, debt, NFTs, and receipts are persistent positions: they require the protocol's explicit
exit path and are never silently swept or described as recovered.

These are library primitives, not an end-to-end recovery product. `createOrRetainFacet` retains a
record whose address is supplied by the caller; it does not deploy or derive that account.
`recoveryPlan` classifies positions but does not execute transfers, redemptions, debt repayment, or
protocol exits. The browser launcher uses a smaller local metadata map and is not wired to this SDK
state machine.

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
its built output from `FACET_PRIVACY_SDK_ROOT` (default: `/Users/user/starknet-privacy/sdk`). Run
`npm run build` in that upstream SDK checkout before running a private transaction.

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
