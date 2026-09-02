# Progress

Chronological record. Every tick carries evidence: a transaction hash, a block height, a
file path, or command output. A missing prerequisite blocks the dependent work.

Original sprint window: 14–31 August 2026. The extension window is **1–7 September 2026**;
submissions freeze on **7 September, 23:59 UTC**. The dated entries below preserve the original
31 August state; extension work is recorded as new evidence rather than rewriting history.

## Current sprint truth — 31 August 2026

The local checkout is the source of truth on the canonical `main` branch. The current release
includes bounded wallet-error diagnostics, the three verified Mainnet routes, the pinned
Node runtime, and the formatted Cairo sources. It is published as the current public `main`.
The VPS copy is behind and has a dirty
`packages/contracts/Scarb.toml`; its diff is preserved outside the repository before any
sync or deployment.

The Mainnet evidence position is:

| Evidence | State |
|---|---|
| Ready X eligibility shield | **Verified** — 7 STRK, `0x0721505c4a33bf6457ad21781d7b798203f06faa7ca054a857b738058045716a`, successful pool event |
| Facet Mainnet registration | **Not completed** — the compatible proof reached AVNU, but the initial deposit path was rejected because no screening attestation was attached |
| Facet Mainnet private deposit | **Not completed** — latest AVNU response was `SCREENING_REQUIRED`; no transaction hash returned |
| Facet Mainnet protocol action | **Verified for Ekubo** — Ready X Wallet API action `0x2d3c449ebb9cef73f953df5c233a6d932c6f0a4dd5f1f54fc5605e3eab236ab`, block 14,004,049 |
| Endur Mainnet protocol action | **Verified** — Ready X Wallet API action `0x240d2b8285a19485536f686ef9915eb1c6ae5214091ebd10b9770ecab2163f5`, block 14,052,044, with pool/helper/Endur events |
| xSTRK exit Mainnet action | **Verified** — reviewed action `0xf5ac560c25e7935cb47691d2f025735395e45d04de723a818d5b5a2df090b0`, block 14,134,005, with pool/protocol events and the configured helper/router transfer path |
| Mainnet Facet hash count | **Three qualifying Facet protocol hashes plus one qualifying eligibility hash** |
| Current Mainnet cap | **40 STRK ceiling**, with 0.1 STRK approved for the private deposit and 0.1 STRK for the Ekubo action, plus fees |

The rejected direct-runner proofs consumed proving time but moved no funds. The running VPS
`facet-prover-gate-a-53f6` container emits the current Mainnet-compatible PROOF1/hash pair, but
the direct AVNU path still lacks the live pool's required screening attestation. The supported
Ready X Wallet API route completed the reviewed Facet/Ekubo action separately; see the verified
hash above and `FINDINGS.md` §6.29. The controlled Endur retry then succeeded and is recorded in
`FINDINGS.md` §6.32. The configured xSTRK exit subsequently succeeded and is recorded in
`FINDINGS.md` §6.37. The retired Vesu experiment is retained only in `FINDINGS.md` §§6.30–6.31.

The user-facing speed plan is asynchronous proving: a warm worker, opaque job id, visible
stages, resumable polling, quote/expiry re-checks, and a final review gate. This improves
the page experience and avoids duplicate proofs; it does not shorten the current 355–485s
cryptographic proof wall time. The public launcher remains staged until that job path is
actually wired and receipt-tested.

---

## Phase A authorization and account separation

Confirmed by the owner on 19 August 2026. This records authorization and public
operational context; no private key, seed phrase, password, signature, or viewing key is
stored here.

| Item | Record |
|---|---|
| Sepolia private-transaction account | `0x7a00bfa75ea68c2baa0d6ef2a10f42905d17f9868bfe2d4424072d06139b135` |
| Retired Sepolia account | `facet-sepolia`, `0x1bd5f6f84a45d7f547876d1d083d5bcbeb3d7544e96638851959da32813cbb5`; historical replay account, no longer signs |
| Sepolia purpose | `UseNote → Withdraw → ComputeAndInvoke` private-transaction rehearsal |
| Initial Sepolia target | 0.5 STRK private note, plus transaction fees |
| Current owner-approved mainnet ceiling | Up to 40 STRK for this run; this is a ceiling, not an instruction to spend it all |
| Mainnet funded account | `starknet-gate2`, `0x033ce0b8b9288aabfc75c0b3f9e5323ba50cf8076f7497d14b2b14cd8a2da64b` |
| Mainnet purpose | Later Facet/Mainnet work; distinct from the Sepolia account and the Ready X eligibility wallet |
| Trusted prover host | VPS `38.49.216.59` (`jennycruzy`), prover bound to the trusted host rather than exposed publicly |
| Mainnet DeFi approval | Owner approved up to three Mainnet transactions: registration, a 0.1 STRK private deposit, and a 0.1 STRK Ekubo action, plus gas; the 40 STRK runner cap is a ceiling. The reviewed Wallet API Ekubo action is now verified. |

The Mainnet account is not the Sepolia account. Starknet permits omitted leading zeroes,
so `0x033ce…` and `0x33ce…` refer to the same Mainnet address. The public funding
transaction is recorded in `FINDINGS.md` §6.16.

### Sepolia preflight

Read-only balance checks against the versioned Sepolia RPC on 19 August 2026 returned:

| Asset | Balance | Status |
|---|---:|---|
| STRK | `0.055896839199782920` | Below the planned 0.5 STRK note plus fees |
| ETH | `0` | No ETH fee balance |

No transaction was sent. A later read-only check observed `0.979993890349582920 STRK`
after the faucet top-up; Mainnet funds cannot be used as Sepolia funds.

**Security status:** the original account is retired from signing after a local
secret-handling incident; no secret is recorded in the repository. Private transactions now use the
new account above, which has completed two independently verified Sepolia facets.

---

## Extension update — 1 September 2026

The previously shipped extension work and the two product items completed in this pass are deployed
from the Jennycruzy checkout. The new items are recorded below with source-and-test evidence; no
new transaction was requested:

| Extension item | State | Evidence |
|---|---|---|
| Unified portfolio read model | **Done** | `packages/web/assets/js/portfolio.js` reads the connected private asset set from Ready X and optionally reconciles each app context against the Mainnet anonymizer and token contracts. |
| Persistent context discovery | **Done where wallet-supported** | `packages/web/assets/js/chain.js` decodes `get_shadow_accounts` for one explicit nonce; unsupported and unregistered wallet capabilities remain visible states. |
| Local persistence boundary | **Done** | `facet-map.js` stores only activity and public observations; discovery bypasses the `sessionStorage` RPC cache, so the partial commitment is not persisted by the launcher. |
| SDK as browser engine | **Done** | `packages/sdk/src/index.ts` is bundled at deploy time into `assets/js/facet-sdk.js`; `executor.js` re-exports that generated artifact. |
| SDK/sample-app integration example | **Done** | `packages/sdk/examples/compatible-app.ts` is a copy-paste Endur integration through the public intent → adapter → executor boundary; `npm run check` typechecks it and `tests/compatible-app.test.ts` asserts the wallet action vector. |
| Launch → use → hold → recover → retire lifecycle | **Done for local state and confirmed route exits** | SDK and browser lifecycle guards enforce the five transitions, block recovery/retirement while persistent positions remain, expose explicit recovery controls, and record the verified Endur xSTRK → STRK exit before retirement. Deployed with commit `5219c25`; generic protocol exits remain adapter-specific. |
| Regression coverage | **Done** | The deployed baseline was 40 SDK and 52 web tests; the current checkout passes the expanded SDK suite (65) and full web suite (61), including the sample, lifecycle, sealed-record and recovery-routing cases. |
| Live deployment | **Done** | `https://usefacet.xyz` serves the new launcher, bundle, and portfolio reader; all public routes returned HTTP 200 and the headless launcher smoke test completed without module errors. |

No new transaction was requested in this implementation pass. The direct Mainnet identity write still
requires the external screening attestation documented in `FINDINGS.md` §6.33; the app does not
claim a receipt it did not produce.

---

## Registration

**Complete, 15 August 2026.**

| Item | State | Evidence |
|---|---|---|
| Push authentication working | Done | Repo-scoped ed25519 deploy key. GitHub requires deploy keys to be globally unique, so a second key was needed for the registry fork. |
| Repository public with a pushed commit | Done | `github.com/Jennycruzy/facet`, three commits at time of registration. |
| `strk20.json` at repository root | Done | At registration it contained empty arrays; the current file has four verified Mainnet hashes and five deployed contract addresses. |
| Registry entry appended, nothing else touched | Done | Diff was **+10 / −0**, one file. Slug `facet` confirmed unique against every derived slug in the registry before submission. |
| Registration pull request opened | Done | [starkience/strk20-hackathon#45](https://github.com/starkience/strk20-hackathon/pull/45). |
| Entry live in upstream `main` | Done | Applied by `strk20-sprint-bot` as `588c8d0`, "chore: register jennycruzy/facet (#45)". Verified by reading `registry.json` from upstream `main` directly. Registry at 38 entries. |
| Project visible on the hub | Pending | Follows automatically within one 30-minute polling cycle. |

The PR closed rather than merged. That is the designed flow: the bot rebuilds the entry on top of whatever landed while the PR was open, which is why `CONTRIBUTING.md` forbids hand-resolving the conflict.

**Field growth:** 35 registered projects at the start of 15 August, 38 by midday. Three arrived within hours.

**Name availability, checked 15 August 2026:**

- `@facet/sdk` on npm — available (`@facet/sdk` returns `{"error":"Not found"}`).
- `Jennycruzy/facet` on GitHub — available (API returns `Not Found`).
- Unscoped `facet` on npm and the GitHub org `facet` are both taken; neither is needed.

---

## Ground truth

| Item | State | Evidence |
|---|---|---|
| Pool address verified independently | Done | Class hash `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d` at `0x0403…812a`; deployment block 8,978,970 (20 April 2026) located by binary search on `starknet_getClassHashAt`. |
| Shadow anonymizer verified on mainnet | Done | `0x4f33230d…888a7`, class hash `0x7ffaf4f4…f5e6`, deployment block 12,199,879 (23 July 2026). Identified by `get_shadow_account` responding where six other compute-path targets return "entrypoint does not exist". |
| Pool activity measured | Done | 112,464 events, blocks 8,978,970 → 13,329,863. Breakdown in `FINDINGS.md` §2. |
| Two-tier action model established | Done | `FINDINGS.md` §4. `apply_actions` takes `Span<ServerAction>`; `ClientAction`s execute inside the proved virtual OS execution. |
| Real invocation decoded | **Done, confirmed by replay** | `FINDINGS.md` §6.4. Reconstructed from raw calldata against source Serde layouts, then executed through `call_contract_syscall` against real anonymizer bytecode; `starknet_traceTransaction` remains unavailable on public endpoints. |
| Toolchain pinned | Done | scarb 2.17.0 (aa8740944 2026-04-09), cairo 2.17.0, sierra 1.8.0 — matching `starknet-privacy`. |
| Starknet Foundry pinned | Done | `snforge 0.59.0` is the repository toolchain pin; the local run also requires Universal Sierra Compiler 2.10.0. |
| Full shadow anonymizer source and test suite read | Partial | Interface, identity derivation, `OpenNote`, `CollectPolicy` read. The 733-line test suite is not yet read in full. |
| Existing SDK shadow support catalogued | Partial | Confirmed present: `sdk/src/internal/shadow-accounts.ts` (98 lines, `ShadowAccountsBuilderImpl`), `ShadowAccountAnonymizerABI` exported at `index.ts:4`, plus references in `interfaces.ts`, `factory.ts`, `internal/builders.ts`, `internal/anonymizer-abi.ts`, `testing/mocknet.ts`. What each one does is not yet catalogued. |
| Prior-art check | Done | Nothing in the hackathon README, `IDEAS.md`, or `projects.json` mentions shadow or stealth accounts. Field at 35 projects; three have mainnet transactions recorded (cutout 4, redpocket 3, veilpass 1). |
| Commit identity single-valued | Done after normalization | `Jennycruzy <jennycruzy@users.noreply.github.com>` is the canonical author and committer identity across the published history. |
| Secret scan clean | **Done after current-tree and full reachable-history scans, 29 August 2026** | No PEM/private-key material, token-shaped credential, or sensitive deployment file found; the pre-identity-rewrite recovery bundle was scanned separately. |

---

## Build

| Item | State | Evidence |
|---|---|---|
| `packages/contracts` scaffolded | Done | `facet_contracts` 0.1.0, edition `2024_07`, pinned `starknet 2.17.0` / `snforge_std 0.59.0`. Anonymizer and ERC20 bindings plus `mainnet.cairo`, which carries every verified address as a documented constant. |
| Fork harness against live mainnet | Done | `[[tool.snforge.fork]]` MAINNET pinned to block 13,329,863 — the block the findings are measured against — over `api.cartridge.gg`. Reproducible, no key, no fee. |
| Fork tests passing | **Done with pinned toolchain** | Scarb 2.17.0, Starknet Foundry 0.59.0, Universal Sierra Compiler 2.10.0; **20 passed, 0 failed** against the configured Mainnet and Sepolia forks. |
| §6.6 funding pattern exercised against deployed bytecode | Done, proof half excluded | Predicted address funded before deployment, account deploys exactly where predicted, full balance collects to the note, pool approved for the total. The `UseNote`/`Withdraw` legs run inside the proved execution and cannot be reached from a fork test. |
| §6.4 payload replayed against real bytecode | Done | `decoded_invocation.cairo` — the eleven felts fed back through `call_contract_syscall`, no dispatcher in between, plus a control that breaks the decode by shifting slot 11. Answers open question 1 in substance. |
| Same replay against Sepolia state | Done | `decoded_payload_replays_on_sepolia`, forked at block 13,518,500. A free dry run of the live transaction. |
| Pure protocol adapter serializers | **Done, 26 August 2026** | `packages/sdk/src/adapters.ts` builds Endur stake and the tested Ekubo single-hop route; it returns per-token settlement hints and hard-fails linked recipients. Unit coverage passes. Both current routes have Mainnet evidence. |
| Browser launcher wallet boundary | **Ready X route selector, 30 August 2026** | `packages/web/launch.html` connects Ready X on Mainnet, stores local app/version/status metadata, and opens reviewed Wallet API routes. It does not create or control an actual persistent facet. Ready X owns note discovery, screening, proving, and broadcast; the launcher never handles proof material. |
| Live Sepolia transaction | **Done, 18 August 2026** | Account `0x1bd5f6f84a45d7f547876d1d083d5bcbeb3d7544e96638851959da32813cbb5`; anonymizer deploy `0x014eb1f86482ae09c32d5784d604115b9e8ab24c3c6f9349308028e6d5a3ab29`; materialisation `0x0719c8ddafc64eebaea496f84d0ec4ccbee46d561a227422d94e5f0be874e9b7`; funding `0x067c272692c0afe9f95535504a81352b0ec664c4b09eb8ccbe0c5ae84a571193`; replay `0x01278bd9634d952da1502118c3bf6f8578b5e4148da6ab992384aeca110675cf`. Exact 0.5 STRK was collected; derived shadow balance is 0. |
| First funded mainnet interaction | **Done, 19 August 2026** | Ready X shielded 7 STRK into the mainnet STRK20 pool; transaction `0x0721505c4a33bf6457ad21781d7b798203f06faa7ca054a857b738058045716a`, block 13,538,709, accepted on L1. |
| Phase A owner authorization | **Confirmed, 19 August 2026; current run updated 28 August 2026** | Owner approved the Sepolia account above, trusted VPS prover `38.49.216.59`, an initial 0.5 STRK rehearsal target plus fees, and a current 40 STRK mainnet ceiling. The current test principal is 0.1 STRK for the private deposit and 0.1 STRK for the Ekubo action, plus fees. The ceiling is a safety limit, not an instruction to spend it all. |
| Isolated Sepolia rehearsal pool | **Deployed, 23 August 2026** | Pool `0x73f3c4bc1ef39490f09587b11f6ea7f2cc66854d5df3306cda4736234693546`, transaction `0x69562899d887cbb1cbfaaa5fcb60ec3e4a89dac48d1b7483a95f6230f73039a`; anonymizer `0x57e5052865eb08bc1134a62fadfef067015802ce7e989af29fe94913c535efd`, transaction `0x21fba6477885991912fefd1a5e862532ac0ad8b91011bca2079723b7e946e4f`. This avoids the original pool's unavailable screening signer while preserving screening behavior in the rehearsal. |
| Self-hosted private paymaster core | **Deployed, 23 August 2026** | One-relayer AVNU-compatible Sepolia deployment succeeded in transaction `0x006e6ff906cfd97d24f70e060514e0a97837bdcb5f00497d91b2a11c61870da8`. It allocated 4 testnet STRK and removes dependence on the managed service's single configured privacy-pool address. Generated service credentials remain outside Git; the end-to-end proved transactions subsequently succeeded and are recorded in §6.17–§6.18. |
| **§6.6 sequence executed on Sepolia** | **Done, 25 August 2026** | The first facet succeeded in `0x05faace1d…dedef` and `0x0111b815a…f3693`. A second clean facet named `facet-second` used deposit `0x4cee8465…0a07` and private transaction `0x68510769…6b3a`; shadow `0x560b1983…e2b8` sent 1 wei to `0x…dead`, not the owner, and collected the remainder. The second proof took 400s. Recorded as `FINDINGS.md` §6.17–§6.18. |
| **Facet contracts on mainnet** | **Done, 25 August 2026** | Immutable anonymizer `0x741fe9dc…63bc`, deployment `0x277a84c5…922`; `FacetAccount` `0x42e9d345…1a45`, deployment `0x4e9305a7…732f`. Production classes were declared first and the immutable ABI was checked for privileged entrypoints. Recorded as `FINDINGS.md` §6.19. |
| **Ekubo helper on mainnet** | **Done, 28 August 2026** | Stateless helper `0x2bd92991…8537`, class `0x2a4ac595…ebd7`, deployment `0x188808f3…08dfc`, block 14,000,701. Class hash and address were rechecked after the successful receipt. |
| **Endur helper route** | **Verified, 29 August 2026** | Shared ERC-4626 helper class `0x65f9084b…c9d4` declared in `0x6ec84277…a500`; Endur helper `0x292df148…1240` deployed in `0x7bc811b8…e289`. Endur action `0x240d2b8285…63f5` succeeded in block 14,052,044. |
| **Current launcher deployment** | **Verified live, 31 August 2026** | `https://usefacet.xyz` serves the verified route cards, including the xSTRK exit; HTTPS checks returned 200 for the launcher, Ekubo, Endur, proof, data, and diagnostic pages. Previous web root preserved as `/var/www/facet.backup-20260831T060227Z-4121433`. |
| §3.4 wallet-signature derivation | **Answered, 26 August 2026** | Yes: derive the proof's private viewing-key scalar from one canonical chain-and-pool-bound wallet signature in memory. `privacy-bridge` documents the same signature-only key pattern; the staged browser launcher and SDK/browser golden-vector tests implement the derivation. |
| **Mainnet screening attestation** | **Blocked, 28 August 2026** | Compatible proof completed, but AVNU returned `SCREENING_REQUIRED`; live pool screener key is configured and the VPS has no `BLOCKING_CHECK_URL`/proof-interceptor deployment. |
| **Wallet-mediated Endur attempt** | **Verified, 29 August 2026** | Ready X action `0x240d2b8285a19485536f686ef9915eb1c6ae5214091ebd10b9770ecab2163f5` succeeded in block 14,052,044 with the STRK20 pool, deployed Endur helper, and Endur events. |
| **Wallet-mediated xSTRK exit** | **Verified, 31 August 2026** | Reviewed action `0xf5ac560c25e7935cb47691d2f025735395e45d04de723a818d5b5a2df090b0` succeeded in block 14,134,005 with pool/protocol events and the configured helper/router transfer path. |

---

## Resolved

**The stranded-funds question — answered by fork test, 15 August 2026.**
Recorded as `FINDINGS.md` §6.12(b). This was the highest-risk unknown in the project and
the one path where a real user loses money. Neither half is the feared case:

- A dapp call that reverts takes the whole invoke down with it. The pool applies actions
  through `call_contract_syscall(...).unwrap_syscall()` (`privacy.cairo:982-985`), so the
  panic propagates out of `apply_actions` and the `Withdraw` in the same transaction
  reverts too. On the single-transaction path of §6.6 there is nothing to strand.
- Funding and invoking in *separate* transactions can leave a balance sitting, but it is
  recoverable: a commitment resolves to the same address permanently, so an already
  deployed and emptied account still sweeps a later top-up in full.

Both were verified against the deployed mainnet contract, not a local redeployment.

**The §6.4 decode — confirmed by replay, 15 August 2026.** Recorded as `FINDINGS.md` §6.4.
The eleven felts were fed back to real anonymizer bytecode through `call_contract_syscall`
rather than a typed dispatcher, which is the only form of the test that says anything
about the layout. It executes, and the returned deposit carries the note id, token and
amount from slots 9, 10 and 12 — each slot confirmed by the effect it describes. A control
test shifts slot 11's `CollectPolicy` discriminant and the decode breaks, as it must.

This was expected to require Sepolia and a funded key. It did not: deploying a fresh
anonymizer that names the caller as its privacy contract satisfies the caller check
without a proving service, so the whole question was settled at zero cost.

**The funding gap and the pattern that closes it — verified in source, 15 August 2026.**
Recorded as `FINDINGS.md` §6.6. All three legs confirmed:

- `privacy_invoke_with_computation` (`shadow_account_anonymizer.cairo:308-324`) moves no
  tokens into the shadow account. It asserts the caller, resolves or deploys, snapshots,
  executes, collects — nothing more.
- `WithdrawInput.to_addr` (`actions.cairo:184-203`) is validated only as non-zero. A
  withdrawal may target any address.
- The shadow account address is derivable before deployment.
  `get_shadow_accounts` predicts it with
  `calculate_contract_address_from_deploy_syscall(salt: commitment, class_hash, [], deployer)`
  and `get_or_deploy_shadow_account` (`:384-402`) deploys with identical parameters, so
  prediction and deployment agree by construction.
- `WITHDRAW_PHASE` (6) precedes `INVOKE_PHASE` (7).

The `UseNote → Withdraw → ComputeAndInvoke` sequence is therefore sound as designed —
**and as of 25 August 2026 it has been executed on Sepolia**, twice, successfully. See
`FINDINGS.md` §6.17 for the transactions and the event-level decode. The design argument above
is now a chain fact.

**The trap that outlived the design work:** the proved transaction hash and the on-chain
transaction hash are different. The prover proves the user's invoke; the paymaster relayer
broadcasts an `apply_actions` call. Looking up the proved hash returns "Transaction hash not
found" on a run that fully succeeded, which reads exactly like failure.

**Where the private key lives for a direct-Facet browser product — researched, not used by the current launcher.**

A facet can in principle be derived from a wallet signature alone. `privacy-bridge/packages/bridge-core`
derives a Starknet private key and a privacy viewing key from one `personal_sign` signature;
the privacy SDK requires only `{ address, signer }` and a `viewingKeyProvider`, never a raw
private key. This was the highest-priority unknown in the project because a browser wallet
will not release a key and we must never accept one.

**It resolves with a constraint that changes the product, not a clean yes.** The derivation
depends on a standard EOA signature, and Starknet wallets are smart contract accounts whose
signatures are not in that form. The current launcher does not implement this proposed bridge: it
connects Ready X and delegates identity, shielding, screening, proving, and submission. Detail for
a future direct path remains in `SHADOW_ACCOUNTS.md` §10.

Established by reading the source against the SDK's proving path; pure adapter builders are now
implemented and unit-tested, but the browser composition and adapter path have not been
exercised end to end.

**Persistence, encryption, and recovery routing landed on 2 September 2026** — see
`FINDINGS.md` §6.39. A facet now survives the visit (`createStorageFacetStore`), its recovery
metadata is sealed with AES-GCM under a wallet-derived key rather than merely being called
encrypted, and `planFacetRecovery` resolves each persistent position against the deployed exit
catalogue, returning `RECOVERY_REQUIRES_ADAPTER` for anything no route closes. The browser no
longer keeps its own copy of the lifecycle: `facet-map.js` imports the state table and the
recovery classification from the deployed SDK bundle and keeps only storage and UI wording.

The one deliberate stop: the launcher's device-local cache is still written in the clear. Sealing
it needs a key the wallet holds, which means a signature prompt on a page that today never asks
for one — a product decision rather than a missing capability. Encrypting under a key stored
beside the data would be theatre and is not shipped as though it were protection.

---

## Open questions

Carried forward until answered from a primary source or by the user.

1. **Wire the validated local transaction prover into the SDK — ANSWERED, 25 August 2026.**
   Done and exercised: the SDK's proving path reached the self-hosted prover over an SSH
   tunnel and produced the two successful transactions in `FINDINGS.md` §6.17, at 362.1s and
   348.0s. A hosted prover URL was never needed. The submission path, not the proving path,
   held the earlier obstacles — a paymaster forwarder missing the private entrypoint and an
   underfunded relayer, both recorded in §6.17.

   Mainnet proof-facts compatibility is now answered: the `facet-prover-gate-a-53f6` worker emits
   the live PROOF1/hash pair and completed the latest proof. The remaining infrastructure question
   is the production screening attestation source, recorded in `FINDINGS.md` §6.27.

   `apply_actions` requires a proof, but no supported hosted Mainnet URL is published in the
   checked SDK/docs/configuration. Self-hosting remains valid: the official `linux/amd64`
   image needed a lower `TARGET_CPU`, and the rebuilt service returned a populated proof in
   355–485 seconds with a peak near 6.6 GiB. The production product response is a warm,
   authenticated asynchronous queue, not a claim that the 2-vCPU host is fast. See
   [`ASYNC_PROVING.md`](ASYNC_PROVING.md).
2. **Who holds `governance_admin` on a self-deployed anonymizer?** The contract embeds
   `ReplaceabilityComponent` and `CommonRolesComponent` with `upgrade_delay: 0`
   (`FINDINGS.md` §6.8), so the holder can replace the implementation with no timelock.
   This is true of the official deployment too, and every user of the primitive inherits
   it. Requires a deliberate decision and a threat-model entry.
3. **How should facet funding amounts be chosen?** The funding leg is public
   (`FINDINGS.md` §6.7): the shadow account address, token, and exact amount are all in
   the clear. Distinctive or repeated amounts relink facets to each other. The intended fixed
   denominations are documented and `assertFundingDenomination` is unit-tested, but the current
   product has no Facet-operated Mainnet shielding boundary at which to enforce it. End-to-end
   enforcement remains open; user-selected app spend amounts are a separate concern.
