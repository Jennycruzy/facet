# Submission checklist

`strk20.json` at the repository root is the submission. Everything else — the code, the
docs, the page — is only reachable through it. This file records exactly what each field
needs, what is in it now, and how to verify a value before it is added.

## Current state

```json
{
  "transactions": ["0x0721505c…5716a"],
  "contracts": [
    "0x741fe9dcdf3729919e8c44422fbb963e76a0788f3abad20bb25a50445f363bc",
    "0x42e9d345c46705408394b7a67e291c2bde9f2638297125a7fec2b5740371a45"
  ],
  "demo_video": "",
  "demo_url": ""
}
```

## `transactions` — mainnet only

**Requirement: at least three successful Starknet mainnet transactions touching the STRK20
pool.** There is no cap, and more is better evidence.

| # | Transaction | State |
|---|---|---|
| 1 | `0x0721505c4a33bf6457ad21781d7b798203f06faa7ca054a857b738058045716a` | **Done** — 7 STRK eligibility shield, block 13,538,709 |
| 2 | — | A mainnet contract interaction that touches the STRK20 pool |
| 3 | — | First DeFi interaction through a shadow account |

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

The immutable anonymizer is
`0x741fe9dcdf3729919e8c44422fbb963e76a0788f3abad20bb25a50445f363bc`; `FacetAccount` is
`0x42e9d345c46705408394b7a67e291c2bde9f2638297125a7fec2b5740371a45`.

Deployment transactions:

- immutable anonymizer: `0x277a84c5b063c235acdd5b5e866e2c6078554517e984536b3bb889b26f07922`
- `FacetAccount`: `0x4e9305a7b362901c0ccd1017bba3269993e724383c1fa9608ba94a63011732f`

Both were submitted after successful class declarations and verified by the deployment
script with the expected class hashes. The contracts are not added to `transactions` yet:
that list is reserved for the mainnet activity evidence required by the submission.

Verify each address returns a class hash before adding it:

```bash
curl -s https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_9 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getClassHashAt","params":["latest","<address>"]}'
```

## `demo_url`

`https://usefacet.xyz` — the domain is registered and pointed at the project's host, and
`packages/web` is what it serves. **Do not write this field until the certificate is issued
and the URL loads over HTTPS in a cold browser with no wallet and no extensions.** A judge
meeting a certificate warning is worse than a judge meeting an empty field.

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
