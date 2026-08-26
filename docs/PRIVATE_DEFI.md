# Private STRK20 DeFi transactions

This is the user-facing description of Facet's private transaction path. The repository
also contains historical script names such as `gate-c:ekubo`; those names are implementation
labels, not product concepts.

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
4. **Self-hosted transaction prover.** The SDK sends a signed Invoke V3 to
   `starknet_proveTransaction`. The prover returns the proof facts needed by the privacy
   pool. In development, the Mac reaches the VPS prover through an SSH loopback tunnel.
5. **Paymaster.** Sepolia rehearsals use the self-hosted AVNU-compatible paymaster and its
   relayer. Mainnet uses the deployment account directly, so the mainnet fee is charged to
   that account rather than to the Sepolia paymaster.

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
The SDK's mainnet path converts only that first marker before signing and runs a proof-aware
preflight before broadcasting. If the proof-aware preflight fails, the script stops before
submitting a transaction.

This compatibility rule is specific to the deployed mainnet pool. Do not blindly rewrite
proof facts for another pool or network.

## Running the mainnet transaction

The amount is expressed in STRK wei; STRK uses 18 decimals. The cap is a safety ceiling, not
an amount the script is expected to spend. Set it only to an amount explicitly approved for
the current run. For the current owner-approved run, the total cap is 15 STRK and the swap
input is 0.1 STRK.

From `packages/sdk`, paste this block. Each line is a complete shell command, so normal
terminal wrapping cannot split an option or an environment-variable assignment:

```bash
cd /Users/user/facet/packages/sdk
unset FACET_USE_SELFHOST FACET_PAYMASTER_CLIENT_FILE FACET_FORCE_NEW_DEPOSIT
export FACET_NETWORK=mainnet
export FACET_MAINNET_MAX_SPEND_STRK=15
export FACET_DAPP_NAME=facet-mainnet-ekubo-v1
export FACET_GATE_C_AMOUNT=100000000000000000
npm run gate-c:ekubo
```

The command prompts for the encrypted keystore password. Enter it locally; it is never
needed in chat, source, logs, or the prover command line. The expected order is:

```text
read-only fee checks
proof generation
proof-aware preflight
signed transaction submission
receipt verification
```

A line such as `zsh: command not found: gate-c-ekubo-mainnet-v1` means the command was pasted
with an unintended newline. It does not indicate an on-chain failure.

## Timing and product expectations

The local Zen 2 development prover takes roughly five to seven minutes for a full proof and
uses about 6.6 GiB at peak. That is development infrastructure, not the intended interactive
product experience. A production launcher should submit asynchronously through a hosted or
dedicated prover, show progress, and separate proving from wallet confirmation. The current
repository documents the working path and its measured cost; it does not claim a one-to-two
minute production benchmark yet.

## Security boundary

The prover is trusted infrastructure because the current privacy SDK includes the viewing-key
material in its proof input. Keep the prover bound to loopback or behind an authenticated
tunnel. Never expose port 3017/3100 publicly, and never commit keystores, passwords, private
keys, viewing keys, paymaster credentials, or proof request payloads containing secrets.
