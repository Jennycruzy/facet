# Progress

Gate-by-gate record. Every tick carries evidence: a transaction hash, a block height, a
file path, or command output. A gate with an untickable box blocks everything after it.

Sprint window: 14–31 August 2026. Submissions close 31 August, 23:59 UTC.

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
| Commit identity single-valued | Pending first commit | `user.name jennycruzy`, `user.email jennycruzy@users.noreply.github.com` configured. |
| Secret scan clean | Pending first commit | |

---

## Build

| Item | State | Evidence |
|---|---|---|
| `packages/contracts` scaffolded | Done | `facet_contracts` 0.1.0, edition `2024_07`, pinned `starknet 2.17.0` / `snforge_std 0.59.0`. Anonymizer and ERC20 bindings plus `mainnet.cairo`, which carries every verified address as a documented constant. |
| Fork harness against live mainnet | Done | `[[tool.snforge.fork]]` MAINNET pinned to block 13,329,863 — the block the findings are measured against — over `api.cartridge.gg`. Reproducible, no key, no fee. |
| Fork tests passing | Done | `snforge test` — **10 passed, 0 failed**. Recorded as `FINDINGS.md` §6.12. |
| §6.6 funding pattern exercised against deployed bytecode | Done, proof half excluded | Predicted address funded before deployment, account deploys exactly where predicted, full balance collects to the note, pool approved for the total. The `UseNote`/`Withdraw` legs run inside the proved execution and cannot be reached from a fork test. |
| §6.4 payload replayed against real bytecode | Done | `decoded_invocation.cairo` — the eleven felts fed back through `call_contract_syscall`, no dispatcher in between, plus a control that breaks the decode by shifting slot 11. Answers open question 1 in substance. |
| Same replay against Sepolia state | Done | `decoded_payload_replays_on_sepolia`, forked at block 13,518,500. A free dry run of the live transaction. |
| Live Sepolia transaction | **Done, 18 August 2026** | Account `0x1bd5f6f84a45d7f547876d1d083d5bcbeb3d7544e96638851959da32813cbb5`; anonymizer deploy `0x014eb1f86482ae09c32d5784d604115b9e8ab24c3c6f9349308028e6d5a3ab29`; materialisation `0x0719c8ddafc64eebaea496f84d0ec4ccbee46d561a227422d94e5f0be874e9b7`; funding `0x067c272692c0afe9f95535504a81352b0ec664c4b09eb8ccbe0c5ae84a571193`; replay `0x01278bd9634d952da1502118c3bf6f8578b5e4148da6ab992384aeca110675cf`. Exact 0.5 STRK was collected; derived shadow balance is 0. |
| First funded mainnet interaction | Not done | `strk20.json.transactions` still empty. |

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

The `UseNote → Withdraw → ComputeAndInvoke` sequence is therefore sound as designed.
**It remains unexecuted.** Running it on Sepolia is the first build task.

---

## Open questions

Carried forward until answered from a primary source or by the user.

1. **Wire the validated local transaction prover into the SDK.** `apply_actions` requires a proof, but
   no hosted prover URL is published in the SDK, docs dump, demo configuration, or starter
   kit (`FINDINGS.md` §6.13). That is not a missing credential and does not require waiting
   for the organisers: the official [transaction-prover README](https://github.com/starkware-libs/sequencer/blob/avi/privacy/configmap-docs/crates/starknet_transaction_prover/README.md)
   documents a public container image and a local JSON-RPC service on `http://localhost:3000`.
   **Self-hosting is confirmed through full proof generation** (`FINDINGS.md` §6.13): the published `linux/amd64`
   image is compiled for a CPU newer than this host and aborts with SIGILL, but rebuilding the
   identical upstream revision for the host CPU fixes it, and the running service answers
   `starknet_specVersion` with `0.10.3-rc.2`. A freshly signed, never-broadcast Invoke V3 then
   returned a populated proof and eight proof-fact felts in **485 seconds (8m 05s)**, peaking
   at **~6.58 GiB** in the prover cgroup. This proves the tested path works on Zen 2 without
   AVX-512; it is not a claim about every host CPU. Replay of historical Argent transactions
   still fails account validation for reasons not pinned down, but no longer blocks progress.
   Point the SDK's `ProvingServiceProofProvider` at the local service next. A hosted URL is
   optional and should not be treated as the build blocker.

   The measured 2-vCPU / 7.8-GiB host is suitable for development only with swap: idle usage
   is ~2.29 GiB, a proof peaked at ~6.58 GiB, and host swap rose to roughly 12 GiB while other
   services remained running. The production recommendation remains 48 vCPU / 96 GB.
2. **Who holds `governance_admin` on a self-deployed anonymizer?** The contract embeds
   `ReplaceabilityComponent` and `CommonRolesComponent` with `upgrade_delay: 0`
   (`FINDINGS.md` §6.8), so the holder can replace the implementation with no timelock.
   This is true of the official deployment too, and every user of the primitive inherits
   it. Requires a deliberate decision and a threat-model entry.
3. **How should facet funding amounts be chosen?** The funding leg is public
   (`FINDINGS.md` §6.7): the shadow account address, token, and exact amount are all in
   the clear. Distinctive or repeated amounts relink facets to each other. Defaults need
   deliberate design, not an arbitrary choice left to the user.
