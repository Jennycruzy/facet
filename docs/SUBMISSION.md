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
    "0x240d2b82…163f5"
  ],
  "contracts": [
    "0x741fe9dcdf3729919e8c44422fbb963e76a0788f3abad20bb25a50445f363bc",
    "0x42e9d345c46705408394b7a67e291c2bde9f2638297125a7fec2b5740371a45",
    "0x2bd92991a0c90757caeb5d0908892637d4288ff4e2013877e0a2707a3788537",
    "0x7568567a11a8072521e4e78f635fd3a4fb07c6bcea4dff909b5109a51c5e4b6",
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
| 2 | `0x2d3c449ebb9cef73f953df5c233a6d932c6f0a4dd5f1f54fc5605e3eab236ab` | **Done** — reviewed Ready X Wallet API action, `SUCCEEDED` and `ACCEPTED_ON_L2` in block 14,004,049; receipt contains STRK20 pool events, and transaction data carries the Facet helper plus Ekubo router |
| 3 | `0x240d2b8285a19485536f686ef9915eb1c6ae5214091ebd10b9770ecab2163f5` | **Done** — reviewed Ready X Wallet API Endur action, `SUCCEEDED` and `ACCEPTED_ON_L2` in block 14,052,044; receipt contains STRK20 pool events, the deployed Endur helper, and Endur xSTRK events |

The Vesu Wallet API attempt returned `PaymasterV2Error` code 156 without a transaction hash. It is
a failed request, not submission evidence; direct simulation reproduced the Vesu migration
extension's `before_modify_position: "not-allowed"` revert, so that route is paused. The Endur
route now supplies the third successful Mainnet transaction.

The minimum three-hash target is now satisfied by the eligibility shield, the Facet/Ekubo action,
and the Facet/Endur action. The optional working target remains **four usable hashes** so that the
three strongest can be submitted if a further route is safe and genuinely verified. Registration,
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
`0x42e9d345c46705408394b7a67e291c2bde9f2638297125a7fec2b5740371a45`; the deployed Ekubo,
Vesu, and Endur helpers are `0x2bd92991a0c90757caeb5d0908892637d4288ff4e2013877e0a2707a3788537`,
`0x7568567a11a8072521e4e78f635fd3a4fb07c6bcea4dff909b5109a51c5e4b6`, and
`0x292df14818896b5366a075581471b4dd9436f6590f696e6f9658a777c4a1240`.

Deployment transactions:

- immutable anonymizer: `0x277a84c5b063c235acdd5b5e866e2c6078554517e984536b3bb889b26f07922`
- `FacetAccount`: `0x4e9305a7b362901c0ccd1017bba3269993e724383c1fa9608ba94a63011732f`
- Ekubo helper: `0x188808f3c11914c6ada25cae55defe4d34332f4ff955d1eb272ce9962f08dfc`

The two Facet contracts and the helper were submitted after successful class declarations and
verified with the expected class hashes. The contracts are not added to `transactions` yet:
that list is reserved for the mainnet activity evidence required by the submission.

The Vesu and Endur helper instances are declared and deployed. Their deployment addresses are
included above; their deployment transactions are intentionally absent from `transactions`,
which is reserved for successful Mainnet activity touching the STRK20 pool.

Verify each address returns a class hash before adding it:

```bash
curl -s https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_10 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getClassHashAt","params":["latest","<address>"]}'
```

## `demo_url`

**Previously deployed and verified — `https://usefacet.xyz`.** The live nginx root currently
serves the `c513aa6` build with the verified Endur / paused Vesu card state;
`/launch.html`, `/mainnet-ekubo.html`, `/mainnet-defi.html?protocol=vesu`, and
`/mainnet-defi.html?protocol=endur` returned 200 and passed the VPS-side obvious-secret scan.
The prior release is preserved at
`/var/www/facet.backup-20260829T064000Z`.

```bash
curl -sI https://usefacet.xyz | head -1     # expect HTTP/2 200
```

## `demo_video`

Empty. Target: under two minutes, real Mainnet evidence, hashes visible, and a screen recording
with no hidden success claim. The proof may be pre-generated for the recording if the description
says so; the live product must still show the honest queued/proving stages.

**State the proving time honestly.** Proving takes roughly five to seven minutes on the
current self-hosted development host; pre-generating
proofs for the recording is fine, and saying so in the video description is what keeps it
honest. A judge who discovers a demo was cut to hide a six-minute wait discounts everything
else — and by this project's own stated standard, that is disqualifying.

## Product claims the submission may make

- “One balance. A different face in every app.”
- Facet provides unlinkability between the shielded balance and app-specific identities.
- A facet is persistent per application or strategy; the nonce is for deliberate rotation.
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

- [ ] `git log --format='%an <%ae>' | sort -u` returns exactly one line, `Jennycruzy`
- [ ] No AI attribution anywhere — messages, docs, comments
- [ ] `git ls-files | grep -iE 'handoff|runbook'` returns nothing (both are local-only and
      contain host paths and account names that must not be published)
- [ ] Secret scan clean across full history
- [ ] Fresh clone installs, builds and tests with no manual steps
- [ ] Every claim in the README traceable to a hash, a source reference or a test run
- [ ] The limitations section still states what is *not* done
- [ ] `transactions` contains three verified Mainnet hashes, each with a successful receipt and
      STRK20 pool event; the strongest one or two demonstrate Facet's own protocol path
- [ ] `demo_url` serves the current checkout, including `/launch.html`, over HTTPS
- [ ] `demo_video` is public, under two minutes, and states the real proving/queue behaviour
- [ ] Async queue records contain no private keys, signatures, viewing keys, passwords, or proof blobs
- [ ] Any second application shown as live has a real network rehearsal and receipt; otherwise it
      is labelled preview-only
