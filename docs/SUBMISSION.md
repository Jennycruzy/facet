# Submission checklist

`strk20.json` at the repository root is the submission. Everything else — the code, the
docs, the page — is only reachable through it. This file records exactly what each field
needs, what is in it now, and how to verify a value before it is added.

The sprint closes on **31 August 2026 at 23:59 UTC**. The judging-critical evidence is a
working Mainnet product, integration, and a short reproducible demo. A queued proof is a UX
feature, not a Mainnet hash: only a successful receipt with the required STRK20 pool event
counts as transaction evidence.

## Current state

```json
{
  "transactions": [
    "0x0721505c…5716a",
    "0x2d3c449e…36ab",
    "0x240d2b82…163f5",
    "0xf5ac560c…90b0"
  ],
  "contracts": [
    "0x741fe9dcdf3729919e8c44422fbb963e76a0788f3abad20bb25a50445f363bc",
    "0x42e9d345c46705408394b7a67e291c2bde9f2638297125a7fec2b5740371a45",
    "0x2bd92991a0c90757caeb5d0908892637d4288ff4e2013877e0a2707a3788537",
    "0x292df14818896b5366a075581471b4dd9436f6590f696e6f9658a777c4a1240"
  ],
  "demo_video": "",
  "demo_url": "https://usefacet.xyz"
}
```

## `transactions` — mainnet only

**Requirement: at least three successful Starknet mainnet transactions touching the STRK20
pool.** There is no cap, and more is better evidence.

| # | Transaction | State |
|---|---|---|
| 1 | `0x0721505c4a33bf6457ad21781d7b798203f06faa7ca054a857b738058045716a` | **Done** — 7 STRK eligibility shield through Ready X, block 13,538,709; valid pool evidence but not a Facet DeFi action |
| 2 | `0x2d3c449ebb9cef73f953df5c233a6d932c6f0a4dd5f1f54fc5605e3eab236ab` | **Done** — reviewed Ready X Wallet API action, `SUCCEEDED` and `ACCEPTED_ON_L1` in block 14,004,049; receipt contains STRK20 pool events, and transaction data carries the Facet helper plus Ekubo router |
| 3 | `0x240d2b8285a19485536f686ef9915eb1c6ae5214091ebd10b9770ecab2163f5` | **Done** — reviewed Ready X Wallet API Endur action, `SUCCEEDED` and `ACCEPTED_ON_L1` in block 14,052,044; receipt contains STRK20 pool events, the deployed Endur helper, and Endur xSTRK events |
| 4 | `0xf5ac560c25e7935cb47691d2f025735395e45d04de723a818d5b5a2df090b0` | **Done** — reviewed xSTRK exit action, `SUCCEEDED` and `ACCEPTED_ON_L2` in block 14,134,005; transaction uses the deployed Facet helper and Ekubo router, with STRK20 pool/protocol events and xSTRK/STRK transfers in the receipt |

### How the registry actually counts these

The sprint registry does not simply count hashes. Its published `projects.json` records a
`verified_txs` figure and a per-transaction `mine` flag, and the observed rule across the
field is that a transaction counts only when the project's **own** contract addresses appear
in that transaction, and the `mainnet` requirement flips true at **three** such transactions.

The registry's own note against the eligibility shield is explicit: *"touched the pool, but
not through this project's contracts"*. It is scored `mine: false`. The Ekubo, Endur, and
xSTRK exit actions each carry a deployed Facet helper in their calldata and are scored
`mine: true`.

The practical consequences, worth stating plainly:

- The 7 STRK eligibility shield is real pool evidence but **does not count toward the
  three-transaction requirement**. Only the three Facet protocol actions do.
- Facet's helpers appear in transaction **calldata**, not as event emitters — the helper is
  the caller, so the events belong to STRK, the pool, and the protocol. That is the expected
  shape and is what the scored transactions already demonstrate.
- A registry snapshot reflects the repository at the commit it last scanned, not the current
  `strk20.json`. A newly added hash is only counted after a rescan.

The retired Vesu experiment is not submission evidence; its failed request and direct simulation
are preserved in `FINDINGS.md` §§6.30–6.31. The current submission surface contains three
receipt-backed protocol routes: Ekubo, Endur, and the xSTRK exit.

The minimum three-hash target is now exceeded by the eligibility shield and three Facet protocol
actions: Ekubo, Endur, and the xSTRK exit. The optional working target remains **four usable hashes**
so that the three strongest can be submitted if a further route is safe and genuinely verified. Registration,
deposit, and protocol action all require proofs on the deployed pool; none is a proof-free shortcut.

**Sepolia hashes do not belong in this file.** The two transactions that prove the §6.6
sequence — `0x5faace1d…dedef` and `0x111b815a…f3693` — are Sepolia. They are the project's
strongest technical evidence and they belong in the README, `FINDINGS.md` §6.17 and the
page, but putting them in `transactions` would claim mainnet activity that has not happened.

Verify before adding:

```bash
curl -s https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_10 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getTransactionReceipt","params":["<hash>"]}' \
  | grep -o '"execution_status":"[^"]*"'
# must print SUCCEEDED
```

## `contracts` — mainnet addresses

The immutable anonymizer is
`0x741fe9dcdf3729919e8c44422fbb963e76a0788f3abad20bb25a50445f363bc`; `FacetAccount` is
`0x42e9d345c46705408394b7a67e291c2bde9f2638297125a7fec2b5740371a45`; the deployed Ekubo
and Endur helpers are `0x2bd92991a0c90757caeb5d0908892637d4288ff4e2013877e0a2707a3788537` and
`0x292df14818896b5366a075581471b4dd9436f6590f696e6f9658a777c4a1240`.

Deployment transactions:

- immutable anonymizer: `0x277a84c5b063c235acdd5b5e866e2c6078554517e984536b3bb889b26f07922`
- `FacetAccount`: `0x4e9305a7b362901c0ccd1017bba3269993e724383c1fa9608ba94a63011732f`
- Ekubo helper: `0x188808f3c11914c6ada25cae55defe4d34332f4ff955d1eb272ce9962f08dfc`

The two Facet contracts and the helper were submitted after successful class declarations and
verified with the expected class hashes. The contracts are not added to `transactions` yet:
that list is reserved for the mainnet activity evidence required by the submission.

The Endur helper is declared and deployed. Its deployment address is included above; its
deployment transaction is intentionally absent from `transactions`, which is reserved for
successful Mainnet activity touching the STRK20 pool. The retired Vesu helper is omitted from
the current submission contract list.

Verify each address returns a class hash before adding it:

```bash
curl -s https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_10 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getClassHashAt","params":["latest","<address>"]}'
```

## `demo_url`

**Previously deployed and verified — `https://usefacet.xyz`.** The live nginx root currently
serves the release with the verified route cards;
`/launch.html`, `/mainnet-ekubo.html`, and `/mainnet-defi.html` returned 200 and passed the
VPS-side obvious-secret scan.
The prior release is preserved at
`/var/www/facet.backup-20260831T060227Z-4121433`.

```bash
curl -sI https://usefacet.xyz | head -1     # expect HTTP/2 200
```

## `demo_video`

Empty. Target: **three minutes** — the length the sprint asks for — with real Mainnet
evidence, hashes visible, and a screen recording that makes no hidden success claim. The
recording may use the already-verified receipts if it says so, and must not imply that an
unverified route succeeded.

**The recording is the Ready X wallet path.** That is the path with receipts, so it is the
path to film, and it proves on Ready X's infrastructure rather than ours. Record it live;
there is nothing to pre-generate and therefore nothing to disclose.

**Do not narrate proving time.** The five-to-seven-minute figure belongs to the local Zen 2
development prover on the direct path (`ADAPTERS.md` §"Proving starts early", `PRIVATE_DEFI.md` §"Timing and product expectations"), not to the
wallet actions on screen. It is already written down for any judge who wants it, and repeating
it over a Ready X recording would misattribute the direct path's latency to the product. State
a duration only if it was measured on the take being shipped.

The verified Mainnet actions used Ready X's wallet-mediated STRK20 path rather than the VPS's
direct Facet runner. Do not present a wallet-mediated receipt as a direct `FacetAccount`
signature.

## Product claims the submission may make

- “One balance. A different face in every app.”
- Facet is designed to remove the direct public funding link between a shielded balance and an
  app-specific identity; downstream correlation remains possible.
- The architecture defines a persistent facet per application or strategy and deliberate nonce
  rotation; the current browser map is metadata only and does not control that on-chain lifecycle.
- Facet reaches compatible Starknet applications through account-level execution and does not
  require protocol contract changes.
- Downstream activity from a facet is public or inferable once it touches a protocol.
- Fungible token deltas may be recoverable into shielded notes; LP positions, debt, NFTs,
  staking receipts, and other persistent protocol positions are not automatically swept back.
- The current prover is self-hosted. Hosted or client-side acceleration is future work unless
  a supported service is verified before submission.

Do not call an app live because its tile exists. It is live only after its calldata, preflight,
proof, receipt, expected pool event, protocol event, and post-action state have been checked.

## Before submitting

- [x] `git log --format='%an <%ae>' | sort -u` returns exactly one line, `Jennycruzy`
- [x] No AI attribution anywhere — messages, docs, comments
- [x] `git ls-files | grep -iE 'handoff|runbook'` returns nothing (both are local-only and
      contain host paths and account names that must not be published)
- [x] Secret scan clean across the current tree, reachable history, and the pre-identity-rewrite
      recovery bundle
- [x] Fresh clone installs, builds and tests with no manual steps
- [x] Every claim in the README traceable to a hash, a source reference or a test run
- [x] The limitations section still states what is *not* done
- [x] `transactions` contains four verified Mainnet hashes, each with a successful receipt and
      STRK20 pool event; the strongest one or two demonstrate Facet's own protocol path
- [x] `demo_url` serves the current checkout over HTTPS, including the clean route URLs
      `/launch`, `/ekubo`, `/endur` and `/proof` (the `.html` paths 301 to these)
- [ ] `demo_video` is public, three minutes or under, films the Ready X path, and claims no
      duration that was not measured on the take being shipped
- [x] No async queue is shipped in this release, so there are no queue records containing private
      keys, signatures, viewing keys, passwords, or proof blobs
- [x] Any second application shown as live has a real network rehearsal and receipt; otherwise it
      is labelled preview-only
