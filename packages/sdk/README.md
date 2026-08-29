# `@facet/sdk`

This package is the Facet-specific action builder over
`@starkware-libs/starknet-privacy-sdk`. Facet is a private account and portfolio layer:
the SDK turns a shielded note into a context-specific shadow-account call and settles
the result back into private notes.

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

`src/adapters.ts` contains pure call builders for the first three Facet integrations:

- `buildVesuDepositPlan` — STRK approval plus Vesu V1.1 vSTRK
  `deposit(assets, receiver)`.
- `buildEndurStakePlan` — ERC-20 approval plus Endur `deposit(assets, receiver)`.
- `buildEkuboQuoteCall` and `buildEkuboSwapPlan` — the live single-hop Ekubo route, including
  the transfer, swap, and minimum-output clear calls.

Each plan returns canonical `PrivacyCall`s, the input token and amount, and independent
settlement policies for every token whose balance can change. Vesu and Endur require a list of
addresses already linked to the user and refuse a matching protocol recipient with a typed
`LinkedRecipientError`; this is a hard privacy guard, not a warning. The builders do not quote,
prove, or broadcast. Quote Ekubo immediately before starting a proof because its minimum output
can decay during the proving window.

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
