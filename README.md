# Facet

**Hide My Email, for your money.**

Facet is a private application launcher for Starknet. Its target model is one shielded balance
funding a persistent, context-specific account for each compatible application or strategy. Mainnet
evidence includes receipt-backed Facet/Ekubo and Facet/Endur actions and deployed Facet helper
contracts; the direct identity sequence is proven on Sepolia.

> **One balance. A different face in every app.**

Facet's privacy goal is to remove the direct public funding link between a shielded balance and
app-specific identities. It is not a guarantee against correlation. It does not hide an app account's downstream protocol activity: its address,
calls, balances, timing, and user-chosen recipients are public or inferable once it reaches
Starknet.

The persistent per-app account and unified recovery portfolio are the product model demonstrated by
the direct Sepolia path, not a completed promise of the current Mainnet wallet-mediated routes.

Read [`docs/PRODUCT.md`](docs/PRODUCT.md) for the product model, privacy boundary,
account lifecycle, and architecture. This README keeps the implementation evidence and
the runnable path close at hand.

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

Facet is designed to give you one persistent identity per application or strategy instead of one
identity forever. The current Mainnet launcher does not yet control those accounts. Where the
direct identity path is used, its private funding does not name you, but public behaviour, repeated
amounts, timing, recipients, or transfers between facets can still create a link.

Built on STRK20 **shadow accounts** — a primitive that lets a proved private transaction
fund a deterministic account, have it call a normal Starknet application, and settle the
result back into shielded notes. Facet turns that primitive into an account and portfolio
model rather than asking users to think in raw commitments, notes, and contract phases.

## New here?

Start with [`docs/PRODUCT.md`](docs/PRODUCT.md) for the product, then use
[`docs/SHADOW_ACCOUNTS.md`](docs/SHADOW_ACCOUNTS.md) for the underlying primitive:
derivation, the action model, the funding pattern, what leaks, and every revert with its
cause. The implementation is intentionally documented at both levels: what a user gets,
and how the protocol makes it possible.

## Quick validation

The fork-backed contract checks run locally from the repository root with the pinned toolchain
and the configured read-only RPC endpoints:

```bash
cd packages/contracts
snforge test
```

The pinned environment is Node 22.23.0 (`.nvmrc`), Scarb 2.17.0, Starknet Foundry 0.59.0, and
Universal Sierra Compiler 2.10.0; it currently runs **20 tests, 0 failures** against Mainnet and
Sepolia forks. If
`snforge` reports that `universal-sierra-compiler` is missing, install the toolchain named in
`.tool-versions` before treating a failed command as a contract failure. The suite does not
prove the full transaction path — that path is proved on chain instead, in
[`docs/FINDINGS.md`](docs/FINDINGS.md) §§6.17–6.18 and the Mainnet receipts below.

---

## The primitive

The STRK20 privacy pool can run compatible dapp calls on a user's behalf through a
per-user *shadow account*, without publishing the private funding link back to the user.
The pool derives an identity key inside a proved execution:

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
by its own contract account. The derivation separates contexts; it cannot prevent a user
from linking them later through public behaviour.

That is a **facet**: one visible face of a single private portfolio, different from
every angle, still one portfolio.

## Architecture at a glance

| Layer | What it does |
|---|---|
| STRK20 privacy pool | Holds shielded STRK notes and applies proved `UseNote`, `Withdraw`, and `ComputeAndInvoke` actions. |
| Viewing-key flow | Uses the wallet-bound private identity inside the proved execution; the key is never written to the repository. |
| Immutable anonymizer | Derives a fresh shadow-account identity from the user, anonymizer, dapp name, and nonce. |
| Shadow account | Becomes the public caller seen by the dapp and is funded at its deterministic address from the private note. |
| Protocol-bound helper | A Facet-owned helper is bound to the pool, STRK, and one protocol vault, then calls only that vault. |
| Ekubo router | Receives the shadow account's STRK call and returns the swap balances for private-note settlement. |
| Transaction prover | Re-executes the signed Invoke V3 and supplies the proof facts required by the pool. |
| Relayer / paymaster | Submits proof-bearing transactions and can sponsor execution where the network path supports it. |

```text
wallet signature + private identity
              │
              ▼
      STRK20 shielded note
              │  UseNote → Withdraw
              ▼
      deterministic shadow account
              │  call the selected protocol as the caller
              ▼
       STRK / ETH private notes
```

## Why this is hard

The underlying contracts exist, but turning them into a reliable product requires more
than deriving a new address. The system has to preserve privacy across funding,
application execution, settlement, proving, fee payment, recovery, and portfolio display.

- A shadow account anonymizer has been live on mainnet since **23 July 2026**
  (`0x4f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7`, deployed at
  block 12,199,879).
- It had been invoked **39 times** by the historical measurement cutoff, and all 39 were
  decoded. Every one in that dataset issues one call against the same contract — the STRK
  token. Thirty-two are `balance_of` reads; seven use `transfer_from` to pull pre-approved
  funds into the shadow account. **None of those 39 historical invocations interacted with a
  DeFi protocol.**
- The current product state is different: Facet has since verified wallet-mediated Mainnet
  actions through its Ekubo and Endur helpers. Those receipts are listed below; the historical
  39-invocation finding is intentionally preserved rather than rewritten.
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
- the one-invoke-per-transaction constraint and the required action ordering

The funding pattern above is also exercised as a test suite against the **live deployed
anonymizer**, forked at mainnet block 13,329,863 — a predicted address is funded before
any code exists at it, and the shadow account deploys exactly there and collects the
balance. The pinned environment has run 20 Cairo tests successfully against recorded
mainnet and Sepolia state, including the decoded invocation replayed against real bytecode
with a control that breaks the decode as it must. A fresh environment must install the
Universal Sierra Compiler named in `.tool-versions`; with that dependency present, the same
fork suite is reproducible. What those tests cannot cover is the proved half — `UseNote`,
`Withdraw`, and the `ClientAction` → `ServerAction` translation are unreachable from a fork
test. That half is proved on chain instead: `FINDINGS.md` §6.17.

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

The claim made here is narrow and checkable: **Facet provides a private account and
portfolio layer by funding context-specific shadow accounts from shielded notes, then
settling application results back into shielded notes.** The implementation evidence,
known limits, and unfinished product layers are all called out below. The intended product
journey is asynchronous because proving takes minutes: queue an allowlisted action, return a
job id, keep a compatible worker warm, and resume by polling. A queue improves the user's
wait experience; it does not make the proof computation faster.

## What exists today

Claims in this README are traceable to a source reference, a block height or a test run.
What is not built is listed as plainly as what is.

| | |
|---|---|
| Research | `docs/FINDINGS.md` — pool, anonymizer, identity derivation, all 39 invocations decoded |
| Contracts | `packages/contracts` — 20 fork tests passing with the pinned Scarb, Foundry, and Universal Sierra Compiler toolchain |
| Prover tooling | `docs/PROVER.md`, `infra/prover/` — diagnosed, fixed, documented, reusable by anyone |
| SDK | `packages/sdk` — adapter, lifecycle, recovery-classification, and private-transaction primitives plus the operational Sepolia runner; build clean, 40 tests passing |
| Private transaction | **executed on Sepolia, 25 August 2026** — see below |
| Product layer | **working wallet-mediated demo** — Facet's reviewed Ekubo/Endur routes, one shared reference executor, a tested Endur exit composition, and a local activity map exist; actual persistent-facet execution control, automatic on-chain recovery, the async service, and a unified portfolio view remain to be built |
| Mainnet contracts | **deployed** — immutable anonymizer, `FacetAccount`, Ekubo helper, and Endur helper are deployed; both current protocol routes have receipt-backed evidence |
| Mainnet interaction | **verified for Ekubo and Endur** — the 7 STRK eligibility shield plus reviewed Facet/Ekubo and Facet/Endur Wallet API actions are confirmed on Mainnet |

The `UseNote → Withdraw → ComputeAndInvoke` sequence was first executed by this project on
25 August 2026. It ran on Starknet Sepolia twice and succeeded — proved by a self-hosted
transaction prover and submitted through a self-hosted paymaster:

- `0x05faace1d275d2a301b10dd1fb3f809cc65d3ba8799fbc68f0828eca4a1dedef`, block 14,018,840 —
  the shadow account deploys at its predicted address, 0.5 STRK is withdrawn to it, and the
  full amount is collected back.
- `0x0111b815a660ee41c17bf285bde7c6b43cbef5bc5d6fbf43d25e94e7f17f3693`, block 14,020,928 —
  the same withdrawal, then **a dapp call executed as the shadow account**, then the
  remainder collected back into the shield. The account's balance afterwards is 0.

- `0x4cee84654535d0f98f7a8e0402fce4c47aab1ff62b6b132d725184e5eb30a07` and
  `0x68510769914a25f6dc9d90fa7f5672bd83908c4ddafc77b1fd6ff3782286b3a` — a second facet
  named `facet-second`; its one-wei call went to an unrelated `0x…dead` recipient rather
  than the owner. The predicted shadow account is `0x560b1983…e2b8`.

The event-level decode is `docs/FINDINGS.md` §6.17. The reviewed Wallet API Ekubo action is now
verified in Mainnet transaction
`0x2d3c449ebb9cef73f953df5c233a6d932c6f0a4dd5f1f54fc5605e3eab236ab`, block 14,004,049:
the receipt succeeded and emitted STRK20 pool and Ekubo core events, while the transaction data
contains the deployed helper and router. The reviewed Wallet API Endur action also succeeded in
`0x240d2b8285a19485536f686ef9915eb1c6ae5214091ebd10b9770ecab2163f5`, block 14,052,044, with
STRK20 pool, Endur helper, and Endur xSTRK events.

There is also a direct Facet Mainnet transaction:
[`0x54ae85094a3baaba9e27c39b52687f3149c6c2a9c532f84452f3d75e4e60b1e`](https://voyager.online/tx/0x54ae85094a3baaba9e27c39b52687f3149c6c2a9c532f84452f3d75e4e60b1e).
It was accepted and finalized on L1, but reverted with `EMPTY_PROOF_FACTS`; its approval and
registration state changes were rolled back. It proves that Facet's direct transaction reached
Mainnet, not that the action succeeded. The later proof-compatible route progressed further and
was rejected before broadcast because it lacked the live pool's authorized screening attestation.
That distinction, including the RPC receipt and AVNU response, is recorded in `docs/FINDINGS.md`
§§6.22 and 6.27. A retired Vesu experiment is preserved there as historical failure analysis,
not presented as a supported route.

## Documentation

| Document | Contents |
|---|---|
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | Product model: private portfolio, context accounts, user flow, privacy boundary, and roadmap |
| [`docs/SHADOW_ACCOUNTS.md`](docs/SHADOW_ACCOUNTS.md) | The guide to the primitive that does not otherwise exist — derivation, the two-tier action model, the funding pattern, what leaks, and every revert with its cause |
| [`docs/FINDINGS.md`](docs/FINDINGS.md) | Everything verified from source and chain data |
| [`docs/PROVER.md`](docs/PROVER.md) | Self-hosting the transaction prover, start to finish |
| [`docs/PRIVATE_DEFI.md`](docs/PRIVATE_DEFI.md) | The complete shielded STRK20-to-DeFi path, prover, proof facts, paymaster, timing, and safe runbook |
| [`docs/ASYNC_PROVING.md`](docs/ASYNC_PROVING.md) | The warm-worker job contract, resumable polling flow, quote expiry rules, and service security boundary |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | Dated record of what was established, and when |

## Current implementation boundary

| Concern | Honest status |
|---|---|
| Protocol adapters | **Implemented as SDK builders, and the live routes now run through one executor.** Both Mainnet pages describe a plan and hand it to `assets/js/executor.js`; neither assembles a Wallet API action any more. The web package ships without a build step, so that module mirrors the SDK's `WalletFacetExecutor` rather than importing it, and `tests/executor-parity.test.mjs` fails if the two ever disagree. |
| Dapp SDK flow | **Reference executor shipped.** `WalletFacetExecutor` implements `FacetExecutor` over the supported Wallet API path, so `executeAppIntent` runs end to end. Golden-vector tests pin its output to the action lists of both verified Mainnet transactions. A different submission path still means implementing `FacetExecutor` yourself. |
| Funding denominations | **Policy primitive only.** `assertFundingDenomination` is tested, but Facet has no Mainnet shielding UI and does not enforce it in the live product. App spend is a separate, user-selected amount. |
| Recipient safeguards | **Mandatory for declared recipients.** Every plan must provide `publicRecipients`, and the executor refuses any declared address in the required linked-address set. Endur declares and checks its receiver; the fixed helper routes have no user-selected recipient. This is an adapter policy boundary, not arbitrary-calldata analysis or a privacy guarantee. The route policy also refuses undeclared assets, out-of-bounds amounts, undeclared asset kinds, an `all` collect policy on a persistent position, and any settlement/open-note mismatch. |
| Lifecycle and recovery | **Model, classification, and a tested exit composition; no general on-chain actuator.** The Endur exit route is implemented to exchange xSTRK for STRK through Ekubo, because Endur's own redemption is a withdrawal queue (`FINDINGS.md` §6.34), but that exit still lacks its Mainnet receipt. The launcher records confirmed hashes and held positions, moves its local record through all five states, and refuses retirement while a position remains. |
| Persistent facets | **Local activity record only.** The launcher stores app, version, lifecycle state, Mainnet transaction hashes and held positions in this browser. It does not derive, create, rotate, recover, or retire an actual on-chain account, and stores no signature, viewing key or recovery secret. |
| Mainnet execution | **Working on Mainnet through a Facet-controlled route.** Facet owns the app intent, adapter plan, helper contracts, route allowlist, amount and recipient policy, settlement rules, and lifecycle record. The current wallet-mediated transport uses Ready X for wallet-side note discovery, screening, proving, and submission; those services are not the Facet product. |
| Direct Facet Mainnet path | **Built and proven on Sepolia; not yet successful on Mainnet.** A direct Facet transaction reached Mainnet and finalized, but reverted with `EMPTY_PROOF_FACTS`. A later compatible proof reached AVNU and stopped before broadcast with `SCREENING_REQUIRED`. The live pool requires an attestation from its authorized screening service; Facet has no production screening endpoint or signing key. StarkWare's merged [shadow-account derivation](https://github.com/starkware-libs/starknet-privacy/pull/954), [pool-policy client](https://github.com/starkware-libs/starknet-privacy/pull/955), and [deposit-address screening](https://github.com/starkware-libs/starknet-privacy/pull/957) changes document that infrastructure boundary. |
| Mainnet evidence | **Verified.** Facet's reviewed Ekubo and Endur routes succeeded on Mainnet through the wallet-mediated transport. The third successful STRK20 transaction is an eligibility shield, not a third Facet app action. The direct Facet Mainnet attempt is independently visible on chain, but reverted and is not counted as a success. A successful direct launcher-to-protocol receipt remains missing. |

## License

MIT. See [LICENSE](LICENSE).
