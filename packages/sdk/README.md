# `@facet/sdk`

This package is the Facet-specific action builder over
`@starkware-libs/starknet-privacy-sdk`.

`buildGateAActionSet` performs the read-only address lookup and queues the first Facet operation:

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

## Sepolia Gate A runner

The operational Gate A scripts live in this package so the project owns its integration code while
consuming the Starknet privacy SDK as a dependency. They never store the Gate account private key
in the repository.

Until the upstream package is available from the configured npm registry, operational scripts load
its built output from `FACET_PRIVACY_SDK_ROOT` (default: `/Users/user/starknet-privacy/sdk`). Run
`npm run build` in that upstream SDK checkout before Gate A.

```bash
npm run gate-a:preflight
npm run gate-a:run
```

`gate-a:run` requires `FACET_PAYMASTER_API_KEY`, a tunnel to the trusted prover, and the local Gate
A keystore. For the isolated self-hosted path, configure `FACET_PAYMASTER_URL` and
`FACET_USE_TEST_POOL=1`. Setup scripts are exposed as `gate-a:test-pool` and
`gate-a:paymaster-setup`; do not repeat deployments when their mode-0600 profiles already exist.
For an existing self-hosted profile, use `npm run gate-a:selfhost:preflight` and then
`npm run gate-a:selfhost:run`; the wrapper loads the API key without printing it.
