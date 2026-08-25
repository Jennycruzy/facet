# Submission checklist

`strk20.json` at the repository root is the submission. Everything else — the code, the
docs, the page — is only reachable through it. This file records exactly what each field
needs, what is in it now, and how to verify a value before it is added.

## Current state

```json
{
  "transactions": ["0x0721505c…5716a"],
  "contracts": [],
  "demo_video": "",
  "demo_url": "https://usefacet.xyz"
}
```

## `transactions` — mainnet only

**Requirement: at least three successful Starknet mainnet transactions touching the STRK20
pool.** There is no cap, and more is better evidence.

| # | Transaction | State |
|---|---|---|
| 1 | `0x0721505c4a33bf6457ad21781d7b798203f06faa7ca054a857b738058045716a` | **Done** — 7 STRK eligibility shield, block 13,538,709 |
| 2 | — | Contract deployments (Gate B) |
| 3 | — | First DeFi interaction through a shadow account (Gate C) |

**Sepolia hashes do not belong in this file.** The two transactions that prove the §6.6
sequence — `0x5faace1d…dedef` and `0x111b815a…f3693` — are Sepolia. They are the project's
strongest technical evidence and they belong in the README, `FINDINGS.md` §6.17 and the
page, but putting them in `transactions` would claim mainnet activity that has not happened.

Verify before adding:

```bash
curl -s https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_9 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getTransactionReceipt","params":["<hash>"]}' \
  | grep -o '"execution_status":"[^"]*"'
# must print SUCCEEDED
```

## `contracts` — mainnet addresses

Empty. Filled by Gate B: `FacetAccount` and the immutable anonymizer, deployed to mainnet.
Both exist in `packages/contracts` with 20 fork tests passing; neither is deployed.

Verify each address returns a class hash before adding it:

```bash
curl -s https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_9 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getClassHashAt","params":["latest","<address>"]}'
```

## `demo_url`

**Done — `https://usefacet.xyz`.** Certificate issued 25 August 2026 (Let's Encrypt, ECDSA,
covers apex and `www`), HTTP redirects to HTTPS, and the page was loaded cold in a browser
with no wallet and no extensions: 200, no console errors, and its live Sepolia and mainnet
reads all resolved.

```bash
curl -sI https://usefacet.xyz | head -1     # expect HTTP/2 200
```

## `demo_video`

Empty. Under two minutes, real mainnet, hashes visible, screen recording only.

**State the proving time honestly.** Proving takes five to six minutes; pre-generating
proofs for the recording is fine, and saying so in the video description is what keeps it
honest. A judge who discovers a demo was cut to hide a six-minute wait discounts everything
else — and by this project's own stated standard, that is disqualifying.

## Before submitting

- [ ] `git log --format='%an <%ae>' | sort -u` returns exactly one line, `Jennycruzy`
- [ ] No AI attribution anywhere — messages, docs, comments
- [ ] `git ls-files | grep -iE 'handoff|runbook'` returns nothing (both are local-only and
      contain host paths and account names that must not be published)
- [ ] Secret scan clean across full history
- [ ] Fresh clone installs, builds and tests with no manual steps
- [ ] Every claim in the README traceable to a hash, a source reference or a test run
- [ ] The limitations section still states what is *not* done
