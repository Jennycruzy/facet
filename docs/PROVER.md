# Running the STRK20 transaction prover

`apply_actions` needs a proof, and we could not find a hosted proving endpoint published in
the SDK, the documentation dump, the demo configuration or the starter kit — every reference
we checked is a placeholder or a local default. That is not a blocker: the transaction prover
is a public container image, it pulls anonymously, and its README states that proving is
client-side with no fees charged. You can run it yourself.

The catch is that **the published `linux/amd64` image does not run on every amd64 host**, and
it fails in a way that looks like a broken pull rather than a CPU mismatch. This document is
the diagnosis, the fix, the measured resource floor, and the request format — everything we
had to work out by hand.

Every number here was measured on an **AMD EPYC 7532 (Zen 2), 2 vCPU, 7.8 GiB**, which is far
below the hardware StarkWare recommends. Treat the timings as an upper bound, not a spec —
two runs of the same request on that host differed by 27%.

---

## 1. The failure

The official image aborts on `--help` alone, before it reads any configuration or opens a
socket:

```
$ docker run --rm ghcr.io/starkware-libs/starknet-privacy/transaction-prover:PRIVACY-0.14.3-RC.2 --help
$ echo $?
132
```

Exit 132 is SIGILL — an illegal instruction. Both version-appropriate tags fail identically:

| Tag | Result |
|---|---|
| `PRIVACY-0.14.3-RC.2` | exit 132 |
| `PRIVACY-0.14.2-RC.8-screening-v2` | exit 132 |

**It is not a bad pull.** A shell inside the same image runs fine and reports `x86_64`, so
the image and the download are healthy. It is the binary itself.

The host carries `avx`, `avx2`, `bmi2`, `adx` and `sha_ni`, and **no AVX-512**. Check yours:

```bash
lscpu | grep -o 'avx512[a-z_]*' | sort -u
```

## 2. The cause

The prover's Dockerfile takes a `TARGET_CPU` build argument, and its README example passes
`znver5` — Zen 5, i.e. EPYC Turin. The argument defaults to empty and `-C target-cpu` is only
applied when it is non-empty, so a **default build is portable**; the published amd64 image is
not, because it was built with that flag set.

That leaves two possible explanations, with very different consequences:

1. The build flag alone, in which case rebuilding fixes it.
2. Stwo using explicit AVX-512 intrinsics, in which case no amd64 rebuild helps.

**It is the build flag.** Rebuilding the identical upstream revision for an older target
produces a binary whose `--help` exits 0 on the same host that kills the official image, run
back to back. AVX-512 is not required for the proving path tested here. That is not a claim
about every host CPU.

## 3. Getting a working binary

Two routes. Pull the prebuilt image if your host matches, build from source if it does not —
and building is not hard, it is just slow.

### Pull a prebuilt image

Built from the upstream revision below with `TARGET_CPU=znver2`, so it runs on **Zen 2 and
newer AMD** (EPYC Rome/Milan/Genoa, Ryzen 3000+) and on the AMD instance families at the major
clouds. It will not run on older AMD, and it may not run on Intel — Zen-targeted builds can
emit AMD-only instructions. Check before you rely on it:

```bash
docker pull ghcr.io/jennycruzy/facet-prover:znver2
docker run --rm ghcr.io/jennycruzy/facet-prover:znver2 --help && echo "exit $?"
```

Exit 0 and a printed CLI means you are good. Exit 132 means your CPU is not compatible —
build it yourself instead.

The image carries `org.opencontainers.image.revision` naming the exact upstream commit it was
compiled from, so you can check what you are running:

```bash
docker inspect ghcr.io/jennycruzy/facet-prover:znver2 \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
```

### Build it for your own CPU

[`infra/prover/build.sh`](../infra/prover/build.sh) clones the pinned revision, builds for the
target you name, and verifies the binary starts before it hands you the tag:

```bash
TARGET_CPU=znver2 ./infra/prover/build.sh
```

- Substitute your own microarchitecture — or **run it with no `TARGET_CPU` at all** for a
  portable build, which is the right choice if you do not know what you are deploying to.
- Around 20 minutes on 4 vCPU. Do not build it on a small production box.
- The script fails loudly on exit 132 and tells you to drop to a lower target.

The equivalent by hand:

```bash
git clone https://github.com/starkware-libs/sequencer.git
cd sequencer
git checkout e6b6fd2e9932909107833579e5b6efd6c75fa0af

docker build \
  --platform linux/amd64 \
  --build-arg TARGET_CPU=znver2 \
  -f crates/starknet_transaction_prover/Dockerfile \
  -t transaction-prover:local \
  .

docker run --rm transaction-prover:local --help && echo "exit $?"
```

**On Apple Silicon**, an `arm64` image is also published and the x86 instruction-set choice
cannot exist in an aarch64 build, so the official image should run unmodified. That is
reasoning, not something we verified — we have no aarch64 host.

## 4. Running it

[`infra/prover/docker-compose.yml`](../infra/prover/docker-compose.yml) carries the settings
that matter — loopback binding, a memory limit, and a health check that waits out the long
startup:

```bash
cd infra/prover
cp .env.example .env      # then set RPC_URL in it
docker compose up -d
```

`RPC_URL` is a required variable, so set it in `.env` rather than exporting it — otherwise
`docker compose down` and `logs` fail to parse the file too, not just `up`.

Or by hand:

```bash
docker run -d --name prover \
  -p 127.0.0.1:3000:3000 \
  --memory 7g \
  -e RPC_URL="https://<your-starknet-rpc>/rpc/v0_10" \
  ghcr.io/jennycruzy/facet-prover:znver2
```

**Bind to loopback.** The service is unauthenticated and every request costs minutes of CPU,
so an exposed port is a free denial-of-service against your own machine. Set a memory limit
too — see the next section for why.

Confirm it is alive:

```bash
curl -s http://localhost:3000 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_specVersion","params":[]}'
```

```json
{"jsonrpc":"2.0","id":1,"result":"0.10.3-rc.2"}
```

`0.10.3-rc.2` is the value the pinned upstream README documents for this revision.

If the prover and your signing key live on different machines, keep them that way and reach
the service over an SSH tunnel — it is plain JSON-RPC and does not care where the caller is:

```bash
ssh -L 3000:localhost:3000 <prover-host>
```

## 5. Resource floor, measured

| | |
|---|---|
| Startup, no swap, ~1.1 GiB available | OOM-killed, exit 137, `OOMKilled=true` |
| Idle at steady state | ~2.29 GiB resident |
| Peak during one proof | 6.58–6.67 GiB across two runs |
| Host swap consumed during that proof | roughly 12 GiB |

Startup performs a precomputation that is itself enough to trigger the OOM killer on a small
host. With a 16 GiB swapfile the service started and completed proofs on a 7.8 GiB machine,
but **the OOM killer is a live risk to anything else on the box**. If you share a host with
services you care about, set `--memory` on the container and provision swap before starting:

```bash
fallocate -l 16G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
```

StarkWare's production recommendation is `c4d-highcpu-48` — 48 vCPU, 96 GB — with no stated
minimum. A 2-vCPU host works for development. It is not a serving tier.

## 6. Proving a transaction

`starknet_proveTransaction` has hard constraints, and violating them produces errors that
read like your own bug:

- `"type": "INVOKE"` and `"version": "0x3"` only. Declare and DeployAccount are rejected.
- Every resource bound — `l1_gas`, `l2_gas`, `l1_data_gas` — must set
  `max_price_per_unit: "0x0"`, and `tip` must be `"0x0"`. `max_amount` may be non-zero.
  `SKIP_FEE_FIELD_VALIDATION=true` is the escape hatch.
- `proof` and `proof_facts` are output-only. Do not send them.
- `block_id` must be finalized. Pending blocks are unsupported.

### Do not try to replay a historical transaction

The obvious fixture is a transaction that already landed, with its fee fields zeroed. It does
not work, and the reason costs a day.

Zeroing the fee prices changes the signed transaction hash and invalidates the signature, as
you would expect. But **preserving the original fee fields under
`SKIP_FEE_FIELD_VALIDATION=true` fails identically**, which it should not. Two finalized
Argent Invoke V3 transactions replayed against their parent blocks both returned
`argent/invalid-owner-sig`. `USE_LATEST_VERSIONED_CONSTANTS=false` changed nothing, and there
is no account-validation bypass — the runner always executes the account's `__validate__`.

**Root cause unconfirmed.** The requests retained `paymaster_data`,
`account_deployment_data` and both data-availability modes, so blaming dropped V3 fields is
unsupported.

### The fixture that works

Construct a fresh, **never-broadcast** Invoke V3 for an account you hold the key to:

1. Pick a finalized block and read the account's nonce at that block.
2. Build a harmless call — a STRK `balance_of` is enough.
3. Set every `max_price_per_unit` and `tip` to `"0x0"`, keep `l2_gas.max_amount` non-zero.
4. Sign those exact fields for your chain ID.
5. Submit to `starknet_proveTransaction`. Do not broadcast it.

The request spends nothing, but the signer must already exist in the selected state — a newly
created account needs one funded deployment first. This also matches how a real integration
behaves, since it always signs its own transactions.

### Result on the reference host

An Invoke V3 calling STRK `balance_of`, nonce `0x1`, all gas prices and tip zero,
`l2_gas.max_amount = 0x5f5e100`, against `block_id: "latest"`. The identical request, run
twice about half a day apart:

| | Run 1 | Run 2 |
|---|---|---|
| Wall time | 485s (8m 05s) | **355s (5m 55s)** |
| Peak memory | ~6.58 GiB | ~6.67 GiB |
| Proof | 306,508 base64 chars | 315,144 base64 chars |
| Proof facts | 8 felts | 8 felts |
| L2-to-L1 messages | 0 | 0 |

Same host, same request, **27% apart**. Budget for the slower number and do not read a single
timing as a benchmark.

Block ID is not part of the transaction signature, so switching from a numbered block to
`latest` is free and avoids retention problems — see below.

### What changes between runs, and what does not

Against `block_id: "latest"` the proof is anchored to whatever block is current, so two runs
of a byte-identical request return different proofs. Comparing the eight proof facts across
the two runs above shows exactly which parts move:

| Fact | Run 1 | Run 2 | |
|---|---|---|---|
| 1 | `0x50524f4f4631` | same | `PROOF1` tag |
| 2 | `0x5649525455414c5f534e4f53` | same | `VIRTUAL_SNOS` tag |
| 3 | `0x53f6c9fc…6daa1` | same | program hash |
| 4 | `0x5649525455414c5f534e4f5330` | same | `VIRTUAL_SNOS0` tag |
| 5 | `0xcc74e9` | `0xccdf90` | **block number** — 13,399,273 → 13,426,576 |
| 6 | `0x1d29c43b…4752` | `0x2cd92179…5bcd` | **state commitment at that block** |
| 7 | `0x5b3bc83b…2d7a` | same | transaction commitment |
| 8 | `0x0` | same | |

So do not treat a response hash as a reproducibility check — it will never match. Facts 5 and
6 are block-dependent by construction; everything else is invariant for a given transaction.
If facts 1, 2, 3, 4, 7 or 8 change between runs of the same request, something is genuinely
wrong.

### Error codes

| Code | Meaning |
|---|---|
| `24` | Block not found, or pending |
| `55` | Account validation reverted |
| `61` | Unsupported transaction version |
| `1000` | Invalid input — usually a non-zero gas price or tip |
| `-32005` | Service busy |
| `-32603` | Internal error |

## 7. RPC provider compatibility

The prover needs storage proofs from its `RPC_URL`, and providers differ in ways that are not
documented anywhere:

| Provider | Result |
|---|---|
| `rpc.vauban.tech/rpc/v0_10` | **Worked.** Reported RPC `0.10.3-rc.0`. |
| `api.cartridge.gg/x/starknet/mainnet` | Error 42 for numbered blocks roughly 40+ behind the head — outside its storage-proof window. Fine with `block_id: "latest"`. Reports `0.10.2`. |
| Lava | Served historical proofs, but its RPC 0.8.1 block response lacks `state_diff_commitment`, which this prover requires. |
| Blast | Retired. |

Also worth knowing if you are running Cairo tests against Sepolia: the bare
`api.cartridge.gg/x/starknet/sepolia` host serves RPC 0.9.0, which snforge 0.59.0 rejects
outright. The versioned path `…/sepolia/rpc/v0_10` serves 0.10.2 and works.

## 8. Mainnet proof-facts compatibility

The deployed mainnet STRK20 pool is not compatible with every prover build that can
produce an otherwise valid proof. Its proof-facts parser expects the legacy `PROOF0`
marker (`0x50524f4f4630`) and an allowlisted virtual-OS program hash.

The current upstream development prover emits `PROOF1`
(`0x50524f4f4631`) and, in one otherwise healthy build, emitted the virtual-OS hash
`0x47fb7a3dfec1ede12156a1dfeec3b2b9c7e549e0ae208d1b760dea41c248901`. The mainnet pool
rejected that hash before execution. Replacing the first marker alone is therefore not
enough.

The SDK's mainnet runner now does three things before any broadcast:

1. generates the proof from a signed Invoke V3;
2. preserves the prover's complete proof-facts version/hash pair;
3. runs a proof-aware simulation of the exact signed transaction and stops if the node or pool
   rejects the facts.

Do not bypass the proof-aware simulation or rewrite proof fields. A compatible prover must
produce a complete proof-facts pair accepted by both the live node and the deployed pool. This
compatibility check belongs in infrastructure validation, not in a user's first transaction
attempt.

### 8.1 Current candidate check — 28 August 2026

Four Facet Mainnet registration attempts reached full proof generation but were stopped before
broadcast by the exact proof-aware simulation:

| Proof facts | Candidate virtual-OS hash | Result | Proof wall time |
|---|---|---|---:|
| `PROOF0` after rewrite | `0x53f6c9fcfd31d27279ff7d7e422b44623550a732b59fe193354a7316a96daa1` | Virtual-OS hash rejected | 367s |
| `PROOF0` after rewrite | `0x47fb7a3dfec1ede12156a1dfeec3b2b9c7e549e0ae208d1b760dea41c248901` | Virtual-OS hash rejected | 393s |
| Original `PROOF1` | `0x53f6c9fcfd31d27279ff7d7e422b44623550a732b59fe193354a7316a96daa1` | Parser expected `PROOF0` | 375s |
| `PROOF0` after rewrite | `0x39f55918423cade9e95a6a52286b56bed1c5c9b6fe39aa00301361457a3c604` | Virtual-OS hash rejected | 508s |
| Genuine `PROOF0` | `0x3e98c2d7703b03a7edb73ed7f075f97f1dcbaa8f717cdf6e1a57bf058265473` | Untested source-level candidate | — |

The current VPS diagnostic container is `facet-prover-gate-a-53f6`, using the
`605c29361962` image on loopback port `3100`; it is not currently compatible with the
deployed pool because it emits `PROOF1`. This is a compatibility investigation, not a
proving-speed fix. It does not change the measured five-to-seven-minute proof cost.
The exact Facet registration, deposit, and Ekubo action must each pass proof-aware preflight
before a receipt can be claimed. No Mainnet DeFi transaction is recorded from the rejected
runs.

The SDK preserves the complete proof facts returned by the prover. It must not rewrite the
marker, virtual-OS hash, or any other proof fact merely to make a transaction look acceptable.
The proof must come from a build whose complete facts the live node and pool allow.

---

## Summary

| | |
|---|---|
| Upstream | `starkware-libs/sequencer`, revision `e6b6fd2e9932909107833579e5b6efd6c75fa0af` |
| Crate | `crates/starknet_transaction_prover` |
| Fix for SIGILL | pull `ghcr.io/jennycruzy/facet-prover:znver2`, or rebuild with your own `TARGET_CPU` — omit it for a portable build |
| Memory floor | ~2.29 GiB idle, ~6.58 GiB peak per proof |
| Verified version | `starknet_specVersion` → `0.10.3-rc.2` |
| Reference timing | 355–485s on 2 vCPU Zen 2 — an upper bound, not a spec |

For a user-facing product, keep a compatible worker warm and place proofs behind an
authenticated asynchronous job API. That lets the user leave the page and prevents a
refresh from queueing duplicate work. It does not reduce the cryptographic wall time; only
faster hardware, a supported hosted service, or future client-side acceleration can do that.
The service design and its fail-closed quote/expiry rules are in
[`ASYNC_PROVING.md`](ASYNC_PROVING.md).
