# Facet

**Private identities for Starknet DeFi.**

One shielded balance. Unlimited unlinkable facets. Trade on one protocol as one
identity, lend on another as a different one, and nothing on-chain connects them to
each other or to you.

Built on STRK20 **shadow accounts** — a primitive that is deployed on mainnet,
supported by the official SDK, named in the sprint's judging criteria, documented
nowhere, and on which no real dapp interaction has ever been executed.

> **Status: in development.** Built during the [STRK20 Private Sprint](https://strk20.starknet.io),
> 14–31 August 2026. Nothing here is audited. Do not route funds you cannot afford to
> lose. Claims in this README are traceable to a source reference or a transaction
> hash; anything not yet done is marked as such.

---

## The primitive

The STRK20 privacy pool can run arbitrary dapp calls on a user's behalf through a
per-user *shadow account*, without linking those calls back to the user. The pool
derives an identity key inside a proved execution:

```
identity_key = poseidon(IDENTITY_KEY_TAG:V1, user_addr, user_private_key, anonymizer_addr)
```

and hands it to the anonymizer, which never learns who the user is. The anonymizer
then scopes it further:

```
partial_commitment  = poseidon(identity_key, dapp_name)
identity_commitment = poseidon(partial_commitment, nonce)
```

The result is one identity per user, per anonymizer, per dapp, per nonce — each backed
by its own contract account, none of them linkable to the others or to the person
behind them.

That is a **facet**: one cut face of a single stone, different from every angle, still
one stone.

## Why this doesn't already exist

The contract shipped. The product did not.

- A shadow account anonymizer has been live on mainnet since **23 July 2026**
  (`0x4f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7`, deployed at
  block 12,199,879).
- It has been invoked **39 times**, and all 39 were decoded. Every single one issues one
  call against the same contract — the STRK token. Thirty-two are `balance_of` reads;
  seven use `transfer_from` to pull pre-approved funds into the shadow account.
  **No shadow account has ever interacted with a DeFi protocol.**
- The official docs contain no coverage of it whatsoever. Across the full 121 KB
  documentation dump: `shadow` 0 occurrences, `stealth` 0, `identity_key` 0,
  `identity commitment` 0, `invoke_with_computation` 0.

There is a concrete reason, documented in [`docs/FINDINGS.md`](docs/FINDINGS.md):
`privacy_invoke_with_computation` never receives funds. It resolves or deploys the
shadow account, snapshots balances, runs the calls, and collects — but nothing puts
tokens in. Anything requiring capital has to be funded first.

The seven `transfer_from` invocations are a workaround for exactly this: an external
account pre-approves the shadow account, and the shadow account's first call pulls the
funds in. It works — and it leaks. Granting that allowance takes a public `approve`
from a funded, non-private address naming the shadow account as spender, which ties a
real identity to the facet and defeats the purpose.

Facet funds the shadow account from a shielded note instead, at its deterministic
address, inside the same transaction:

```
UseNote           spend a shielded note
Withdraw          send tokens to the shadow account's predicted address
ComputeAndInvoke  deploy it there, run the dapp calls, settle to an open note
```

No public approval, no funded address linked to the facet.

## What is actually verified

Everything asserted above is recorded with a file:line reference or a block height in
[`docs/FINDINGS.md`](docs/FINDINGS.md), including:

- pool identity, deployment block, and a full 112,464-event activity breakdown
- the two-tier `ClientAction` / `ServerAction` model, which is not described in the
  documentation and is the most common way to lose days on this stack
- a field-by-field decode of a real mainnet shadow-account invocation
- the one-invoke-per-transaction constraint and the phase ordering that follows from it

## Honest positioning

Facet is not a new privacy protocol. It uses StarkWare's, unmodified.

It is not a claim of exclusivity: of 326 compute-path calls on mainnet, 287 went to six
other custom anonymizers built by other teams. Others are competent in this territory
— they rolled their own rather than using the shadow account contract.

The claim made here is narrow and checkable: **this primitive has never executed a real
dapp call on mainnet.** Facet aims to be the first, and to leave behind the SDK and the
documentation that would let anyone else do it too.

## Documentation

| Document | Contents |
|---|---|
| [`docs/FINDINGS.md`](docs/FINDINGS.md) | Everything verified from source and chain data |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | Gate-by-gate record with evidence |

## License

MIT. See [LICENSE](LICENSE).
