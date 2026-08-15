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
| starknet-foundry installed | Not done | `snfoundryup` is on PATH; `snfoundryup -v 0.59.0` not yet run. |
| Full shadow anonymizer source and test suite read | Partial | Interface, identity derivation, `OpenNote`, `CollectPolicy` read. The 733-line test suite is not yet read in full. |
| Existing SDK shadow support catalogued | Partial | Confirmed present: `sdk/src/internal/shadow-accounts.ts` (98 lines, `ShadowAccountsBuilderImpl`), `ShadowAccountAnonymizerABI` exported at `index.ts:4`, plus references in `interfaces.ts`, `factory.ts`, `internal/builders.ts`, `internal/anonymizer-abi.ts`, `testing/mocknet.ts`. What each one does is not yet catalogued. |
| Prior-art check | Done | Nothing in the hackathon README, `IDEAS.md`, or `projects.json` mentions shadow or stealth accounts. Field at 35 projects; three have mainnet transactions recorded (cutout 4, redpocket 3, veilpass 1). |
| Commit identity single-valued | Pending first commit | `user.name jennycruzy`, `user.email jennycruzy@users.noreply.github.com` configured. |
| Secret scan clean | Pending first commit | |

---

## Resolved

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

1. **Does the decode in `FINDINGS.md` §6.4 actually execute?** It is a careful reading,
   not a proven fact. Reproducing the smoke-test shape on Sepolia settles it for free.
2. **Where do funds go if a dapp call reverts mid-interaction?** Withdrawal lands tokens
   in the shadow account before the call runs. If the call reverts, are they stranded?
   This is the most likely way a real user loses money and it must be answered before
   the product touches anyone else's funds.
3. **Who holds `governance_admin` on a self-deployed anonymizer?** The contract embeds
   `ReplaceabilityComponent` and `CommonRolesComponent` with `upgrade_delay: 0`
   (`FINDINGS.md` §6.8), so the holder can replace the implementation with no timelock.
   This is true of the official deployment too, and every user of the primitive inherits
   it. Requires a deliberate decision and a threat-model entry.
4. **How should facet funding amounts be chosen?** The funding leg is public
   (`FINDINGS.md` §6.7): the shadow account address, token, and exact amount are all in
   the clear. Distinctive or repeated amounts relink facets to each other. Defaults need
   deliberate design, not an arbitrary choice left to the user.
