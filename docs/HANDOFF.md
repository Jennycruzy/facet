# Handoff

State as of 15 August 2026. Read `FINDINGS.md` first — it is the source of truth for
every technical claim and carries file:line and block references throughout.

## Where things stand

**Registered and live.** `Jennycruzy/facet`, MIT, four commits. Registry entry applied
to `starkience/strk20-hackathon` main as `588c8d0` via PR #45. Verified present in
upstream `registry.json`. Field at 38 projects (was 35 that morning).

**Nothing is built yet.** No `packages/` directory, no Cairo, no SDK, no app. What
exists is the ground-truth research, which is unusually complete for day two and is the
thing that makes the next steps cheap.

## Access

| Thing | Where | Notes |
|---|---|---|
| Repo push | `/root/.ssh/passage_deploy` | ed25519 deploy key, bound to `Jennycruzy/facet`. SSH host alias `github-facet`. Remote is `github-facet:Jennycruzy/facet.git`. |
| Registry fork push | `/root/.ssh/hackathon_deploy` | Second key — GitHub requires deploy keys to be globally unique. Host alias `github-hackathon`. |
| Reference clones | `/root/passage-refs/` | `starknet-privacy`, `privacy-bridge`, `strk20-hackathon`, plus `llms-full.txt`. |
| Toolchain | `scarb 2.17.0` at `/root/.local/bin/scarb` | Matches the pool repo. **`snforge` is not installed** — run `snfoundryup -v 0.59.0`. |
| RPC | `https://api.cartridge.gg/x/starknet/mainnet` | Free, no key. `rpc.starknet.lava.build:443` also works. Blast is dead. |

Tokens: a fine-grained PAT and a classic PAT were used for registration and are at
`/root/.facet-pat` and `/root/.facet-pat-classic`. **Both were to be revoked by the
owner.** Assume they are dead; the deploy keys cover all pushes.

## What is verified, and what is not

**Verified in source or on chain** — see `FINDINGS.md`:

- Pool and anonymizer addresses, class hashes, deployment blocks
- Full pool activity: 112,464 events, 2,400 participants
- The two-tier `ClientAction` / `ServerAction` model
- Identity derivation and its binding to the anonymizer address
- All 39 shadow-account invocations decoded — 32 `balance_of`, 7 `transfer_from`
- The funding gap and every constituent fact of the withdraw pattern
- That one invoke action can carry many calls
- That pre-funding a shadow account is a tested upstream pattern

**Not verified — do not build on these without checking:**

1. **The withdraw→invoke sequence has never executed.** Every part checks out
   individually; the whole has not been run. Sepolia first.
2. **The calldata decode (§6.4) is reconstructed, not traced.** `traceTransaction` is
   unavailable on public RPC. Reproducing the shape on Sepolia confirms it for free.
3. **The stranded-funds case is untested upstream and unexecuted on mainnet.** No test
   in the 733-line suite covers a dapp call reverting after the account is funded.

## Next actions, in order

1. **`snfoundryup -v 0.59.0`**, then scaffold `packages/contracts` and write fork tests
   against live mainnet anonymizer state. Cheapest possible validation, no fees.
2. **Reproduce the §6.4 smoke-test shape on Sepolia.** Settles open question 2 for free.
   If it reverts, the decode is wrong and that is worth knowing immediately.
3. **Answer the stranded-funds question in a test** before any mainnet transaction.
4. **Then** the first funded interaction on Sepolia, then mainnet, then
   `strk20.json.transactions`.

## Standing rules

- Commits: `jennycruzy <jennycruzy@users.noreply.github.com>`, conventional prefixes,
  imperative mood, no emoji, **no phase references in messages**, and no AI attribution
  anywhere in any artifact.
- Push at least daily. The hub orders its board by most recent push and the panel reads
  that board.
- Never claim a property that has not been tested. The invocation analysis in §6.5 was
  wrong once already, from generalising a five-transaction sample to all thirty-nine.
  That failure is left visible in the findings on purpose.

## Positioning

The defensible claim is narrow and checkable: **no shadow account has ever interacted
with a DeFi protocol** — all 39 invocations target the STRK token contract.

Not defensible, and previously asserted in error: that nobody has funded a shadow
account. Seven `transfer_from` transactions have. The honest contrast is that their
method needs a public `approve` from a funded address, which links a real identity to
the facet, whereas sourcing from a shielded note does not.
