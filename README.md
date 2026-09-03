# Facet

**Hide My Email, for your money.**

## Demo

- **Live demo:** [usefacet.xyz](https://usefacet.xyz)
- **SDK:** [`@usefacet/sdk`](https://www.npmjs.com/package/@usefacet/sdk)
- **Demo video:** [Watch the Facet walkthrough](https://youtu.be/LQwBiPYvbAw?si=i4wV57fpjLK4u0Sa)

The recording shows the reviewed wallet-mediated Mainnet path. Receipt-backed transactions,
technical evidence, and the product boundary are documented below.

Facet is a private application launcher for Starknet. Its target model is one shielded balance
funding a persistent, context-specific account for each compatible application or strategy. Mainnet
evidence includes receipt-backed Facet/Ekubo, Facet/Endur, and xSTRK exit actions and deployed
Facet helper contracts; the direct identity sequence is proven on Sepolia.

> **One balance. A different face in every app.**

Facet's privacy goal is to remove the direct public funding link between a shielded balance and
app-specific identities. It is not a guarantee against correlation. It does not hide an app account's downstream protocol activity: its address,
calls, balances, timing, and user-chosen recipients are public or inferable once it reaches
Starknet.

The launcher now reads the unified private portfolio from Ready X and can reconcile deterministic
per-app accounts from the Mainnet anonymizer when the connected wallet exposes the optional
shadow-account commitment request. The current Mainnet routes still fall back honestly to the
wallet-mediated helper path when that capability is absent; the direct write path remains gated by
the pool's external screening attestation.

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
identity forever. The Mainnet launcher can now reconcile those deterministic accounts when the
wallet exposes the required read capability; funding and direct account execution still depend on
the wallet and pool transport. Where the direct identity path is used, its private funding does
not name you, but public behaviour, repeated amounts, timing, recipients, or transfers between
facets can still create a link.

Built on STRK20 **shadow accounts** — a primitive that lets a proved private transaction
fund a deterministic account, have it call a normal Starknet application, and settle the
result back into shielded notes. Facet turns that primitive into an account and portfolio
model rather than asking users to think in raw commitments, notes, and contract phases.

> **Status: in development.** Nothing here is audited. Do not route funds you cannot
> afford to lose. Claims in this README are traceable to a source reference or a
> transaction hash; anything not yet done is marked as such.

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
  actions through its Ekubo and Endur helpers, including the xSTRK exit. Those receipts are listed
  below; the historical 39-invocation finding is intentionally preserved rather than rewritten.
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
known limits, and next product layers are all called out below. The current wallet-mediated
journey is live and receipt-backed; the next direct-Facet transport tier can add an asynchronous
job id, a warm compatible worker, and resumable polling around the same reviewed action path.
A queue improves the user's wait experience; it does not make the proof computation faster.

## What exists today

Claims in this README are traceable to a source reference, a block height or a test run.
What is not built is listed as plainly as what is.

| | |
|---|---|
| Research | `docs/FINDINGS.md` — pool, anonymizer, identity derivation, all 39 invocations decoded |
| Contracts | `packages/contracts` — 20 fork tests passing with the pinned Scarb, Foundry, and Universal Sierra Compiler toolchain |
| Prover tooling | `docs/PROVER.md`, `infra/prover/` — diagnosed, fixed, documented, reusable by anyone |
| SDK | `packages/sdk` — adapter, lifecycle, recovery-classification, private-transaction primitives, and a tested compatible-app example plus the operational Sepolia runner; build clean, 73 automated tests passing |
| Private transaction | **executed on Sepolia, 25 August 2026** — see below |
| Product layer | **working wallet-mediated Mainnet product with chain-backed portfolio reads** — Facet's reviewed Ekubo/Endur routes, xSTRK exit composition, six receipt-backed Mainnet protocol actions, shared SDK executor, private-balance reader, optional deterministic account reconciliation, encrypted recovery view, local activity cache, and generated browser SDK bundle are shipped; direct shadow-account writes and the async service are expansion tracks |
| Mainnet contracts | **deployed** — immutable anonymizer, `FacetAccount`, Ekubo helper, and Endur helper are deployed; the current protocol routes have receipt-backed evidence |
| Mainnet interaction | **verified across Ekubo and Endur** — the 7 STRK eligibility shield plus six reviewed Facet protocol actions are confirmed on Mainnet |

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

The reviewed xSTRK exit then succeeded in
`0xf5ac560c25e7935cb47691d2f025735395e45d04de723a818d5b5a2df090b0`, block 14,134,005:
the configured Facet helper sent the xSTRK position through Ekubo's initialised pool and the
STRK result returned to the private balance. The receipt contains STRK20 pool and protocol/token
events, and its transfer path identifies the configured helper and Ekubo router.

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

| Concern | Implemented work and current boundary |
|---|---|
| Protocol adapters | **Implemented and exercised.** One public `ProtocolAdapter` interface powers the Ekubo and Endur builders. Each produces reviewed protocol calls, helper bindings, amount bounds, settlement hints, and recipient declarations; the browser and SDK executors are pinned by parity tests. Facet supports compatible, reviewed applications rather than arbitrary calldata. |
| Dapp SDK flow | **Implemented reference flow.** An application supplies intent; Facet selects the adapter, builds and validates the plan, then hands it to `FacetExecutor`. `executeAppIntent`, the shared executor, and [`packages/sdk/examples/compatible-app.ts`](packages/sdk/examples/compatible-app.ts) cover the complete `intent → plan → execution` composition, with golden vectors matching the verified Ekubo and Endur actions. A different submission transport can implement the same executor interface. |
| Funding and spend policy | **Separated and tested.** Facet defines fixed public pool-funding denominations while allowing a user-selected app spend within each route's bounds. `assertFundingDenomination` and the route policies are covered by tests; the current Mainnet shielding surface remains a wallet integration boundary rather than a Facet UI feature. |
| Recipient and route safeguards | **Implemented for declared route inputs.** Every plan declares its public recipients, and the SDK/browser executors reject linked recipients, unsupported assets, invalid amount bounds, undeclared asset kinds, unsafe collection policies, and settlement/open-note mismatches. This is a strong adapter policy boundary, not an arbitrary-calldata decoder or a promise that downstream activity cannot correlate. |
| Lifecycle and recovery | **Implemented for local state and confirmed route exits.** The launcher and SDK use `launch → use → hold → recover → retire`, expose guarded recovery/retirement controls, classify fungible deltas separately from persistent positions, and include the Endur xSTRK → STRK exit through Ekubo. Fungible balances can be recovered where the route declares them safe; xSTRK, LP positions, debt, NFTs, and receipts still require explicit protocol exits. The configured xSTRK exit has a receipt-backed Mainnet execution. |
| Persistent facets | **Deterministic discovery and privacy-preserving local recovery shipped where supported.** The launcher reads Ready X's private balances and, when the wallet exposes `wallet_strk20ShadowAccountCommitment`, resolves each app context through the Mainnet anonymizer and reads public token balances. Temporary activity lives in sessionStorage; optional cross-session recovery uses one fixed-namespace AES-GCM envelope unlocked by the user's passphrase, never a plaintext wallet/app index. Missing or unverified lifecycle state stays read-only. Direct Mainnet shadow-account execution still needs a wallet transport plus the pool's screening attestation. |
| Mainnet execution | **Facet-owned routes are live.** Facet owns the intent, adapter plan, helper contracts, route allowlist, calldata, amount/recipient policy, settlement rules, and lifecycle record behind the verified Ekubo, Endur, and xSTRK exit actions. The current Wallet API is the transport adapter for wallet-side signing, proof handling, and submission; it does not define Facet's product or route policy. |
| Direct Facet Mainnet path | **Direct transport evidence exists.** The direct Facet transaction reached and finalized on Mainnet before reverting with `EMPTY_PROOF_FACTS`; a later compatible proof reached AVNU and stopped before broadcast with `SCREENING_REQUIRED`. The complete direct identity sequence is proven on Sepolia. A production screening-attestation source is the remaining Mainnet infrastructure dependency, documented with StarkWare's [shadow-account derivation](https://github.com/starkware-libs/starknet-privacy/pull/954), [pool-policy client](https://github.com/starkware-libs/starknet-privacy/pull/955), and [deposit-address screening](https://github.com/starkware-libs/starknet-privacy/pull/957) work. |
| Mainnet evidence | **Receipt-backed and deployed.** Facet/Ekubo succeeded in [`0x2d3c…36ab`](https://voyager.online/tx/0x2d3c449ebb9cef73f953df5c233a6d932c6f0a4dd5f1f54fc5605e3eab236ab), Facet/Endur has four successful actions including [`0x240d…163f5`](https://voyager.online/tx/0x240d2b8285a19485536f686ef9915eb1c6ae5214091ebd10b9770ecab2163f5), [`0xfdd3…340f`](https://voyager.online/tx/0xfdd37a2a202261c61bacdb76e5c119f2779ee07db4a5c2bb0720536a71340f), [`0x7f2e…12d`](https://voyager.online/tx/0x7f2ebefab8c9a5928258c3265eb996462092d4a1cf550bfe352f2e91cdc12d), and [`0x27f0…e726`](https://voyager.online/tx/0x27f09f8321fe72765204ad1187f5eb33384e363199bbcba6145d2cd9965e726); the xSTRK exit succeeded in [`0xf5ac…90b0`](https://voyager.online/tx/0xf5ac560c25e7935cb47691d2f025735395e45d04de723a818d5b5a2df090b0). All carry pool/protocol evidence and configured helper calls. The 7 STRK eligibility shield is separate evidence; the reverted direct attempt is recorded but not counted as a successful action. |

## License

MIT. See [LICENSE](LICENSE).
