# Private STRK20 DeFi transactions

This document describes the application-adapter path in Facet's private account and
portfolio layer. A user supplies a shielded STRK note and receives private output notes;
the protocol sees a context-specific shadow account, not the user's primary wallet.

## What the stack does

Facet combines five Starknet components:

1. **STRK20 privacy pool.** A shielded STRK note is selected and spent inside a proved
   `UseNote → Withdraw → ComputeAndInvoke` action sequence. The withdrawal funds the
   predicted shadow-account address, and the remaining balance is collected back into a
   private note.
2. **Immutable shadow-account anonymizer.** The anonymizer derives a fresh account from the
   user's private identity, anonymizer address, dapp name, and nonce. The shadow account is
   the public caller seen by the dapp; the owner address is not the dapp caller.
3. **Protocol adapters and helpers.** Ekubo uses a router-specific helper. Vesu V1.1 and Endur
   use the shared `FacetErc4626Anonymizer`, each bound to the STRK20 pool, STRK, and one vault.
   The helper approves the selected vault, calls its ordinary ERC-4626 `deposit`, and approves
   only the resulting output balance back to the privacy pool.
4. **Transaction prover.** The SDK sends a signed Invoke V3 to
   `starknet_proveTransaction`. The prover returns the proof facts needed by the privacy
   pool. In development, the Mac reaches the VPS prover through an SSH loopback tunnel.
5. **Relayer / fee payer.** Sepolia rehearsals use the self-hosted AVNU-compatible relayer
   and fee sponsor. Mainnet uses the deployment account directly in the current runner, so
   the mainnet fee is charged to that account rather than to the Sepolia sponsor.

Every private pool write in this path is proved. In particular, `SetViewingKey` registration,
private note deposits, withdrawals, and `ComputeAndInvoke` are not proof-free public shortcuts
on the deployed pool. The current runner separates Mainnet registration from the first deposit
because the compiler cannot read a deferred registration write while compiling the later channel
setup; combining them produces `SENDER_NOT_REGISTERED` before execution. Do not plan the UX around
an ordinary public registration or shield transaction that avoids the prover.

The deployed mainnet contracts are:

| Component | Address |
|---|---|
| Immutable anonymizer | `0x741fe9dcdf3729919e8c44422fbb963e76a0788f3abad20bb25a50445f363bc` |
| FacetAccount class deployment | `0x42e9d345c46705408394b7a67e291c2bde9f2638297125a7fec2b5740371a45` |
| EkuboSwapAnonymizer helper | `0x2bd92991a0c90757caeb5d0908892637d4288ff4e2013877e0a2707a3788537` |
| Vesu V1.1 vSTRK helper | `0x7568567a11a8072521e4e78f635fd3a4fb07c6bcea4dff909b5109a51c5e4b6` (reserved; deployment pending) |
| Endur xSTRK helper | `0x292df14818896b5366a075581471b4dd9436f6590f696e6f9658a777c4a1240` (reserved; deployment pending) |
| Shared helper class | `0x65f9084b78e26882f2dc1f57b5dff660126487d3b2495cf0fec79ef5bc2c9d4` (not declared yet) |
| STRK20 pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |

## Proven Sepolia swap

The complete shielded STRK-to-ETH swap was executed on Sepolia with a 0.1 STRK input:

- transaction: `0x655cdd1855c6f908bbe409a8a919e5e03effce345c4a338341b630366dec319`
- minimum output: `1082862242726967` wei ETH
- proof wall time: 336 seconds on the development prover
- receipt fee: `0x2e386b4998601500` wei STRK

The receipt is the authoritative result. The proof request hash and the on-chain relayer
transaction are different objects; the prover proves the user's Invoke V3, while Starknet
records the signed transaction that submits the privacy-pool action.

## Mainnet proof-version compatibility

Earlier local checks used the wrong protocol-version conclusion. The live Mainnet 0.14.3 path
accepts the PROOF1/hash pair emitted by `facet-prover-gate-a-53f6`. The SDK preserves the complete
facts returned by the prover and refuses any other pair; it does not rewrite proof facts to force
acceptance.

This compatibility rule is specific to the deployed mainnet pool. Do not blindly rewrite
proof facts for another pool or network.

## Running the mainnet transaction

The amount is expressed in STRK wei; STRK uses 18 decimals. The cap is a safety ceiling, not
an amount the script is expected to spend. Set it only to an amount explicitly approved for
the current run. For the current owner-approved run, the total cap is **40 STRK** and the
planned private deposit and swap input are each **0.1 STRK**. The cap includes fees and is not
an instruction to spend the balance.

Run the read-only mainnet check first. It validates the account, network, pool, anonymizer,
live Ekubo quote, registration state, and available notes without proving or broadcasting:

```bash
cd /Users/user/facet/packages/sdk
unset FACET_USE_SELFHOST FACET_PAYMASTER_CLIENT_FILE FACET_FORCE_NEW_DEPOSIT FACET_ALLOW_MAINNET_BROADCAST
export FACET_NETWORK=mainnet
export FACET_MAINNET_PREFLIGHT_ONLY=1
export FACET_MAINNET_MAX_SPEND_STRK=20
export FACET_DAPP_NAME=facet-mainnet-ekubo-v1
export FACET_GATE_C_AMOUNT=100000000000000000
export FACET_GATE_C_DEPOSIT_AMOUNT=100000000000000000
npm run private:defi:ekubo
```

From `packages/sdk`, paste this block. Each line is a complete shell command, so normal
terminal wrapping cannot split an option or an environment-variable assignment:

```bash
cd /Users/user/facet/packages/sdk
unset FACET_USE_SELFHOST FACET_PAYMASTER_CLIENT_FILE FACET_FORCE_NEW_DEPOSIT FACET_ALLOW_MAINNET_BROADCAST FACET_MAINNET_PREFLIGHT_ONLY
export FACET_NETWORK=mainnet
export FACET_PROVER_CONTAINER=facet-prover-gate-a-53f6
export FACET_PROVER_REMOTE_PORT=3100
export FACET_MAINNET_MAX_SPEND_STRK=20
export FACET_DAPP_NAME=facet-mainnet-ekubo-v1
export FACET_GATE_C_AMOUNT=100000000000000000
export FACET_GATE_C_DEPOSIT_AMOUNT=100000000000000000
npm run private:defi:ekubo
```

The runner refuses to broadcast a mainnet proof unless `FACET_ALLOW_MAINNET_BROADCAST=1` is
present. Omit that line when preparing or reviewing a run. Before adding it, confirm the
displayed input amount, predicted shadow account, router calldata, and recipient policy.

The command prompts for the encrypted keystore password. Enter it locally; it is never
needed in chat, source, logs, or the prover command line. The expected order is:

```text
read-only fee checks
proof generation
proof-aware preflight
signed transaction submission
receipt verification
```

When `FACET_PROVER_URL` is the default loopback URL, the runner establishes an authenticated
SSH tunnel from a port derived from the selected VPS port, checks
`starknet_specVersion`, and waits for the selected container to become ready after a restart.
The current Mainnet container is `facet-prover-gate-a-53f6` on VPS port `3100`; it emits the
accepted PROOF1/hash pair. The tunnel is operational plumbing for this development runner; it is
not the intended user experience.

The remaining Mainnet gate is deposit screening. The live pool requires a fresh screener signature
in the proof's `additional_data`; the current VPS has no proof-interceptor sidecar or
`BLOCKING_CHECK_URL`, so the runner stops before spending proof time until an authorized screening
service is configured.

## Supported wallet-mediated Mainnet path

The direct operator runner above is not the only supported integration boundary. A privacy wallet
that implements the STRK20 Wallet API can own note discovery, proving, screening, and submission.
For the reviewed paths, connect **Ready X on Starknet Mainnet**. The browser submits only a
fixed action set. Ekubo withdraws `0.1 STRK` to Facet's deployed stateless helper, creates one
open ETH note for the connected Ready account, and invokes the helper with a freshly checked
quote. Vesu and Endur withdraw `0.1 STRK` to their protocol-bound helper, call the selected
ERC-4626 vault, and create an open vSTRK or xSTRK note for the connected Ready account.

The ordinary wallet deposit that creates the shielded balance goes to the STRK20 pool; it does
not go directly into Ekubo, Vesu, or Endur. A later app action spends that shielded note, withdraws
STRK to the selected Facet helper, calls the real protocol contract, and settles the protocol
output into a new note. This separation is what makes the app-specific caller different from the
wallet that funded the private balance.

This route is a Facet integration through the helper and Ekubo call path, but it is not a direct
`FacetAccount`-signer transaction: the Ready wallet signs and proves it, while the Mainnet Facet
deployment account is only used to deploy the helper. Do not reuse the existing Ready X eligibility
shield as a Facet DeFi hash. Record a new hash only after its receipt is successful/finalized and
contains the Mainnet STRK20 pool event, the Facet helper call, and the Ekubo protocol event.

The Vesu and Endur pages are route-complete at the calldata and read-only-check level, but they
are not live claims yet: the shared helper class must be declared, both deterministic instances
must be deployed, and each route needs a successful receipt containing the pool, helper, and
protocol events.

A line such as `zsh: command not found: mainnet-ekubo-v1` means the command was pasted with
an unintended newline and an environment assignment was split. It does not indicate an
on-chain failure.

## Timing and product expectations

The local Zen 2 development prover takes roughly five to seven minutes for a full proof and
uses about 6.6 GiB at peak. That is development infrastructure, not the intended interactive
product experience. A production launcher must submit asynchronously through a hosted or
dedicated warm prover, show progress, and separate proving from wallet confirmation. The
browser should enqueue an allowlisted action, return a job id, let the user leave the page,
poll status, and show the final receipt; it must never hold a page request open for the proof
duration. A warm worker avoids queue and restart overhead and prevents duplicate work, but it
does not shorten the proof itself. The current repository does not claim a one-to-two-minute
production benchmark. See [`ASYNC_PROVING.md`](ASYNC_PROVING.md) for the service contract.

## Current Mainnet evidence state

Two successful Mainnet STRK20 transactions are now verified. The 7 STRK Ready X eligibility
shield remains setup evidence. The reviewed Wallet API Ekubo action
`0x2d3c449ebb9cef73f953df5c233a6d932c6f0a4dd5f1f54fc5605e3eab236ab` succeeded in block
14,004,049 (`ACCEPTED_ON_L2`); its receipt contains STRK20 pool events and Ekubo core events,
and its transaction data contains the deployed Facet helper and Ekubo router.

The direct Facet runner remains blocked by AVNU's `SCREENING_REQUIRED` requirement; it was not
used for the successful browser action. One more successful Mainnet pool transaction is still
needed for the three-hash submission target.

## Security boundary

The prover is trusted infrastructure because the current privacy SDK includes the viewing-key
material in its proof input. Keep the prover bound to loopback or behind an authenticated
tunnel. Never expose port 3017/3100 publicly, and never commit keystores, passwords, private
keys, viewing keys, paymaster credentials, or proof request payloads containing secrets.
