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
3. **Ekubo.** The shadow account calls the Ekubo router with STRK, then clears the router's
   STRK and ETH balances. The resulting STRK and ETH are returned to private notes.
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

The deployed mainnet pool was built for the legacy `PROOF0` proof-facts marker
(`0x50524f4f4630`). Current upstream prover builds emit `PROOF1`
(`0x50524f4f4631`) even though the payload fields used by this pool have the same layout.
The SDK preserves the complete facts returned by the prover and runs a proof-aware preflight
before broadcasting. If the proof-version/hash pair is incompatible, the script stops before
submitting a transaction; it does not rewrite proof facts to force acceptance.

This compatibility rule is specific to the deployed mainnet pool. Do not blindly rewrite
proof facts for another pool or network.

## Running the mainnet transaction

The amount is expressed in STRK wei; STRK uses 18 decimals. The cap is a safety ceiling, not
an amount the script is expected to spend. Set it only to an amount explicitly approved for
the current run. For the current owner-approved run, the total cap is **20 STRK** and the
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
SSH tunnel from local port `3017` to the VPS prover's loopback port `3100`, checks
`starknet_specVersion`, and waits for the selected container to become ready after a restart.
The current diagnostic container is `facet-prover-gate-a-53f6`; it emits `PROOF1`, which the
deployed pool currently rejects. Do not run a proof or broadcast from this configuration. A
genuine PROOF0 prover whose complete facts pass proof-aware preflight is still required. The tunnel is
operational plumbing for this development runner; it is not the intended user experience.

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

One successful Mainnet STRK20 transaction exists: the 7 STRK Ready X eligibility shield,
`0x0721505c4a33bf6457ad21781d7b798203f06faa7ca054a857b738058045716a`. It touched the live
pool and is useful submission evidence, but it was not a Facet shadow-account DeFi action.

The direct Facet runner has not yet produced a qualifying Mainnet receipt. Four full proofs were
generated and correctly stopped by proof-aware simulation because the proof-version/hash pair
was incompatible with the deployed Mainnet path. Those attempts moved no funds. The next run
must use a genuinely compatible prover, retain the proof-aware preflight, and stop on any
mismatch in amount, route, recipient, pool, or proof facts.

## Security boundary

The prover is trusted infrastructure because the current privacy SDK includes the viewing-key
material in its proof input. Keep the prover bound to loopback or behind an authenticated
tunnel. Never expose port 3017/3100 publicly, and never commit keystores, passwords, private
keys, viewing keys, paymaster credentials, or proof request payloads containing secrets.
