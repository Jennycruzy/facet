# Progress

Chronological record. Every tick carries evidence: a transaction hash, a block height, a
file path, or command output. A missing prerequisite blocks the dependent work.

Sprint window: 14–31 August 2026. Submissions close 31 August, 23:59 UTC. The final
working sprint is being treated as a compressed four-day window ending at that deadline.

## Current sprint truth — 28 August 2026

The local checkout is the source of truth on branch `strk20-sprint-20260828` at commit
`648cd70e7c6f22bf4f5d91172f3514353289d066`, with the original freeze tag `freeze-20260827`
and baseline commit `cdeba32e1051c4ae1304a3d23feb254e62244128`. The working tree is clean.
The VPS copy is behind and has a dirty
`packages/contracts/Scarb.toml`; its diff is preserved outside the repository before any
sync or deployment.

The Mainnet evidence position is:

| Evidence | State |
|---|---|
| Ready X eligibility shield | **Verified** — 7 STRK, `0x0721505c4a33bf6457ad21781d7b798203f06faa7ca054a857b738058045716a`, successful pool event |
| Facet Mainnet registration | **Not completed** — the compatible proof reached AVNU, but the initial deposit path was rejected because no screening attestation was attached |
| Facet Mainnet private deposit | **Not completed** — latest AVNU response was `SCREENING_REQUIRED`; no transaction hash returned |
| Facet Mainnet protocol action | **Verified** — Ready X Wallet API Ekubo action `0x2d3c449ebb9cef73f953df5c233a6d932c6f0a4dd5f1f54fc5605e3eab236ab`, block 14,004,049 |
| Mainnet Facet hash count | **One qualifying Facet protocol hash plus one qualifying eligibility hash** |
| Current Mainnet cap | **40 STRK ceiling**, with 0.1 STRK approved for the private deposit and 0.1 STRK for the Ekubo action, plus fees |

The rejected direct-runner proofs consumed proving time but moved no funds. The running VPS
`facet-prover-gate-a-53f6` container emits the current Mainnet-compatible PROOF1/hash pair, but
the direct AVNU path still lacks the live pool's required screening attestation. The supported
Ready X Wallet API route completed the reviewed Facet/Ekubo action separately; see the verified
hash above and `FINDINGS.md` §6.29.

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

## Registration

**Complete, 15 August 2026.**

| Item | State | Evidence |
|---|---|---|
| Push authentication working | Done | Repo-scoped ed25519 deploy key. GitHub requires deploy keys to be globally unique, so a second key was needed for the registry fork. |
| Repository public with a pushed commit | Done | `github.com/Jennycruzy/facet`, three commits at time of registration. |
| `strk20.json` at repository root | Done | Empty arrays, valid JSON, CI check pending. |
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
| Real invocation decoded | Done, unproven | `FINDINGS.md` §6.4. Reconstructed from raw calldata against source Serde layouts — `starknet_traceTransaction` is unavailable on public endpoints. **Must be confirmed by executing the same shape on Sepolia before it is treated as fact.** |
| Toolchain pinned | Done | scarb 2.17.0 (aa8740944 2026-04-09), cairo 2.17.0, sierra 1.8.0 — matching `starknet-privacy`. |
| starknet-foundry installed | Done | `snforge 0.59.0` at `/root/.local/bin/snforge`, matching the pool's pin. |
| Full shadow anonymizer source and test suite read | Partial | Interface, identity derivation, `OpenNote`, `CollectPolicy` read. The 733-line test suite is not yet read in full. |
| Existing SDK shadow support catalogued | Partial | Confirmed present: `sdk/src/internal/shadow-accounts.ts` (98 lines, `ShadowAccountsBuilderImpl`), `ShadowAccountAnonymizerABI` exported at `index.ts:4`, plus references in `interfaces.ts`, `factory.ts`, `internal/builders.ts`, `internal/anonymizer-abi.ts`, `testing/mocknet.ts`. What each one does is not yet catalogued. |
| Prior-art check | Done | Nothing in the hackathon README, `IDEAS.md`, or `projects.json` mentions shadow or stealth accounts. Field at 35 projects; three have mainnet transactions recorded (cutout 4, redpocket 3, veilpass 1). |
| Commit identity single-valued | Done | `user.name jennycruzy`, `user.email jennycruzy@users.noreply.github.com` configured and used by the local commits. |
| Secret scan clean | Current-tree scan done; full-history final scan pending | |

---

## Build

| Item | State | Evidence |
|---|---|---|
| `packages/contracts` scaffolded | Done | `facet_contracts` 0.1.0, edition `2024_07`, pinned `starknet 2.17.0` / `snforge_std 0.59.0`. Anonymizer and ERC20 bindings plus `mainnet.cairo`, which carries every verified address as a documented constant. |
| Fork harness against live mainnet | Done | `[[tool.snforge.fork]]` MAINNET pinned to block 13,329,863 — the block the findings are measured against — over `api.cartridge.gg`. Reproducible, no key, no fee. |
| Fork tests passing | Recorded pass; reproduction pending | The pinned environment recorded **20 passed, 0 failed** in `FINDINGS.md` §6.12; a fresh checkout currently cannot resolve the required Sierra compiler. Do not claim current reproducible Cairo success until fixed. |
| §6.6 funding pattern exercised against deployed bytecode | Done, proof half excluded | Predicted address funded before deployment, account deploys exactly where predicted, full balance collects to the note, pool approved for the total. The `UseNote`/`Withdraw` legs run inside the proved execution and cannot be reached from a fork test. |
| §6.4 payload replayed against real bytecode | Done | `decoded_invocation.cairo` — the eleven felts fed back through `call_contract_syscall`, no dispatcher in between, plus a control that breaks the decode by shifting slot 11. Answers open question 1 in substance. |
| Same replay against Sepolia state | Done | `decoded_payload_replays_on_sepolia`, forked at block 13,518,500. A free dry run of the live transaction. |
| Pure protocol adapter serializers | **Done, 26 August 2026** | `packages/sdk/src/adapters.ts` builds Vesu deposit, Endur stake, and the tested Ekubo single-hop route; it returns per-token settlement hints and hard-fails linked recipients. Unit coverage passes. Vesu and Endur still need funded network rehearsals. |
| Browser launcher wallet boundary | **Staged, 29 August 2026** | `packages/web/launch.html` connects an injected EIP-1193 EOA, requests one origin/network/pool-bound `personal_sign` message, and opens reviewed Wallet API routes. The route pages let Ready X own note discovery, proving, screening, and broadcast; the launcher itself never handles proof material. |
| Live Sepolia transaction | **Done, 18 August 2026** | Account `0x1bd5f6f84a45d7f547876d1d083d5bcbeb3d7544e96638851959da32813cbb5`; anonymizer deploy `0x014eb1f86482ae09c32d5784d604115b9e8ab24c3c6f9349308028e6d5a3ab29`; materialisation `0x0719c8ddafc64eebaea496f84d0ec4ccbee46d561a227422d94e5f0be874e9b7`; funding `0x067c272692c0afe9f95535504a81352b0ec664c4b09eb8ccbe0c5ae84a571193`; replay `0x01278bd9634d952da1502118c3bf6f8578b5e4148da6ab992384aeca110675cf`. Exact 0.5 STRK was collected; derived shadow balance is 0. |
| First funded mainnet interaction | **Done, 19 August 2026** | Ready X shielded 7 STRK into the mainnet STRK20 pool; transaction `0x0721505c4a33bf6457ad21781d7b798203f06faa7ca054a857b738058045716a`, block 13,538,709, accepted on L2. |
| Phase A owner authorization | **Confirmed, 19 August 2026; current run updated 28 August 2026** | Owner approved the Sepolia account above, trusted VPS prover `38.49.216.59`, an initial 0.5 STRK rehearsal target plus fees, and a current 40 STRK mainnet ceiling. The current test principal is 0.1 STRK for the private deposit and 0.1 STRK for the Ekubo action, plus fees. The ceiling is a safety limit, not an instruction to spend it all. |
| Isolated Sepolia rehearsal pool | **Deployed, 23 August 2026** | Pool `0x73f3c4bc1ef39490f09587b11f6ea7f2cc66854d5df3306cda4736234693546`, transaction `0x69562899d887cbb1cbfaaa5fcb60ec3e4a89dac48d1b7483a95f6230f73039a`; anonymizer `0x57e5052865eb08bc1134a62fadfef067015802ce7e989af29fe94913c535efd`, transaction `0x21fba6477885991912fefd1a5e862532ac0ad8b91011bca2079723b7e946e4f`. This avoids the original pool's unavailable screening signer while preserving screening behavior in the rehearsal. |
| Self-hosted private paymaster core | **Deployed, 23 August 2026** | One-relayer AVNU-compatible Sepolia deployment succeeded in transaction `0x006e6ff906cfd97d24f70e060514e0a97837bdcb5f00497d91b2a11c61870da8`. It allocated 4 testnet STRK and removes dependence on the managed service's single configured privacy-pool address. Generated service credentials remain outside Git; the end-to-end proved transactions subsequently succeeded and are recorded in §6.17–§6.18. |
| **§6.6 sequence executed on Sepolia** | **Done, 25 August 2026** | The first facet succeeded in `0x05faace1d…dedef` and `0x0111b815a…f3693`. A second clean facet named `facet-second` used deposit `0x4cee8465…0a07` and private transaction `0x68510769…6b3a`; shadow `0x560b1983…e2b8` sent 1 wei to `0x…dead`, not the owner, and collected the remainder. The second proof took 400s. Recorded as `FINDINGS.md` §6.17–§6.18. |
| **Facet contracts on mainnet** | **Done, 25 August 2026** | Immutable anonymizer `0x741fe9dc…63bc`, deployment `0x277a84c5…922`; `FacetAccount` `0x42e9d345…1a45`, deployment `0x4e9305a7…732f`. Production classes were declared first and the immutable ABI was checked for privileged entrypoints. Recorded as `FINDINGS.md` §6.19. |
| **Ekubo helper on mainnet** | **Done, 28 August 2026** | Stateless helper `0x2bd92991…8537`, class `0x2a4ac595…ebd7`, deployment `0x188808f3…08dfc`, block 14,000,701. Class hash and address were rechecked after the successful receipt. |
| **Vesu/Endur helper routes** | **Prepared, 29 August 2026** | Shared ERC-4626 helper class `0x65f9084b…c9d4`; deterministic Vesu helper `0x7568567a…e4b6` and Endur helper `0x292df148…1240` passed local build and Mainnet address checks, but the class is not declared and neither instance is deployed yet. |
| **Current launcher deployment** | **Done, 29 August 2026** | The current local static build is served at `https://usefacet.xyz`; required pages and assets returned HTTP 200. Previous web root preserved as `/var/www/facet.backup-20260829T025603Z`. |
| §3.4 wallet-signature derivation | **Answered, 26 August 2026** | Yes: derive the proof's private viewing-key scalar from one canonical chain-and-pool-bound wallet signature in memory. `privacy-bridge` documents the same signature-only key pattern; the staged browser launcher and SDK/browser golden-vector tests implement the derivation. |
| **Mainnet screening attestation** | **Blocked, 28 August 2026** | Compatible proof completed, but AVNU returned `SCREENING_REQUIRED`; live pool screener key is configured and the VPS has no `BLOCKING_CHECK_URL`/proof-interceptor deployment. |

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

**Where the private key lives for a browser product — answered, 25 August 2026.**

A facet can be derived from a wallet signature alone. `privacy-bridge/packages/bridge-core`
derives a Starknet private key and a privacy viewing key from one `personal_sign` signature;
the privacy SDK requires only `{ address, signer }` and a `viewingKeyProvider`, never a raw
private key. This was the highest-priority unknown in the project because a browser wallet
will not release a key and we must never accept one.

**It resolves with a constraint that changes the product, not a clean yes.** The derivation
depends on a standard EOA signature, and Starknet wallets are smart contract accounts whose
signatures are not in that form. A browser launcher therefore connects an EOA wallet and
derives a Starknet identity from it, rather than deriving facets from the user's existing
Argent X or Braavos wallet. Detail and the implementation requirements are in
`SHADOW_ACCOUNTS.md` §10.

Established by reading the source against the SDK's proving path; pure adapter builders are now
implemented and unit-tested, but the browser composition and adapter path have not been
exercised end to end.

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
   denominations are documented, but the current launcher and runner do not enforce them yet;
   implementation and tests remain open.
