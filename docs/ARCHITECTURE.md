# Architecture

Facet is a private account and portfolio layer: the user keeps one shielded balance while
each application sees a separate deterministic shadow account. This document records the
execution boundary, account controls, and settlement path that make that product model
possible.

Status: the private account sequence and the Ekubo adapter are verified on Sepolia; the
immutable anonymizer and `FacetAccount` are deployed on mainnet. The browser launcher is
staged locally with wallet binding and in-memory viewing-key derivation, but note discovery,
browser proving, and submission are not complete. The 7 STRK Ready X eligibility shield is a
successful Mainnet pool transaction; no Facet shadow-account DeFi receipt has passed Mainnet
proof-aware preflight yet.

For the product model and user-facing privacy boundary, see [`PRODUCT.md`](PRODUCT.md).

## Account separation

| Account | Network | Role |
|---|---|---|
| Active Sepolia signer — `0x7a00bfa75ea68c2baa0d6ef2a10f42905d17f9868bfe2d4424072d06139b135` | Sepolia | Private-transaction signer and fee payer |
| `facet-sepolia` — `0x1bd5f6f84a45d7f547876d1d083d5bcbeb3d7544e96638851959da32813cbb5` | Sepolia | Retired historical replay account; must not sign |
| `starknet-gate2` — `0x033ce0b8b9288aabfc75c0b3f9e5323ba50cf8076f7497d14b2b14cd8a2da64b` | Mainnet | Funded Facet deployment account; encrypted keystore stays local |
| Ready X — `0x0470c4cca0dd62caecaeb3f9bf047aa3e65fc2f6aa64c6c06ca85929306714fa` | Mainnet | Separate eligibility shield wallet |

The Sepolia account, the Mainnet deployment account, and the Ready X wallet are three
different account identities. A leading zero may be omitted from a Starknet address
without changing its value.

## Execution authorization

- Initial private-note target: 0.5 STRK, plus fees.
- Current owner-approved maximum exposure for the mainnet run: 20 STRK total.
- The maximum is a safety ceiling, not a reason to spend the full amount.
- The current approved test principal is 0.1 STRK for the private deposit and 0.1 STRK for
  the Ekubo action, plus fees. The 20 STRK ceiling is not an instruction to spend it all.

## Preflight status

The active Sepolia account is `0x7a00…b135`. It completed the first facet and a second
clean facet on Sepolia. The second facet used dapp name `facet-second` and sent its one-wei
smoke call to `0x…dead`, not to the owner. The deposit transaction is
`0x4cee84654535d0f98f7a8e0402fce4c47aab1ff62b6b132d725184e5eb30a07`; the private
transaction is `0x68510769914a25f6dc9d90fa7f5672bd83908c4ddafc77b1fd6ff3782286b3a`.
Mainnet funds are not interchangeable with Sepolia funds.

The account is retired from signing after a local secret-handling incident during
preflight inspection. No secret is stored in this repository. Private transactions must use a fresh
Sepolia account; only its public address may enter project records.

## Mainnet contract deployment

The production `starknet-contract` target was compiled without test tracing, declared on
mainnet, and deployed from the encrypted `starknet-gate2` account. The immutable
anonymizer has no upgrade, proxy, governance, role, or admin entrypoint in its compiled
ABI.

| Contract | Address | Class hash | Deployment transaction |
|---|---|---|---|
| Immutable anonymizer | `0x741fe9dcdf3729919e8c44422fbb963e76a0788f3abad20bb25a50445f363bc` | `0x85fbf40e535f188b695c1c3b4492c3045de7305c94e2ce7de4d0f9551adb21` | `0x277a84c5b063c235acdd5b5e866e2c6078554517e984536b3bb889b26f07922` |
| FacetAccount | `0x42e9d345c46705408394b7a67e291c2bde9f2638297125a7fec2b5740371a45` | `0x5d07634600fff340d733946c2c8f925ee4c3c637c33f61e33e187b9024de46d` | `0x4e9305a7b362901c0ccd1017bba3269993e724383c1fa9608ba94a63011732f` |

The class declaration transactions were `0x708f7621502bf317d0e184c0edc47efc9300651129fc9667c24b3075d4bbeef`
and `0x384426545f8f59e9603674f309acd1fa749911d6f8573dbd9752f40b4294669`.

## Prover trust boundary

The trusted prover is VPS `38.49.216.59`, running the self-hosted transaction prover on
the private host interface. It must not be published as an unauthenticated public
endpoint.

The staged browser launcher derives a candidate viewing key from the wallet signature in
memory. The eventual privacy-client proof invocation includes that key in the `compile_actions`
input sent to the prover. Consequently:

- wallet keys, signatures, passphrases, and viewing keys stay out of chat, source,
  logs, and commits;
- the prover host is part of the trusted computing boundary;
- any public application must use a reviewed authenticated/local proving design before
  it is allowed to forward proof inputs to this host.

The `privacy-bridge` pattern is the reference for secret hygiene: obtain the wallet
signature in memory, derive re-creatable client material in memory, and persist only
non-secret state or a deliberately read-only capability. It is not reused as a Facet
identity formula without matching it to the Starknet wallet and the privacy SDK source.

## Asynchronous execution boundary

The current CLI is deliberately synchronous because it is an operator tool. The product
path must not hold a browser request open for a five-to-seven-minute proof. It should submit
an allowlisted intent to an authenticated service, return an opaque job id, and let a warm
worker move through `queued → preflight → proving → proof_ready → broadcasting → confirmed`.
The browser may leave and later resume polling with only the job id and a public summary.

The service must not accept arbitrary calldata or persist the wallet-to-facet map. It must
keep viewing-key material out of durable job records and logs, enforce quote/nonce/recipient
expiry, and require proof-aware preflight before broadcast. This changes the user-visible
wait and prevents duplicate proofs; it does not reduce the raw proof wall time. The complete
contract is [`ASYNC_PROVING.md`](ASYNC_PROVING.md).

## Private transaction sequence

The first real rehearsal is:

```text
UseNote
  → Withdraw to the predicted shadow-account address
  → ComputeAndInvoke with a trivial Sepolia call
  → collect the resulting balance into an open note
```

The isolated anonymizer is deployed on Sepolia and the sequence has been independently
verified twice. For the clean second facet, the predicted shadow account is
`0x560b198338b9e7cef36d8c775725e10a8e4fb6a5acfb54fe868a7d07f89e2b8`; the proof took
400 seconds wall-clock. Its dapp call sent 1 wei to `0x…dead`, and the remainder was
collected back into the shield.

## Funding provenance

The Mainnet deployment account's public funding transaction is
[`0x047052e30cbb17f8f7f284d673a431788a8a9e41c56c39eb109501b27304e751`](https://voyager.online/tx/0x047052e30cbb17f8f7f284d673a431788a8a9e41c56c39eb109501b27304e751).
The chain calldata sends 70.28 STRK to `starknet-gate2`; the earlier 76 STRK figure is
not used as an on-chain fact unless another funding transaction is found.
