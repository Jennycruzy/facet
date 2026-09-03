# Facet: a private Starknet app launcher

Facet is designed to remove the direct public funding link between a shielded balance and the
application-specific identities that use it. This is not a guarantee against correlation or an
invisibility layer for downstream protocol activity.

The target product is a launcher that funds and retains an app-specific account from a shielded
balance. The Mainnet browser product now reads the private portfolio from Ready X and reconciles
deterministic app accounts from the anonymizer when the wallet exposes its optional commitment
view. It still supplies the reviewed Ekubo and Endur plans through Ready X's wallet-mediated
helper path when that capability is unavailable. The private portfolio is now a live read model,
not a server-side index; protocol exits remain explicit and asset-specific.

The simplest way to understand it is **Hide My Email for your money**: one person can
keep a unified private portfolio while presenting a separate account to every app,
protocol, or context they use.

An exchange, lending market, game, or trading venue sees a Facet account. It does not
see the user's primary wallet, the user's other Facet accounts, or the rest of the
portfolio. The user still has one shielded balance and one recovery identity underneath.

> **One balance. A different face in every app.**

The precise promise is narrow: Facet keeps the relationship between a user's shielded
portfolio and a compatible application's public account from being published by the
funding path. Once that account touches a protocol, its caller, calldata, balances,
timing, and downstream activity are public or inferable like any other Starknet account.

This is a launcher and account product, not a new cryptographic protocol. Facet uses
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

These accounts are deterministically separated across derivation contexts, but public amounts,
timing, recipients, or later transfers can still correlate them. A facet is scoped to an application or strategy and is normally
retained across that application's actions. The nonce is a deliberate rotation control,
not a new identity that should be generated for every transaction.

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

### Compatible applications, not arbitrary applications

Facet supports compatible Starknet applications: applications whose action can be encoded
as ordinary account-level calls and whose input/output balances or positions have an
adapter policy. A protocol may still require an adapter even when its contracts are
deployed and unchanged.

Applications that depend on off-chain signatures, callbacks, session-bound behaviour,
opaque account assumptions, or an application-specific account registry may not work
without additional integration. Persistent protocol state can work when the same facet
is retained, but it must be tested rather than assumed. The launcher should label an
integration as live only after its calldata, balances, settlement, and receipt have been
verified on the target network.

### Asset lifecycle

Facet must distinguish two asset classes in both its state model and its copy:

- **Recoverable fungible assets.** Token balances and per-interaction deltas can be
  collected into fresh shielded notes when the adapter's `CollectPolicy` supports it.
- **Persistent application positions.** LP positions, debt, NFTs, staking receipts, and
  other protocol-owned positions remain attached to the facet until the protocol's exit
  action is executed. They are not automatically swept back into a shielded balance.

The unified view may show both classes, but it must not promise that every visible position
can be withdrawn into STRK20 notes. Retaining, rotating, or retiring a facet with a live
position is a user decision; the position normally has to be exited before its value can
be recovered as a fungible note.

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
| Portfolio view | Ready X supplies live private balances; the launcher optionally resolves each deterministic app account and reads its public positions from Mainnet. The launcher's session activity context is replaceable and never the authority for existence, balances, or cross-session lifecycle state. |

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

This is the target direct-Facet lifecycle. The Sepolia runner has exercised the core proved
sequence. The Mainnet browser launcher now reconciles the read side — private balances, optional
deterministic account discovery, public balances, and local lifecycle history — while execution
and lifecycle-changing writes remain wallet-mediated.

1. The wallet authorizes a session and the client derives the private identity in memory.
2. The client selects a shielded note and a context (`app`, chain, policy, nonce).
3. Facet computes the deterministic shadow-account address before the account exists.
4. The privacy pool spends the note and withdraws the requested asset to that address.
5. The shadow account is deployed if necessary and executes the application call.
6. The adapter clears or settles application balances into output notes.
7. The client records the result locally without publishing the user's context map. The
    record set can be sealed with AES-GCM under a non-extractable key derived from a verified
    wallet-native secret or an explicit user-chosen recovery passphrase; the passphrase/key never
    enters storage, so a backup moves ciphertext rather than a deanonymising registry.

The ordering is not cosmetic. Withdrawal occurs before invocation, which allows a new
account to be funded and used in the same transaction. A failed application call reverts
the full transaction, including the funding leg.

## Privacy model

Facet is designed to avoid publishing the direct funding relationship between the user's shielded
balance and an app-specific identity. It does not prevent correlation and does not hide the app-specific identity or the activity that identity
performs after it reaches a protocol.

Public or inferable information includes:

- the shadow-account address and its on-chain activity;
- the application call and its public calldata;
- the token and amount withdrawn to fund the account;
- timing, amounts, output assets, and any user-chosen recipient;
- relationships the user creates by reusing addresses, amounts, timing, or recipients.

The most important operational rule is simple: **never make a private call to an address
that identifies the owner.** A private funding path cannot undo a public dapp call that
sends directly to the owner's known address.

### Correlation hygiene is a product policy

The SDK currently enforces a linked-recipient guard for the adapters that expose a public
`user` or `receiver` field. The following are product safeguards, not claims of current
enforcement across every route: fixed funding denominations, deliberate timing separation,
refusing facet-to-facet transfers, and withdrawal hygiene. They remain roadmap work until
the relevant path enforces them in code and has a test or receipt behind the claim.

The same rule applies to discovery. A backend must not be the sole database mapping a
wallet to its facets. Deterministic derivation plus client-side or encrypted-local state
keeps that mapping recoverable without making it a public service record. The SDK provides
the sealing primitive, and the launcher now wires it through the explicit passphrase path:
`sealRecoveryRecord` writes only ciphertext, and the key is derived locally from a secret that
Facet never sees.

The launcher uses a two-level boundary. Temporary activity stays in `sessionStorage`, and the old
persistent plaintext key is purged on load. That session data is still plaintext while the tab is
live and is not protection from an extension, injected script, or browser session restoration. For
cross-session recovery, the user may explicitly unlock a whole-record AES-GCM envelope with a
unique passphrase of at least 16 characters. PBKDF2 derives the non-extractable key locally; the
fixed storage namespace contains only a random salt and ciphertext, never a wallet/app index,
per-record key, or passphrase. Facet cannot reset a lost passphrase. A route offers the same
optional encrypted save only after its transaction is accepted.

The optional shadow-account read can rediscover a public address, but the current Mainnet
wallet-mediated Endur route does not prove that the wallet used Endur or reconstruct its lifecycle.
After a tab ends, missing state is treated as unknown: the portfolio remains read-only and
lifecycle controls stay disabled until the encrypted record is unlocked. A wrong passphrase or
malformed envelope is an error, never an empty vault, and cannot overwrite the existing envelope.
The explicit passphrase is a user-held recovery secret, not an unverified Ready X signature.

### Why not use several wallets?

Several manually managed wallets can approximate separation, but each one requires its own
funding trail, gas balance, recovery process, and privacy discipline. Funding or moving
between them creates links, and users have to remember which wallet belongs to which app.
Facet automates that discipline while preserving one shielded balance and one recovery
identity underneath. It does not claim that manually created wallets are impossible to
correlate; it makes the safer workflow easier to maintain.

The official upstream anonymizer deployment is upgradeable with no timelock, so that
deployment and its prover are part of the trust boundary until a production governance and
verification model is established. Facet's own Mainnet anonymizer deployment is the immutable
class recorded in `docs/ARCHITECTURE.md`; the private SDK still sends viewing-key material
into the proving path, so the current prover must remain authenticated infrastructure.

## Current implementation status

The current release is a working wallet-mediated Mainnet product with a tested SDK boundary,
receipt-backed route suite, chain-backed portfolio view, and guarded local lifecycle. Its scope is
deliberate: transport independence and broader protocol coverage are the next expansion tracks.

- the private funding and settlement sequence has succeeded twice on Sepolia;
- the immutable anonymizer and `FacetAccount` are declared and deployed on Mainnet;
- the Ekubo and Endur adapters have completed their rehearsals and the reviewed Mainnet route
  compositions have six successful Facet protocol receipts;
- the SDK contains the action builder, proof-aware preflight, settlement logic, guarded lifecycle
  transitions, encrypted recovery primitives, a tested compatible-app example, and operational
  runbooks;
- the launcher reads the Ready X private portfolio, reconciles supported deterministic contexts,
  records route receipts, and exposes explicit passphrase-backed recovery;
- the shared ERC-4626 helper class, deterministic Endur helper, and Ekubo helper are declared and
  deployed on Mainnet;
- fork-backed contract tests, browser tests, and source/chain findings document the behavior.

The browser launcher connects Ready X and combines a live private balance with chain observations.
Its session map enforces the five lifecycle transitions for state established in the current
session, while the optional sealed envelope restores that state across sessions without a
wallet-to-app index in persistent plaintext. Unknown state is read-only and does not get an empty
replacement record. Reviewed Wallet API pages provide narrow Mainnet routes for Ekubo and Endur:
Ready X signs, proves, screens, and submits the privacy actions, while Facet supplies the fixed
protocol-bound helper and protocol calldata. The reviewed Ekubo, Endur, and xSTRK exit routes have
verified Mainnet receipts with pool/protocol evidence and configured helper paths. These are the
current transport boundary, not a placeholder for the product. The direct `FacetAccount` transport
and a long-running browser queue are the next transport-independence track. The existing eligibility
shield is a successful Mainnet STRK20 transaction, but it was made through Ready X and is not being
relabeled as Facet DeFi activity. The retired Vesu experiment is retained in `FINDINGS.md` as
failure analysis, not as a product route.

The development prover currently takes roughly five to seven minutes on the small reference
host. That is an infrastructure measurement, not the intended user experience. The next direct-
Facet transport can submit an allowlisted job, return immediately with a job id, keep a warm worker
proving asynchronously, let the user leave the page, and resume by polling. This improves the
visible wait and avoids duplicate work; it does not make the cryptographic proof faster. Only
faster hardware or a supported hosted/client-side proving implementation changes the raw proof wall
time. The reviewed wallet-mediated route is live today; the queue and its polling UI are the next
service layer around that proven action path.

The product execution contract is documented in [`ASYNC_PROVING.md`](ASYNC_PROVING.md).

## Design principles

- **Private by default:** do not require a public approval from the user's primary wallet.
- **One portfolio, many contexts:** separation should not force users to manage many wallets.
- **Deterministic identity, explicit recovery:** a lost browser session must not change the derived
  account namespace, but lifecycle management waits for the private record to be restored.
- **Application-agnostic core:** protocol adapters should add calls and policies, not new identity logic.
- **Evidence over optimism:** every privacy or settlement claim is backed by source, fork tests,
  or a receipt; unfinished product work is labelled unfinished.
- **Explicit limits:** users must be told what remains public and what the prover trusts.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for execution boundaries,
[`SHADOW_ACCOUNTS.md`](SHADOW_ACCOUNTS.md) for the primitive,
[`PRIVATE_DEFI.md`](PRIVATE_DEFI.md) for the adapter path, and
[`FINDINGS.md`](FINDINGS.md) for source and chain evidence.
