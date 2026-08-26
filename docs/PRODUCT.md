# Facet: a private account and portfolio layer

Facet is a privacy layer for Starknet applications.

The simplest way to understand it is **Hide My Email for your money**: one person can
keep a unified private portfolio while presenting a separate account to every app,
protocol, or context they use.

An exchange, lending market, game, or trading venue sees a Facet account. It does not
see the user's primary wallet, the user's other Facet accounts, or the rest of the
portfolio. The user still has one shielded balance and one recovery identity underneath.

> **One private portfolio. A different account for every context.**

This is an account and portfolio product, not a new cryptographic protocol. Facet uses
the STRK20 privacy pool, proved execution, and shadow accounts as its substrate, then
turns those primitives into a usable account model for applications.

## The product problem

A public wallet is a poor long-term identity layer. Once it interacts with a protocol,
its balance, counterparties, timing, and application history become a durable public
record. Reusing that address creates a graph that grows with every interaction.

That graph creates practical risks:

- a trader's strategy can be copied or front-run;
- a lending position can be watched for liquidation;
- a portfolio can be valued and profiled by anyone who knows the address;
- activity on one app can be used to identify activity on another;
- a payment or donation address can expose unrelated financial history.

Facet separates application identity from portfolio identity. A user can choose the
right level of separation without manually managing a new wallet, funding it publicly,
or abandoning a unified view of their assets.

## The product model

### A private portfolio

Funds begin as shielded STRK20 notes. The notes are the private balance layer: they are
spent and recreated by proved actions rather than by publicly moving funds from the
user's primary wallet into every application.

### Context-specific accounts

Facet derives an account from the user's private identity, the Facet anonymizer, an
application name, and a rotation nonce. The same user can therefore have:

```text
Facet + app A + nonce 0  →  shadow account A
Facet + app B + nonce 0  →  shadow account B
Facet + app A + nonce 1  →  shadow account A2
```

These accounts are deterministic for recovery and unlinkable by construction across
their derivation contexts, assuming the user does not voluntarily link them through
their own behavior.

### Private application actions

The shadow account is the public caller. It can invoke a normal Starknet contract while
the funding and settlement legs remain inside the proved private transaction. After an
interaction, the resulting balances can be collected into fresh private notes.

For a swap, the user experiences one portfolio operation. Internally, Facet performs:

```text
private STRK note
    → fund the predicted context account
    → call the application as that account
    → collect resulting assets into private notes
```

The product boundary is important: the application call is public, but the owner of the
calling account is not published by the private funding path.

## How it works

Facet combines the following layers:

| Layer | Responsibility |
|---|---|
| Wallet identity | Authorizes the user and recreates the private identity in memory. The raw wallet secret is never requested. |
| STRK20 privacy pool | Stores shielded notes and applies the proved note, withdrawal, and settlement actions. |
| Transaction prover | Re-executes the signed Invoke V3 and produces the proof facts accepted by the pool. |
| Immutable anonymizer | Converts a private identity and application context into a deterministic account commitment. |
| Shadow account / `FacetAccount` | Acts as the public Starknet caller for the selected application context. |
| Application adapter | Encodes a protocol-specific call, quote, slippage policy, and output-note policy. |
| Relayer or paymaster | Submits the proof-bearing transaction and pays network execution costs where supported. |
| Portfolio index | Reconstructs the user's private view from local state and shielded-note metadata; it does not expose the user's context map to applications. |

The identity commitment is scoped in two steps:

```text
identity_key       = Poseidon(domain, user identity, anonymizer)
partial_commitment = Poseidon(identity_key, application name)
commitment         = Poseidon(partial_commitment, rotation nonce)
```

The private identity is consumed by the proved execution. It is not placed in public
calldata. The anonymizer sees the commitment needed to resolve the account, not the
user's portfolio or the relationship between the user's other commitments.

## The account lifecycle

1. The wallet authorizes a session and the client derives the private identity in memory.
2. The client selects a shielded note and a context (`app`, chain, policy, nonce).
3. Facet computes the deterministic shadow-account address before the account exists.
4. The privacy pool spends the note and withdraws the requested asset to that address.
5. The shadow account is deployed if necessary and executes the application call.
6. The adapter clears or settles application balances into output notes.
7. The portfolio layer records the result locally without publishing the user's context map.

The ordering is not cosmetic. Withdrawal occurs before invocation, which allows a new
account to be funded and used in the same transaction. A failed application call reverts
the full transaction, including the funding leg.

## Privacy model

Facet hides the relationship between a user's private portfolio and an application's
public caller. It does not make the application call invisible.

Public or inferable information includes:

- the shadow-account address and its on-chain activity;
- the application call and its public calldata;
- the token and amount withdrawn to fund the account;
- timing, amounts, output assets, and any user-chosen recipient;
- relationships the user creates by reusing addresses, amounts, timing, or recipients.

The most important operational rule is simple: **never make a private call to an address
that identifies the owner.** A private funding path cannot undo a public dapp call that
sends directly to the owner's known address.

The current anonymizer contract is upgradeable in the upstream deployment, so the
anonymizer and prover are part of the trust boundary until a production governance and
verification model is established. The private SDK also sends viewing-key material into
the proving path; the current prover must therefore remain authenticated infrastructure.

## Current implementation status

The repository contains a working protocol integration and the foundations of the
product layer:

- the private funding and settlement sequence has succeeded twice on Sepolia;
- a second clean context sent its smoke call to an unrelated address and did not pay the
  owner;
- the immutable anonymizer and `FacetAccount` are declared and deployed on mainnet;
- the Ekubo adapter has completed a shielded STRK-to-ETH rehearsal on Sepolia;
- the SDK contains the action builder, proof-aware preflight, settlement logic, and
  operational runbooks;
- fork-backed contract tests and source/chain findings document the behavior.

The staged browser launcher now binds an EOA and derives a viewing key in memory. Note
discovery, the portfolio index, production prover service, and a mainnet DeFi interaction
are still product work. The development prover currently takes roughly five to seven minutes
on the small reference host. That is an infrastructure measurement, not the intended user
experience: a production service should prove asynchronously,
reuse warm workers, report progress, and target a materially shorter interaction window.

## Design principles

- **Private by default:** do not require a public approval from the user's primary wallet.
- **One portfolio, many contexts:** separation should not force users to manage many wallets.
- **Deterministic recovery:** a lost browser session must not mean a lost account namespace.
- **Application-agnostic core:** protocol adapters should add calls and policies, not new identity logic.
- **Evidence over optimism:** every privacy or settlement claim is backed by source, fork tests,
  or a receipt; unfinished product work is labelled unfinished.
- **Explicit limits:** users must be told what remains public and what the prover trusts.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for execution boundaries,
[`SHADOW_ACCOUNTS.md`](SHADOW_ACCOUNTS.md) for the primitive,
[`PRIVATE_DEFI.md`](PRIVATE_DEFI.md) for the adapter path, and
[`FINDINGS.md`](FINDINGS.md) for source and chain evidence.
