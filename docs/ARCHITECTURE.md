# Architecture

Status: Phase A preflight, 19 August 2026.

This document records the execution boundary and account controls for Facet. It does not
claim that the proved shadow-account sequence has passed; Gate A remains open until a
real Sepolia transaction settles and is independently verified.

## Account separation

| Account | Network | Role |
|---|---|---|
| `facet-sepolia` — `0x1bd5f6f84a45d7f547876d1d083d5bcbeb3d7544e96638851959da32813cbb5` | Sepolia | Gate A signer and fee payer |
| `starknet-gate2` — `0x033ce0b8b9288aabfc75c0b3f9e5323ba50cf8076f7497d14b2b14cd8a2da64b` | Mainnet | Funded deployment account for later Facet work |
| Ready X — `0x0470c4cca0dd62caecaeb3f9bf047aa3e65fc2f6aa64c6c06ca85929306714fa` | Mainnet | Separate eligibility shield wallet |

The Sepolia account, the Mainnet deployment account, and the Ready X wallet are three
different account identities. A leading zero may be omitted from a Starknet address
without changing its value.

## Execution authorization

- Initial Gate A target: 0.5 STRK in the private note, plus fees.
- Owner-approved maximum exposure for the end-to-end work: 30 STRK total.
- The maximum is a safety ceiling, not a reason to spend the full amount.
- No Mainnet DeFi transaction is authorized until Gate A passes and its amount is
  confirmed separately.

## Preflight status

The confirmed Sepolia account was checked read-only against
`https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10`. It held
`0.055896839199782920 STRK` and `0 ETH`, which is below the planned 0.5 STRK private
note plus fees. No transaction was sent. The account must receive Sepolia STRK before
the Gate A deployment and proof rehearsal; Mainnet funds are not interchangeable with
Sepolia funds.

## Prover trust boundary

The trusted prover is VPS `38.49.216.59`, running the self-hosted transaction prover on
the private host interface. It must not be published as an unauthenticated public
endpoint.

The upstream privacy SDK derives the viewing key inside the prover/client orchestration,
but the proof invocation includes that key in the `compile_actions` input sent to the
prover. Consequently:

- wallet keys, signatures, passphrases, and viewing keys stay out of chat, source,
  logs, and commits;
- the prover host is part of the trusted computing boundary;
- any public application must use a reviewed authenticated/local proving design before
  it is allowed to forward proof inputs to this host.

The `privacy-bridge` pattern is the reference for secret hygiene: obtain the wallet
signature in memory, derive re-creatable client material in memory, and persist only
non-secret state or a deliberately read-only capability. It is not reused as a Facet
identity formula without matching it to the Starknet wallet and the privacy SDK source.

## Gate A sequence

The first real rehearsal is:

```text
UseNote
  → Withdraw to the predicted shadow-account address
  → ComputeAndInvoke with a trivial Sepolia call
  → collect the resulting balance into an open note
```

The anonymizer instance must be deployed on Sepolia before the sequence because the
network has the pool and classes but no discovered anonymizer instance. The predicted
address must be recorded before proving, and the proof timing, transaction hash,
settlement note, and any revert must be added to `PROGRESS.md` and `FINDINGS.md`.

## Funding provenance

The Mainnet deployment account's public funding transaction is
[`0x047052e30cbb17f8f7f284d673a431788a8a9e41c56c39eb109501b27304e751`](https://voyager.online/tx/0x047052e30cbb17f8f7f284d673a431788a8a9e41c56c39eb109501b27304e751).
The chain calldata sends 70.28 STRK to `starknet-gate2`; the earlier 76 STRK figure is
not used as an on-chain fact unless another funding transaction is found.
