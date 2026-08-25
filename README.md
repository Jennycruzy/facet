# Facet

**Hide My Email, for your money.**

One shielded balance, and a fresh unlinkable address for every app you touch. Ekubo sees
one address. Vesu sees a different one. Neither can be traced to you, or to each other.

Every Starknet address is a permanent public record of everything its owner has ever done.
That is not an abstract problem:

- **Copy-trading and front-running.** A trader who is good at this gets watched. Their
  entries get front-run, and there is nothing they can do about it while their positions
  are public and attributable.
- **Liquidation hunting.** A leveraged position has a public liquidation price, and
  searchers hunt it deliberately.
- **Portfolio doxxing.** Anyone who learns your address knows your net worth — permanently,
  and in some jurisdictions that is a physical safety problem rather than a privacy
  preference.

Facet gives you one identity per context instead of one identity forever. The funding never
names you, and the identities are not linked to each other on chain.

Built on STRK20 **shadow accounts** — a primitive that is deployed on mainnet, supported by
the official SDK, named in the sprint's judging criteria, documented nowhere, and which had
never once been funded from a shielded note until this project did it.

> **Status: in development.** Built during the [STRK20 Private Sprint](https://strk20.starknet.io),
> 14–31 August 2026. Nothing here is audited. Do not route funds you cannot afford to
> lose. Claims in this README are traceable to a source reference or a transaction
> hash; anything not yet done is marked as such.

## New here?

[`docs/SHADOW_ACCOUNTS.md`](docs/SHADOW_ACCOUNTS.md) is the guide to this primitive that
does not otherwise exist — derivation, the action model, the funding pattern, what leaks,
and every revert with its cause. It is the document we needed and could not find.

## Quick validation

The fork-backed contract checks can be run locally from the repository root:

```bash
cd packages/contracts
snforge test
```

The suite currently covers 20 tests against recorded mainnet and Sepolia state. It does not
prove the full transaction path — that path is proved on chain instead, in
[`docs/FINDINGS.md`](docs/FINDINGS.md) §6.17.

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

The funding pattern above is also exercised as a test suite against the **live deployed
anonymizer**, forked at mainnet block 13,329,863 — a predicted address is funded before
any code exists at it, and the shadow account deploys exactly there and collects the
balance. `snforge test` in `packages/contracts` runs **20 tests, all passing** against
recorded mainnet and Sepolia state, including the decoded invocation replayed against real
bytecode with a control that breaks the decode as it must. What those tests cannot cover is
the proved half — `UseNote`, `Withdraw`, and the `ClientAction` → `ServerAction` translation
are unreachable from a fork test. That half is proved on chain instead: `FINDINGS.md` §6.17.

## Running the prover yourself

`apply_actions` needs a proof, and we could not find a hosted proving endpoint published
anywhere — every reference in the SDK, the docs dump and the demo configuration is a
placeholder. The transaction prover is a public container, so the answer is to run it. The
catch is that **the published `linux/amd64` image aborts with SIGILL on older AMD hosts**,
before it reads any configuration, in a way that looks like a broken pull.

It is a build flag: the published image is compiled for Zen 5. Rebuilding the same upstream
revision for your own target fixes it.

[`docs/PROVER.md`](docs/PROVER.md) is the whole thing written down — the diagnosis, the fix,
the measured memory floor, the request format, the historical-replay trap that costs a day,
and which RPC providers actually serve the storage proofs the prover needs. Alongside it:

| | |
|---|---|
| [`infra/prover/build.sh`](infra/prover/build.sh) | Builds for any CPU target and verifies the binary starts |
| [`infra/prover/docker-compose.yml`](infra/prover/docker-compose.yml) | Loopback binding, memory limit, working health check |
| `ghcr.io/jennycruzy/facet-prover:znver2` | Prebuilt for Zen 2 and newer AMD, if you would rather not build |

Two proofs generated on a 2 vCPU host, **355s and 485s**, peaking at 6.6 GiB. Neither is a
benchmark — the same request on the same machine varied by 27%, which is itself worth
knowing before you size anything.

None of this is specific to Facet. If you are building on STRK20 and hit the same wall, take
it.

## Honest positioning

Facet is not a new privacy protocol. It uses StarkWare's, unmodified.

It is not a claim of exclusivity: of 326 compute-path calls on mainnet, 287 went to six
other custom anonymizers built by other teams. Others are competent in this territory
— they rolled their own rather than using the shadow account contract.

Nor is it a claim that nobody has funded a shadow account — seven `transfer_from`
transactions have. The difference is that their method needs a public `approve` from a
funded address, naming the shadow account as spender, which links a real identity to
the facet.

The claim made here is narrow and checkable: **all 39 invocations target the STRK token
contract, and no shadow account has ever interacted with a DeFi protocol.** Facet aims
to be the first, and to leave behind the SDK and the documentation that would let
anyone else do it too.

## What exists today

Claims in this README are traceable to a source reference, a block height or a test run.
What is not built is listed as plainly as what is.

| | |
|---|---|
| Research | `docs/FINDINGS.md` — pool, anonymizer, identity derivation, all 39 invocations decoded |
| Contracts | `packages/contracts` — 20 fork tests against live mainnet and Sepolia state, all passing |
| Prover tooling | `docs/PROVER.md`, `infra/prover/` — diagnosed, fixed, documented, reusable by anyone |
| SDK | `packages/sdk` — the Gate A action builder over the Starknet privacy SDK, plus the operational Sepolia runner; build clean, 9 tests passing |
| Private transaction | **executed on Sepolia, 25 August 2026** — see below |
| Application | **not built** |
| Mainnet interaction | **eligibility shield complete** — one 7 STRK Ready X shield touched the STRK20 pool; no shadow account has touched a DeFi protocol |

The `UseNote → Withdraw → ComputeAndInvoke` sequence had never been executed by anyone. On
25 August 2026 it ran on Starknet Sepolia, twice, and succeeded — proved by a self-hosted
transaction prover and submitted through a self-hosted paymaster:

- `0x05faace1d275d2a301b10dd1fb3f809cc65d3ba8799fbc68f0828eca4a1dedef`, block 14,018,840 —
  the shadow account deploys at its predicted address, 0.5 STRK is withdrawn to it, and the
  full amount is collected back.
- `0x0111b815a660ee41c17bf285bde7c6b43cbef5bc5d6fbf43d25e94e7f17f3693`, block 14,020,928 —
  the same withdrawal, then **a dapp call executed as the shadow account**, then the
  remainder collected back into the shield. The account's balance afterwards is 0.

The event-level decode is `docs/FINDINGS.md` §6.17. The application on top of this is not
built, and nothing here claims otherwise.

## Documentation

| Document | Contents |
|---|---|
| [`docs/SHADOW_ACCOUNTS.md`](docs/SHADOW_ACCOUNTS.md) | The guide to the primitive that does not otherwise exist — derivation, the two-tier action model, the funding pattern, what leaks, and every revert with its cause |
| [`docs/FINDINGS.md`](docs/FINDINGS.md) | Everything verified from source and chain data |
| [`docs/PROVER.md`](docs/PROVER.md) | Self-hosting the transaction prover, start to finish |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | Dated record of what was established, and when |

## License

MIT. See [LICENSE](LICENSE).
