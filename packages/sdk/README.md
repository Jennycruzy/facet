# `@facet/sdk`

This package is the Facet-specific action builder over
`@starkware-libs/starknet-privacy-client`.

`buildGateAActionSet` performs the read-only address lookup and queues the first Facet operation:

1. create an open settlement note;
2. withdraw the requested token amount to the anonymizer's authoritative shadow-account address;
3. invoke the dapp call through `shadow_account_invoke`.

The function does not prove or broadcast. The upstream core prover selects the persisted `UseNote`
when it compiles the withdrawal. This keeps note selection in the privacy SDK registry while making
the funding target and action order explicit and testable.

The upstream client is a peer dependency because its package is currently published from the
Starknet privacy monorepo rather than the public npm registry. The API is intentionally structural,
so the wrapper remains compatible with the client without copying its source tree.
