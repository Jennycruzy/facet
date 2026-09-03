# Async proving and launcher execution

Status: product contract and sprint handoff, 29 August 2026. The public launcher currently
implements wallet binding and application-context preview only; the separate reviewed Ready X
route pages can submit only their fixed allowlisted actions. The queue described here is the
smallest production-shaped path still to add; it is not a claim that the static launcher already
submits arbitrary transactions.

## Why this exists

The STRK20 pool's private `apply_actions` path requires a transaction proof. That includes
the actions used for registration, private deposits, and application calls. The deployed
pool has no proof-free public `register` or `deposit` shortcut that makes the private path
instant. A self-hosted proof on the current small VPS has measured at roughly **355–485
seconds**, with about **6.6 GiB** peak prover memory.

There are two different improvements, and they must not be confused:

| Improvement | What it changes | What it does not change |
|---|---|---|
| Faster hardware, hosted proving, or a future client-side prover | Raw proof wall time | Does not remove the need for a proof or the pool's validation rules |
| A warm asynchronous worker and resumable job UI | User-visible wait, duplicate work, and page lifetime | Does not make the current cryptographic computation faster |

The sprint can ship the second one honestly even if the first remains a post-hackathon
infrastructure project. The UI must say “proof queued” and “typically several minutes,” not
pretend that a queue is a speedup.

## Target user journey

The browser flow is:

1. Connect an eligible wallet and sign the origin/network/pool binding message. The signature
   and derived viewing capability remain in memory.
2. Read the user's shielded balance and available notes. Do not show an invented balance when
   discovery is unavailable.
3. Select an application. Resolve or create that application's persistent facet; do not derive
   a new identity for every click or transaction.
4. Build the adapter intent and display the exact token, amount, route, recipient, minimum
   output, target facet, and privacy limitations.
5. Run read-only contract checks and fee/preflight checks before spending prover time.
6. Submit one canonical, allowlisted job with an idempotency key. Return a job id immediately.
7. A warm worker proves the exact signed transaction asynchronously. The browser may close;
   the job continues on the trusted worker.
8. When proof generation completes, re-check expiry, nonce, quote, route, recipient, pool,
   and proof-aware simulation. A stale or changed intent is rejected, never silently rebroadcast.
9. Require the final review gate before the authorized relayer or account broadcasts. The
   current Mainnet runner's explicit broadcast flag remains the manual safety boundary until
   the browser path has the same review semantics.
10. Poll the job until the on-chain receipt is available, verify success and the expected pool,
    Facet, and protocol events, then update the unified view.

The “leave the page” promise means the job id and a safe public summary can be recovered from
the same browser session. It does **not** mean a server may keep a permanent wallet-to-facet
database.

## Job state machine

The public state vocabulary is deliberately small:

```text
queued
  → preflight
  → proving
  → proof_ready
  → broadcasting
  → confirmed
```

Any stage may end in `failed`, with a typed reason such as `invalid_intent`, `quote_expired`,
`proof_rejected`, `broadcast_rejected`, or `receipt_failed`. A retry must create a new
idempotency key and re-quote the action; refreshing the page must not create a duplicate job.

The UI should show:

- job id and application context;
- current stage and elapsed time;
- “typically several minutes” while proving, with no fabricated percentage;
- quote/expiry and the exact review values;
- the final transaction hash and explorer link only after receipt verification.

## Narrow API contract

The first service should expose only two operations:

```text
POST /v1/proof-jobs
GET  /v1/proof-jobs/{job_id}
```

The request is a canonical application intent, not arbitrary Starknet calldata. It contains
the selected network, known Facet deployment, app id and dapp name, nonce, token addresses,
amounts, route/quote data, protocol recipient policy, and an idempotency key. The server
validates every address and field against a checked app allowlist and the current network
configuration.

The request must never accept or log a raw private key, keystore password, wallet signature,
viewing key, or an arbitrary proof payload. The current SDK sends viewing-key material into
the proving path, so the trusted service must receive that material only through an
authenticated, encrypted, short-lived channel or a local worker boundary, keep it in memory
for the job, and erase it when the job ends. It must never be part of the durable job record,
browser storage, URL, analytics event, or ordinary log line.

A safe response contains only:

```json
{
  "job_id": "opaque-job-id",
  "state": "queued",
  "created_at": "2026-08-27T00:00:00Z",
  "expires_at": "2026-08-27T00:30:00Z",
  "summary": {
    "network": "mainnet",
    "app_id": "ekubo",
    "amount_in": "100000000000000000",
    "token_in": "0x…",
    "token_out": "0x…"
  }
}
```

The status response may add a public transaction hash, receipt status, event summary, and
explorer URL after broadcast. It must not return the proof blob or private proof inputs.

## Security and privacy requirements

- Allowlist app ids, contract addresses, entrypoints, route parameters, token pairs, and
  amount bounds. Reject arbitrary calldata.
- Enforce the linked-recipient guard before queueing. A private action must not name the
  user's wallet, a funding address, or another known facet as its public recipient.
- Use a short TTL. A proof or quote that expires must fail closed and require a fresh quote
  and a fresh proof.
- Use an idempotency key at queue, proof, and broadcast boundaries. Refresh and retries must
  not spend the same note twice.
- Keep the prover on loopback or behind authenticated service-to-service access. It is
  unauthenticated JSON-RPC infrastructure and a public port is a denial-of-service risk.
- Keep job records free of the user-to-facet mapping. Client-side or encrypted-local state is
  the recovery source; a backend must not become the only discovery index.
- Do not claim that fixed denominations, random delays, facet-to-facet restrictions, or
  withdrawal hygiene are enforced until the relevant code and tests enforce them.
- Never auto-broadcast after an unreviewed quote change, a changed recipient, a changed route,
  or a failed proof-aware preflight.

## Route-specific timing

Endur stakes tolerate a multi-minute proof better because the requested amount or share action
does not depend on a short-lived swap quote. Endur is currently the verified delay-tolerant
Mainnet route.
Ekubo is verified but least tolerant of delay because its quote can expire:

1. Build the route and quote immediately before queueing.
2. Carry the exact minimum output in the proof intent.
3. At `proof_ready`, compare the current quote and expiry with the reviewed intent.
4. If the slippage bound is no longer safe, stop and require a new quote and proof.

Starting a long proof before the exact Ekubo quote exists is not a UX optimization; it creates
stale proof work. The working wallet-mediated Endur route demonstrates the delay-tolerant path;
Ekubo remains enabled only with a fresh quote and minimum-output floor.

## Current implementation versus target

| Capability | Current state | Acceptance evidence |
|---|---|---|
| EOA binding and in-memory derivation | Available as the direct-transport identity primitive | Browser/unit tests |
| Persistent app-context metadata | Shipped in the launcher's guarded local lifecycle | `app-context` tests and data file |
| SDK adapters | Built and unit-tested | Endur and Ekubo serializer tests |
| Self-hosted warm prover | Running on the trusted VPS, one proof at a time | `starknet_specVersion` plus full proof results |
| Reviewed wallet-mediated routes | Ekubo, Endur, and xSTRK exit verified | Mainnet receipts and route-specific preflight |
| Queue API and worker supervisor | Next service layer around the verified routes | Must return a job id and persist no secrets |
| Note discovery in browser | Ready X owns discovery for the live wallet-mediated path | Direct transport requires a real note count and selected note |
| Browser proving/submission | Ready X path is live; direct queue transport is next | Mainnet receipt through an allowlisted route |
| Receipt/unified-view update | Shipped for route receipts and portfolio reads | Receipt and expected event verification |

The existing CLI is an operational runner, not the browser queue. It intentionally prompts
for a local encrypted keystore password and keeps the Mainnet broadcast gate explicit. The
first service should reuse its reviewed action-building path, not duplicate protocol logic in
the frontend.

## Post-sprint roadmap

The current release already has a receipt-backed wallet-mediated route suite for Ekubo, Endur, and
the xSTRK exit, plus portfolio reconciliation and encrypted local recovery. The roadmap broadens
transport independence and coverage around that foundation:

1. Add the authenticated two-endpoint job service and warm-worker supervisor around the reviewed
   action boundary. No universal wallet SDK, portfolio indexer, or arbitrary transaction relay.
2. Connect direct note discovery, job polling, receipt verification, and the unified portfolio
   view to that transport while preserving the same policy and settlement checks.
3. Enforce fixed funding denominations, quote expiry, and timing policy in code and tests before
   describing them as guarantees.
4. Revisit direct Facet Mainnet submission when an authorized screening-attestation source is
   available; the current wallet-mediated Mainnet route remains the supported production boundary.
5. Add another adapter only when it uses the same public interface, passes compatibility checks,
   and has a real receipt. Coverage should grow by verified capability, not by route count.

This ordering adds service depth and transport independence around a proven transaction path. It
keeps the current release easy to demonstrate and the evidence boundary explicit.
