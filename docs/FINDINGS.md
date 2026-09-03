# Findings

Everything verified directly from source or from chain data. Every claim here carries a
file:line reference or a block height. Nothing in this file is inferred from documentation
alone. Historical sections retain their original checkpoint wording; later sections explicitly
update the current product and evidence state.

Measurements pinned to block range **8,978,970 → 13,329,863** unless stated otherwise.
Chain head at time of writing: 13,330,217 (15 August 2026, 11:43:38 UTC).

Reference clones: `starkware-libs/starknet-privacy`, `starkware-libs/privacy-bridge`
(shallow, fetched 15 August 2026).

---

## 1. Pool identity

| Property | Value |
|---|---|
| Address | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Class hash | `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d` |
| Deployment block | **8,978,970** |
| Deployment date | 20 April 2026, 10:08:48 UTC |

Deployment block located by binary search on `starknet_getClassHashAt`. The address
matches the one published in the sprint README; confirmed independently against the
deployed contract rather than taken on trust.

**Working public RPC endpoints** (no API key required):
- `https://api.cartridge.gg/x/starknet/mainnet`
- `https://rpc.starknet.lava.build:443`

`https://starknet-mainnet.public.blastapi.io` is **dead** — it returns an error
directing callers to Alchemy. Any guide referencing it is stale.

---

## 2. Pool activity

Full event history: **112,464 events** across the block range above, retrieved in 140
paginated `starknet_getEvents` calls in roughly one minute from a free public endpoint.

Event types identified by matching key/data arity against `packages/privacy/src/events.cairo`,
then confirmed by cardinality analysis of the indexed key fields.

| Event | Count | Notes |
|---|---|---|
| `Withdrawal` | 38,297 | 1,603 distinct `to_addr`, 32 distinct tokens |
| `EncNoteCreated` | 28,123 | |
| `NoteUsed` | 24,390 | nullifiers |
| `Deposit` | 15,702 | 2,373 distinct depositors, 29 distinct tokens |
| `ViewingKeySet` | **2,400** | the complete participant set |
| `OpenNoteDeposited` | 1,181 | |
| `OpenNoteCreated` | 1,181 | 25 distinct tokens |
| `ExternalContractInvoked` | 1,136 | see §5 |

Disambiguation evidence: the `ViewingKeySet` candidate has 2,400 distinct `keys[1]`
(one registration per address, exactly as `open_channel`'s registration rule implies),
while the `Deposit` candidate has 29 distinct `keys[2]` — token addresses, not user
data. `OpenNoteCreated` has 1,181 distinct `keys[2]` (note IDs) against 25 distinct
`keys[1]` (tokens), matching its field order.

### Registration over time

| Period (by block band) | New registrations |
|---|---|
| ~Apr–May | 19 |
| ~May–Jun | 1,109 |
| ~Jun–Jul | 1,089 |
| ~Jul–Aug | **183** |

Registration growth has fallen sharply in the most recent band. Any forecast of
anonymity-set growth must account for this rather than extrapolating the mid-period
rate.

---

## 3. Correlation surface, verified in source

### 3.1 The participant set is publicly enumerable — CONFIRMED

`packages/privacy/src/events.cairo:5-13`

```cairo
pub struct ViewingKeySet {
    #[key] pub user_addr: ContractAddress,
    #[key] pub public_key: felt252,
    pub enc_private_key: EncPrivateKey,
}
```

Both `user_addr` and `public_key` are indexed. Indexing this single event yields the
complete list of pool participants — 2,400 of them at the pinned block.

### 3.2 Inbound channel counts are an unpermissioned view — CONFIRMED

`packages/privacy/src/privacy.cairo:1044,1049` — `get_num_of_channels(recipient_addr) -> u64`
sits in `ViewsImpl`. Anyone may ask, for any address, how many channels have been
opened to it, with no key and no permission.

### 3.3 Deposit is fully public — CONFIRMED

`packages/privacy/src/events.cairo:31-39` — `Deposit` carries `#[key] user_addr`,
`#[key] token`, and a plaintext `amount: u128`. Amounts are arbitrary, not fixed
denominations.

### 3.4 Withdrawal is NOT symmetric — CORRECTION

`packages/privacy/src/events.cairo:17-27`

```cairo
pub struct Withdrawal {
    pub enc_user_addr: EncUserAddr,        // encrypted; auditor-decryptable only
    #[key] pub to_addr: ContractAddress,   // plaintext destination
    #[key] pub token: ContractAddress,
    pub amount: u128,
}
```

A common informal claim is that "both endpoints of the pool are in the clear: who,
which token, how much, when." **This is wrong on the withdrawal side.** The withdrawing
user's pool identity is encrypted and recoverable only by the auditor. What is public
is the *destination* address.

Deposit→withdrawal amount matching still works, and it is what Tutela did on Ethereum,
but the claim must be stated as depositor→destination correlation, not as symmetric
disclosure. Overstating this is the fastest way to lose credibility with a panel that
has read the contract.

### 3.5 A live viewing-key collision exists on mainnet — NEW

Among 2,400 `ViewingKeySet` events there are 2,400 distinct `user_addr` values but only
**2,399 distinct `public_key` values.** Two addresses registered the identical viewing
public key:

| Block | Address |
|---|---|
| 10,475,279 | `0x1dd75821b9a661a2741b7e94ec36a9bc7555d8c6b0640d7ca0e9302392226a9` |
| 11,267,445 | `0x34bf833a75e86f6a1dc26b3be0b110cefb7d2d7abc6b059c6025e23ee1a5da4` |

792,166 blocks apart. Deriving the same viewing key from independent seeds is
cryptographically negligible, so these two addresses are almost certainly controlled by
one entity using one seed. This is a high-confidence linkage derived entirely from
public data.

Reported here as an aggregate structural observation. No identity is claimed and no
attempt was made to attribute either address.

---

## 4. The two-tier action model — critical to any integration

This is the single most important architectural fact for building against the pool, and
it is not stated plainly in the documentation.

There are **two distinct action types**, and confusing them will waste days.

### `ClientAction` — `packages/privacy/src/actions.cairo:262-272`

`SetViewingKey`, `OpenChannel`, `OpenSubchannel`, `CreateEncNote`, `CreateOpenNote`,
`Deposit`, `UseNote`, `Withdraw`, `InvokeExternal`, `ComputeAndInvoke`.

These are **not** what the contract's external entry point accepts. They are executed
inside a *virtual Starknet OS* execution which is then proved
(`privacy.cairo:824` asserts `program_variant == VIRTUAL_SNOS`;
`utils.cairo:79` defines it). The user's `user_private_key` exists only inside that
virtual execution — which is precisely why derived secrets never reach public calldata.

### `ServerAction` — `packages/privacy/src/actions.cairo:369-398`

`WriteOnce`, `Append`, `TransferFrom`, `TransferTo`, `EmitViewingKeySet`,
`EmitWithdrawal`, `EmitDeposit`, `EmitOpenNoteCreated`, `EmitEncNoteCreated`,
`EmitNoteUsed`, `Invoke`, `InvokeWithComputation`.

The on-chain entry point is `packages/privacy/src/interface.cairo:578`:

```cairo
fn apply_actions(
    ref self: T, actions: Span<ServerAction>, screening: Option<ScreeningAttestation>,
);
```

`apply_actions` selector: `0x246333a752c1ac637ff1591c5c885e27d56060d241a29aad8475072da0777db`

A `ClientAction::ComputeAndInvoke` is transformed, inside the proved execution, into a
`ServerAction::InvokeWithComputation` which is what actually lands in calldata.

### Phase ordering — `actions.cairo:277-284`

`ACCOUNT_PHASE 0`, `CHANNEL_PHASE 1`, `SUBCHANNEL_PHASE 2`, `DEPOSIT_PHASE 3`,
`USE_NOTES_PHASE 4`, `CREATE_NOTES_PHASE 5`, `WITHDRAW_PHASE 6`, `INVOKE_PHASE 7`.

`InvokeExternal` and `ComputeAndInvoke` both map to `INVOKE_PHASE` (`actions.cairo:296-298`),
and `actions.cairo:304` states that **at most one invoke-phase action is allowed per
transaction.** Any design that needs several dapp interactions must span several
transactions.

Note `SetViewingKey` is `ACCOUNT_PHASE` (0) while everything else is later — registration
and use can therefore be ordered within a single set of actions.

---

## 5. Anonymizer usage on mainnet

The 1,136 `ExternalContractInvoked` events split by the selector the pool called
(`keys[2]`). Selectors computed locally as `sn_keccak(name) & (2^250 - 1)` and matched
exactly:

| Selector | Name | Calls |
|---|---|---|
| `0x402925cce9218828b3ac9a72ac249103f8448a1e1d73c3efaf5da992625043` | `privacy_invoke` | 810 |
| `0xd7dcfbab5157247251535943d20090fb50187f80535f739fbacc8febab767` | `privacy_invoke_with_computation` | **326** |

(`privacy_compute` = `0x3c4448a75b7a87893c55b626c211bff463d0673333047c3f3fd2996cc54db46`.)

The compute path is **not** unused. Of the 326 calls, however, only **39** reached a
shadow account anonymizer. The remaining 287 went to six other contracts that do not
expose `get_shadow_account` — third parties have already built custom `privacy_compute`
anonymizers.

Upstream, only `shadow_account_anonymizer` uses this path. `ekubo_swap_anonymizer` and
`vesu_lending_anonymizer` both implement plain `privacy_invoke` only.

---

## 6. Shadow accounts

### 6.1 A shadow account anonymizer is deployed on mainnet

| Property | Value |
|---|---|
| Address | `0x4f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7` |
| Class hash | `0x7ffaf4f427c8de0ca35d32d44d97a31da3c24641e32b72f340660d5b9e7f5e6` |
| Deployment block | **12,199,879** |
| Deployment date | 23 July 2026, 12:40:08 UTC |
| Invocations | 39, blocks 12,397,335 → 13,275,294 |

Identified by calling `get_shadow_account` (`0x11c5c4c982cdd31b7d0c7c701100169b05acf0d1ef0552710846fb5eef7e4e2`)
against every compute-path target. This contract responds; the other six return
"Requested entrypoint does not exist in the contract."

Any claim that shadow accounts are "not live yet" is contradicted by chain data.

### 6.2 Identity derivation

`packages/privacy/src/hashes.cairo:57-70`:

```
compute_identity_key(user_addr, user_private_key, contract_address)
  = poseidon(IDENTITY_KEY_TAG:V1, user_addr, user_private_key, contract_address)
```

The pool derives this inside the proved execution and passes it as calldata slot 0 to
the target's `privacy_compute` (`privacy.cairo:555-563`). The target never learns the
user's address.

**The key is bound to `contract_address`.** The same user therefore receives a different
`identity_key` at every anonymizer. Identities at one anonymizer are unlinkable to
identities at another — including to the official deployment.

The anonymizer then applies two further stages
(`shadow_account_anonymizer.cairo:48-58`):

```
partial_commitment  = poseidon(identity_key, dapp_name)
identity_commitment = poseidon(partial_commitment, nonce)
```

Scoping is therefore per-user × per-anonymizer × per-dapp × per-nonce.
`get_shadow_accounts(partial_commitment, start_nonce, end_nonce, until_undeployed)`
scans a nonce range from a single off-chain derivation, capped at
`MAX_SCAN_RANGE = 1024` to prevent unbounded view loops. That is the account-discovery
primitive, already built.

Source comment, `hashes.cairo`: the identity key *"is linked to the user but cannot be
traced back to them, and it can be reproduced only by the user."*

### 6.3 Interface

`shadow_account_anonymizer.cairo:129-135`:

```cairo
fn privacy_invoke_with_computation(
    ref self: T,
    identity_commitment: IdentityCommitment,
    calls: Array<Call>,
    open_notes: Span<OpenNote>,
) -> Span<OpenNoteDeposit>;
```

```cairo
pub struct OpenNote {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub collect_policy: CollectPolicy,
}

pub enum CollectPolicy {
    All,          // variant 0 — collect the entire token balance
    Diff,         // variant 1 — collect only the balance gained this interaction
    Exact: u128,  // variant 2 — collect this exact amount
}
```

Documented constraint: **pass at most one note per token**, otherwise the second
approval overwrites the first and the transaction fails later inside the privacy
contract.

Reverts: `UNAUTHORIZED_CALLER` (caller is not the configured privacy contract),
`ZERO_BALANCE`, `NEGATIVE_DIFF`, `INSUFFICIENT_BALANCE`, `AMOUNT_OVERFLOW`.

### 6.4 A decoded working mainnet invocation

Transaction `0x62252938ae6416c792fc5eb43602f4682ccd1ed615b18b2120944831ae20ea0`,
block 12,397,335. Outer transaction is a v3 `INVOKE` with two calls:

1. `transfer` (`0x83afd3f4caedc6eebf44246fe54e38c95e3179a5ec9ea81740eca5b482d12e`) of
   `0x3782dace9d900000` (4 STRK) to `0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f`
   — paying a relayer.
2. A call to that relayer, which forwards to the pool's `apply_actions`.

The relevant `ServerAction::InvokeWithComputation` payload, 11 felts:

| Offset | Value | Meaning |
|---|---|---|
| 0 | `0x4f33230d…888a7` | target: the shadow anonymizer |
| 1 | `0xb` (11) | calldata length |
| 2 | `0x666db4d657c2da624db34bb82e21f0dd702054d93c771a949e41508f93ffb1c` | `identity_commitment` (the `privacy_compute` result) |
| 3 | `0x1` | `calls.len` = 1 |
| 4 | `0x4718f5a0…c938d` | `Call.to` — STRK |
| 5 | `0x35a73cd311a05d46deda634c5ee045db92f811b4e74bca4437fcb5302b7af33` | `Call.selector` — `balance_of` |
| 6 | `0x1` | `Call.calldata.len` |
| 7 | `0x344e658822ac3b5a48e69dbdd5a428d5298c4d3924ffa0b2e8b367554896e4` | `Call.calldata[0]` |
| 8 | `0x1` | `open_notes.len` = 1 |
| 9 | `0x2eaf46931e13473c9d55554b322394b36e0774d98f21b4abc5741c85a85062f` | `OpenNote.note_id` |
| 10 | `0x4718f5a0…c938d` | `OpenNote.token` — STRK |
| 11 | `0x2` | `CollectPolicy::Exact` |
| 12 | `0x6f05b59d3b20000` | 0.5 STRK |

The trailing `0x1` of the `apply_actions` calldata is `Option::None` for `screening`.

STRK mainnet token address confirmed as
`0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`.

`starknet_traceTransaction` is unavailable on the public endpoints tested, so the decode
above was reconstructed from raw calldata against the source Serde layouts.

**The decode is now confirmed by replay, not by reading** —
`packages/contracts/tests/decoded_invocation.cairo`. The eleven felts are fed back to real
anonymizer bytecode through `call_contract_syscall`, with no typed dispatcher in between:
a dispatcher would serialise the arguments itself and prove nothing, whereas a raw
syscall only succeeds if the felts deserialise exactly as the table above claims. The
payload executes, and the returned `OpenNoteDeposit` carries the `note_id` of slot 9, the
token of slot 10, and the amount of slot 12 — so each slot is confirmed by the effect it
describes, not merely by the absence of a revert.

A control test guards against the obvious failure mode. Shifting slot 11's
`CollectPolicy` discriminant from `Exact` (2) to `All` (0) leaves the amount felt trailing
as a stray argument, and the payload stops deserialising. Without that control, a payload
that happened to execute for unrelated reasons would read as a confirmed decode.

The caller check is satisfied without a proving service by deploying a **fresh anonymizer
from the on-chain class hash** and naming the caller as its privacy contract — the same
escape hatch a self-deployed anonymizer gives Facet in production. This is what made the
question answerable at zero cost, and it is why the answer arrived before any fee was
spent.

**Open question 1 is therefore answered in substance.** What remains is confirmation on a
live chain, which is a formality by comparison: `scripts/sepolia-replay.sh` runs the same
sequence for real, and `decoded_payload_replays_on_sepolia` already runs it against
Sepolia state at no cost.

### 6.5 What the 39 invocations actually do

**All 39** were decoded, not sampled. An earlier five-transaction sample suggested they
were uniformly `balance_of` reads; that was wrong, and the full pass corrected it. The
lesson is recorded here rather than quietly fixed: a sample of five out of thirty-nine
produced a confident and false generalisation.

Every one of the 39 historical invocations issues exactly one `Call`, and **every one targets
the same contract — the STRK token** (`0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`).
Within that measured set, no invocation touched a DeFi protocol. Two selectors appear:

| Selector | Name | Count |
|---|---|---|
| `0x35a73cd311a05d46deda634c5ee045db92f811b4e74bca4437fcb5302b7af33` | `balance_of` | 32 |
| `0x3704ffe8fba161be0e994951751a5033b1462b918ff785c0a636be718dfdb68` | `transfer_from` | 7 |

The 32 `balance_of` calls are no-op reads.

**The 7 `transfer_from` calls are a working funding workaround**, and they matter.
Decoding `0x319b9de82e1704ba861283d26b4e03356a5a3cc948ce8ad752366f1f8bf7883`:

| Offset | Value | Meaning |
|---|---|---|
| 2 | `0x666db4d6…ffb1c` | `identity_commitment` |
| 3 | `0x1` | `calls.len` |
| 4 | `0x4718f5a0…c938d` | `Call.to` — STRK |
| 5 | `0x3704ffe8…db68` | `Call.selector` — `transfer_from` |
| 6 | `0x4` | `Call.calldata.len` |
| 7 | `0x46e978c45ab856377819018ef872314ddaf8f58d9c1dcd5dfcb2265cdcd464c` | `from` |
| 8 | `0x344e658822ac3b5a48e69dbdd5a428d5298c4d3924ffa0b2e8b367554896e4` | `to` |
| 9–10 | `0xde0b6b3a7640000`, `0x0` | 1 STRK (u256) |
| 11 | `0x1` | `open_notes.len` |
| 12 | `0x1874d0f42c03501e246c5c53654984a05476fad74ad7342785c5fe9e381d6ec` | `note_id` |
| 13 | `0x4718f5a0…c938d` | `OpenNote.token` |
| 14 | `0x1` | `CollectPolicy::Diff` |

`get_shadow_account(0x666db4d6…ffb1c)` returns `0x344e658822ac3b5a48e69dbdd5a428d5298c4d3924ffa0b2e8b367554896e4`
— **the `transfer_from` recipient is the shadow account itself.**

So the pattern is: an external account pre-approves the shadow account, the shadow
account's first call pulls 1 STRK from it, and `CollectPolicy::Diff` settles the gained
balance into an open note. **Funding is solved, and it has been done on mainnet seven
times.**

This does not invalidate §6.6 — `privacy_invoke_with_computation` still receives no
funds, which is exactly why a funding call has to be smuggled in as the first `Call`.
It does mean two claims must be stated carefully:

- **False:** "nobody has funded a shadow account." Seven transactions have.
- **True and checkable for the historical set:** all 39 invocations target the STRK token
  contract. **None of those 39 shadow-account invocations interacted with a DeFi protocol.**
  Facet's later Mainnet Ekubo and Endur receipts are recorded in §§6.29 and 6.32.

**The pre-approval method carries a privacy cost that the withdraw pattern does not.**
Granting an allowance requires a public `approve` transaction sent from a funded
external account, naming the shadow account as spender. That publicly ties a real,
funded, non-private address to the facet — which defeats the point. Sourcing the funds
from a shielded note instead (§6.6) has no such leak.

That contrast is the product's sharpest argument, and it is stronger than a claim of
novelty would have been.

### 6.6 The funding gap, and the pattern that closes it — VERIFIED ON SEPOLIA

**`privacy_invoke_with_computation` never receives funds.**
`shadow_account_anonymizer.cairo:308-324`, in full:

```cairo
fn privacy_invoke_with_computation(
    ref self: ContractState,
    identity_commitment: IdentityCommitment,
    calls: Array<Call>,
    open_notes: Span<OpenNote>,
) -> Span<OpenNoteDeposit> {
    assert(get_caller_address() == self.privacy_contract.read(), errors::UNAUTHORIZED_CALLER);
    let shadow_account = self.get_or_deploy_shadow_account(:identity_commitment);
    let note_balance_snapshots = snapshot_open_notes(
        shadow_account: shadow_account.contract_address, :open_notes,
    );
    shadow_account.execute(calls);
    self.collect_open_notes(:shadow_account, :note_balance_snapshots)
}
```

It asserts the caller, resolves or deploys the shadow account, snapshots balances,
executes the calls, and collects. **No step moves tokens into the shadow account.**
Any interaction requiring capital must have the account funded beforehand.

This is the direct explanation for §6.5: a `balance_of` read needs no capital, so the
39 smoke tests never met this wall.

Three facts close the gap.

**(a) A withdrawal may target any address.** `actions.cairo:184-203`:

```cairo
pub struct WithdrawInput {
    pub to_addr: ContractAddress,
    pub token: ContractAddress,
    pub amount: u128,
    pub random: felt252,
}
```

`WithdrawInputValid::assert_valid` asserts only `to_addr.is_non_zero()`
(`ZERO_TO_ADDR`), alongside non-zero token, amount, and random. **Nothing requires the
destination to belong to the withdrawing user.**

**(b) The shadow account's address is computable before it exists.**
`get_shadow_accounts` resolves undeployed nonces via:

```cairo
calculate_contract_address_from_deploy_syscall(
    salt: commitment,
    :class_hash,
    constructor_calldata: array![].span(),
    :deployer_address,   // = get_contract_address(), the anonymizer
)
```

and `get_or_deploy_shadow_account` (`:384-402`) deploys with exactly matching
parameters — `contract_address_salt: identity_commitment`, `calldata: array![].span()`,
`deploy_from_zero: false`. **The prediction and the eventual deployment agree by
construction.**

ERC-20 balances are storage in the token contract keyed by address, so tokens can be
sent to that address before any code is deployed there.

**(c) Withdraw precedes invoke.** `WITHDRAW_PHASE` is 6, `INVOKE_PHASE` is 7
(`actions.cairo:277-284`).

**Therefore, within a single transaction:**

```
UseNote        (phase 4)  spend a shielded note
Withdraw       (phase 6)  send tokens to the predicted shadow account address
ComputeAndInvoke (phase 7) deploy that account at that address, run the dapp
                           calls with the funds present, settle to an open note
```

At the 15 August 2026 research checkpoint, no transaction in the measured Mainnet set
demonstrated this exact shielded-note sequence. Facet subsequently executed it twice on
Sepolia (§§6.17–6.18). The current Mainnet boundary is different: the direct Facet runner
remains blocked by the pool's screening-attestation requirement, while the Ready X
wallet-mediated Ekubo and Endur actions are separately verified in §§6.29 and 6.32.

The source reasoning is therefore verified on Sepolia, but it must not be relabelled as a
direct Facet-runner Mainnet receipt.

### 6.7 What the funding pattern costs in privacy — NEW

The funding leg is **public**, and this constrains the product's honest claims.

`Withdrawal` (`events.cairo:17-27`) carries `#[key] to_addr` and a plaintext `amount`.
Funding a facet therefore publishes, in the clear:

- the shadow account's address
- the token and the exact amount sent to it
- the block it happened in

An observer can then watch `ExternalContractInvoked` and see that same shadow account
transact. So the link **facet ↔ its funding** is public, as is the link
**facet ↔ its dapp activity**.

What stays hidden is the link **facet ↔ user**: `enc_user_addr` on the withdrawal is
auditor-only, and `identity_key` is derived inside the proved execution from
`user_private_key`, which never reaches public data (§4, §6.2).

The correct claim is therefore: *facets are unlinkable to the person behind them, and
unlinkable to each other provided the user does not correlate them by behaviour.*
It is **not** "the funding is invisible."

Two consequences that must reach the threat model and the UI:

- **Amount correlation across facets is the obvious attack.** Funding facet A with
  137.42 STRK and facet B with 137.42 STRK links them by amount, exactly as it would
  in any pool. Round, common denominations are the mitigation.
- **Timing correlation is the second.** Funding several facets in one block, or in a
  tight window, groups them.

This is the strongest argument for the identity-hygiene advisor: unlinkable identities
are trivially relinkable through careless use, and the protocol cannot prevent it.

### 6.8 The anonymizer is upgradeable — NEW

The constructor (`shadow_account_anonymizer.cairo:~292-298`) runs:

```cairo
self.common_roles.initialize(:governance_admin);
self.replaceability.initialize(upgrade_delay: Zero::zero());
```

`ReplaceabilityComponent` with an upgrade delay of **zero**. Whoever holds
`governance_admin` can replace the implementation immediately, with no timelock.

This applies to the officially deployed anonymizer at `0x4f33230d…888a7` as much as to
any self-deployed one, and it is a trust assumption every user of this primitive
inherits. It must be stated plainly in the threat model rather than discovered by a
reader of the source.

### 6.9 SDK support exists

Contrary to any "wallet and SDK support are still landing" claim:

- `sdk/src/internal/shadow-accounts.ts` — 98 lines, `ShadowAccountsBuilderImpl`
- `sdk/src/index.ts:4` exports `ShadowAccountAnonymizerABI`
- Shadow-account references also appear in `sdk/src/interfaces.ts`, `sdk/src/factory.ts`,
  `sdk/src/internal/builders.ts`, `sdk/src/internal/anonymizer-abi.ts`,
  `sdk/src/testing/mocknet.ts`

The client-side path is present in the monorepo. The gap is documentation and product,
not plumbing.

### 6.10 The test suite corrects two assumptions — IMPORTANT

`packages/shadow_account_anonymizer/src/tests/test_shadow_account_anonymizer.cairo`,
733 lines, 29 tests. It is the only substantive documentation this primitive has, and
two of its tests overturn assumptions that would otherwise have shaped the build wrongly.

**(a) One invoke action can carry many calls.**
`test_multiple_invokes_run_in_one_call` (`:216-247`) passes two calls in a single
`Array<Call>`; both execute as the shadow account and their outputs combine into one
`OpenNoteDeposit`:

```cairo
calls: array![
    transfer_to_caller_call(components.mock_dapp, token, first),
    transfer_to_caller_call(components.mock_dapp, token, second),
],
...
assert_eq!(amount, first + second);
```

The one-invoke-per-transaction rule (§4, `actions.cairo:304`) limits **invoke-phase
actions**, not dapp calls. A multi-step flow — approve, swap, deposit — fits in a single
transaction as one `ComputeAndInvoke` carrying an array of calls.

The constraint that genuinely remains: one `ComputeAndInvoke` carries exactly one
`identity_commitment`, so **acting as two different facets still requires two
transactions.** That is the real limit, and it is much weaker than "one dapp call per
transaction."

**(b) Pre-funding a shadow account is an anticipated, tested pattern.**
`test_collects_full_balance_including_preexisting` (`:309-347`):

```cairo
// Deploy the shadow account (empty invoke) so we can give it a pre-existing balance.
components.invoke(:identity_commitment, calls: array![], open_notes: array![].span());
let shadow_account = shadow_account_info(components.anonymizer, 1).address;
components.token.supply(address: shadow_account, amount: preexisting);
```

Three things follow:

- **An empty `calls` array is valid** and deploys the shadow account without doing
  anything else — a cheap way to materialise the address.
- **Funding the account before the interaction is expected behaviour**, not a hack.
  `CollectPolicy::All` sweeps pre-existing balance plus interaction gain
  (`assert_eq!(amount, preexisting + AMOUNT)`). This is upstream validation of the §6.6
  approach.
- On settlement the anonymizer approves the privacy contract for the full collected
  amount: `assert_eq!(components.token.allowance(components.anonymizer, PRIVACY), total)`.

**(c) What the suite does not cover.** No test exercises a dapp call that *reverts*
after the shadow account has been funded. The 29 tests cover access control
(`test_invoke_only_privacy_contract`), all three collect policies, zero balance,
overflow, nonce-range bounds, address prediction
(`test_get_shadow_accounts_computed_address_matches_deploy`), and account reuse — but
not failure mid-interaction.

**The stranded-funds question is therefore untested upstream as well as unexecuted on
mainnet.** It was the highest-risk open question in this project until §6.12 answered it
with fork tests against the live contract.

### 6.11 Documentation coverage is zero

Term frequency across the complete `https://strk20-by-example.org/llms-full.txt`
(121,245 bytes):

| Term | Occurrences |
|---|---|
| `shadow` | **0** |
| `stealth` | **0** |
| `identity_key` | **0** |
| `identity commitment` | **0** |
| `invoke_with_computation` | **0** |
| `privacy_compute` | 2 |
| `ComputeAndInvoke` | 2 |

Two bare selector mentions and nothing else. There is no guide, no example, and no
walkthrough for a primitive that is deployed, working, SDK-supported, and named in the
sprint's own judging rubric.

### 6.12 Fork tests against the live contract — the funding pattern holds

`packages/contracts/tests/fork_shadow_account.cairo`, 269 lines, 10 tests (20 across the
workspace). These execute
the **real deployed bytecode** at mainnet block 13,329,863 — the block every measurement
in this document is taken against — so each assertion is a statement about the contract
users actually interact with, not about a local redeployment. They need no key and cost
no fees.

```
$ snforge test
Tests: 10 passed, 0 failed, 0 ignored, 0 filtered out
```

This is a recorded run from the pinned toolchain, not a claim that a fresh checkout currently
reproduces it. The current sprint still has a Sierra compiler/toolchain resolution issue to
close before presenting Cairo tests as reproducibly passing.

Funding is sourced by impersonating the pool (`start_cheat_caller_address` on STRK, then
`transfer`), so the tokens arrive at the shadow account from the same address the real
`Withdraw` leg pays from.

**(a) The anonymizer half of §6.6 executes.** `prefunded_predicted_address_deploys_and_collects`
runs the pattern end to end, minus the proof:

| Step | Asserted |
|---|---|
| Predict | A fresh commitment reports `is_deployed == false` and a non-zero address |
| Fund | STRK transferred to that address **while no code exists there** |
| Invoke | Empty `calls` array, one `OpenNote` with `CollectPolicy::All` |
| Deploy | `get_shadow_account(commitment)` returns **exactly the predicted address** |
| Collect | Deposit `amount` equals the funded amount; account balance returns to 0 |
| Settle | Anonymizer approves the pool for the full collected amount |

Prediction-then-funding is confirmed against live code, not just read from source.

**(b) The stranded-funds question — ANSWERED.** Both halves, and neither is the bad case:

- `a_reverting_dapp_call_reverts_the_whole_invoke` — a call the shadow account cannot
  satisfy takes the **entire invoke** down. The pool applies actions through
  `call_contract_syscall(...).unwrap_syscall()` (`privacy.cairo:982-985`), so the panic
  propagates out of `apply_actions` and the `Withdraw` in the same transaction reverts
  with it. In the single-transaction sequence of §6.6 there is nothing to strand: either
  the funds arrive and are spent, or the note is never consumed.
- `an_already_deployed_account_sweeps_a_later_top_up` — the case that *can* leave funds
  sitting is funding and invoking in **separate** transactions. That exposure is
  recoverable. A commitment resolves to the same address forever, so an account that has
  already deployed and emptied still collects a later top-up in full, with no redeploy.

The failure mode that would have cost a user their money does not exist on the intended
path, and the adjacent one is recoverable.

**(c) The §6.10 corrections reproduce against live code.**
`one_invoke_runs_several_calls_as_the_shadow_account` passes two transfers in one
`Array<Call>`; both execute and the remainder settles to the note. The upstream finding
was not an artefact of the mock harness.

**(d) Supporting assertions.** `get_privacy_contract()` returns the pool of §1;
`OBSERVED_COMMITMENT` resolves on chain to `OBSERVED_SHADOW_ACCOUNT` (§6.5);
`privacy_compute` matches the local two-stage derivation of §6.2 exactly, which is what
off-chain account discovery depends on; `privacy_invoke_with_computation` panics for any
caller other than the pool; and `selector!("balance_of")` / `selector!("transfer_from")`
equal the selectors decoded in §6.5, confirming that attribution independently.

**What these tests still do not prove.** They impersonate the pool rather than reaching
the anonymizer through it, so the proved-execution half of §6.6 — `UseNote`, `Withdraw`,
and the `ClientAction` → `ServerAction` translation of §4 — is not exercised and cannot
be in a fork test. That gap is closed for the Sepolia route by the receipts in §6.17–§6.18;
Mainnet proof-facts compatibility and the browser product remain separate gates. The §6.4
decode was closed separately by the replay recorded there.

### 6.13 Sepolia carries the classes but no anonymizer; hosted prover URL is not published

Established by direct RPC probing, since none of it is documented:

| Thing | Sepolia | Note |
|---|---|---|
| Privacy pool | `0x0254a6b2…0d91` | v2.0, named in the SDK docs. Class hash `0x56ab118a…23b2` — **different from the mainnet pool's**, so action encodings must not be assumed identical across the two. |
| Anonymizer class | Declared | Same class hash as mainnet, `0x7ffaf4f4…f5e6`. |
| Shadow account class | Declared | `0x346e143e…b5f`, read from the live mainnet anonymizer via `get_shadow_account_class_hash`. |
| Anonymizer **instance** | **None found** | Neither mainnet address holds code on Sepolia, and nothing in the SDK, the docs dump, or the demo configuration names one. |
| Proving service / indexer | **No hosted URL found in checked sources** | The SDK, docs dump and demo configurations expose placeholders or local defaults. The official transaction prover is a public container and self-hosting is confirmed working — the published amd64 build needs recompiling for the host CPU, see below. |

**Correction, same day.** An earlier draft of this section said no public proving service
exists "for either network" and concluded the §6.6 sequence "cannot be exercised on any
chain by anyone outside StarkWare." That generalised from the repositories to the world,
which is the identical mistake §6.5 records. Two pieces of evidence contradict it:

- `strk20-hackathon/docs/MAINNET-DAY-0.md:29` states the starter kit ships **hosted
  Sepolia endpoints** for both prover and indexer, that the mainnet equivalents "come from
  StarkWare", and invites teams to open an issue if they need mainnet proving early. The
  starter kit as published does not in fact contain them — it carries no privacy SDK
  dependency at all — but the sprint organisers plainly consider hosted endpoints to be
  available.
- §5 records **287 compute-path calls to six custom anonymizers** built by other teams, on
  mainnet. Those calls required proofs. Other teams have working proving today.

The accurate statement is narrower: **this repository does not identify a hosted proving
endpoint. That does not block proving.** The official [transaction-prover README](https://github.com/starkware-libs/sequencer/blob/avi/privacy/configmap-docs/crates/starknet_transaction_prover/README.md)
documents the public image named in the [starknet-privacy compatibility matrix](https://github.com/starkware-libs/starknet-privacy#readme),
the local JSON-RPC quickstart, and the `starknet_proveTransaction` method. Run that service
locally with `RPC_URL` set to a v0.10 Starknet RPC, validate `starknet_specVersion`, then
prove a known finalized Invoke V3 transaction before wiring the SDK to `http://localhost:3000`.

**Self-hosting is not hardware-neutral — tested, 15 August.** The published `linux/amd64`
binary aborts with SIGILL (exit 132) on `--help` alone, before it reads any config or opens a
socket. The failure was isolated: a shell inside the same image runs and reports `x86_64`, so
the pull and the image are healthy and it is the binary that faults. Both version-appropriate
tags — `PRIVACY-0.14.3-RC.2` and `PRIVACY-0.14.2-RC.8-screening-v2` — fail identically. The
host is an AMD EPYC 7532 (Zen 2) carrying avx, avx2, bmi2, adx and sha_ni but **no AVX-512**.

Two explanations were open at that point, with different fallbacks: either the Dockerfile's
`TARGET_CPU` build arg (its README example passes `znver5`) had been set at publish time, in
which case a rebuild fixes it; or Stwo uses explicit AVX-512 intrinsics, in which case a
portable amd64 rebuild fails too.

**Resolved the same evening: it is the build flag.** The identical upstream revision
`e6b6fd2e9932909107833579e5b6efd6c75fa0af` was rebuilt for `linux/amd64` with
`TARGET_CPU=znver2` on a standard CI runner, in 19m 11s. On the same EPYC 7532 host that
kills the official image, the rebuild's `--help` exits 0 while the official
`PRIVACY-0.14.3-RC.2` exits 132 — run back to back, reconfirmed 15 August. The rebuilt image
reports `amd64` and carries the upstream revision as an OCI label.

**The published amd64 workflow used `TARGET_CPU=znver5`; that image is incompatible with this
Zen 2 host.** Rebuilding the same revision with `TARGET_CPU=znver2` fixed startup and, in the
full proof benchmark below, completed an entire proof on that host. This establishes that AVX-512 is
not required for the tested proving path; it does not establish compatibility with every CPU.

An `arm64` image is also published. The x86 instruction-set choice cannot exist in an aarch64
build, so Apple Silicon should run the official image unmodified — still reasoning rather than
verification, since this host has no qemu, but the amd64 result makes it very likely.

**Memory floor, measured.** Startup precomputation was OOM-killed (exit 137, `OOMKilled=true`)
with ~1.1 GiB available and no swap. With a temporary 16 GiB swapfile the service started and
settled at **~2.29 GiB resident**. The successful proof benchmark peaked at **7,064,956,928 bytes
(~6.58 GiB)** in the prover cgroup and drove host swap usage to roughly 12 GiB while sharing
the 7.8 GiB host with other services. The OOM killer is therefore a live risk to unrelated
production services — do not start the prover here without swap in place and headroom checked.

Running service, verified: `starknet_specVersion` returns `0.10.3-rc.2`, which is the value
the pinned upstream README documents. An earlier expectation of `0.10.0` in the internal
handoff was wrong. For reference the mainnet RPC this was pointed at, `api.cartridge.gg`,
reports `0.10.2` on both its bare and `/rpc/v0_10` paths — unlike the Sepolia host noted at
the end of this section, the bare mainnet path is not version-degraded.

**Historical replay is not a usable proof fixture.** Two finalized Argent Invoke V3
transactions — `0x62252938…20ea0` (block 12,397,335) and `0x319b9de8…f7883` (block
12,713,881) — were replayed against their parent blocks and both failed account validation
with `argent/invalid-owner-sig`. Zeroing the fee prices and tip changes the signed transaction
hash and invalidates the signature, as expected; but preserving the original fee fields under
`SKIP_FEE_FIELD_VALIDATION=true` failed identically, which it should not have.
`USE_LATEST_VERSIONED_CONSTANTS=false` changed nothing, and the runner always executes the
account's `__validate__` — there is no bypass. **Root cause remains unconfirmed.** The fetched
requests retained `paymaster_data`, `account_deployment_data`, and both data-availability
modes, so attributing the failure to dropped V3 fields is unsupported.

The fixture that avoids the question entirely is a **freshly signed, never-broadcast** Invoke
V3: pick a finalized block, read the account's nonce at that block, build a harmless call,
zero every `max_price_per_unit` and `tip` while keeping `l2_gas.max_amount` non-zero, sign
those exact fields for `SN_MAIN`, and submit to `starknet_proveTransaction`. The proof request
broadcasts nothing and spends no funds, but its signer must already exist in the selected
mainnet state (a newly created account therefore needs one funded deployment first). This also
matches how Facet will really operate — the
§6.6 sequence always signs its own transactions, so replay was only ever a convenience.

**The full proof benchmark completed, 16 August.** A fresh OpenZeppelin account signed an unbroadcast Invoke V3
calling STRK `balance_of`, with all gas prices and tip zero and `l2_gas.max_amount` set to
100,000,000. Against `block_id: "latest"`, the `znver2` prover returned a populated
306,508-character base64 proof and eight proof-fact felts in **485 seconds (8m 05s)**. The
response was 306,890 bytes (SHA-256
`03c759e7e814f64ed923d9d4948a43cea13c44052bb0d617d0a941f8491c5edc`); there were no
L2-to-L1 messages. The transaction was never broadcast.

Provider compatibility matters. Cartridge's endpoint returned code 42 for numbered blocks
40 or more blocks behind the head because it no longer served their storage proofs. Lava
served historical proofs but its RPC 0.8.1 block response lacked `state_diff_commitment`.
The successful run used `https://rpc.vauban.tech/rpc/v0_10`, which reported RPC
`0.10.3-rc.0`, together with `block_id: "latest"` to stay inside the proof-retention window.

Two consequences worth carrying forward:

1. **Local prover validation is complete; browser proof composition is now the critical path.**
   `apply_actions` needs a proof, and the self-hosted service has returned both a populated
   proof and proof facts for a freshly signed Invoke V3. The SDK's local adapter and proving
   primitives are covered by tests; the browser still needs note discovery, proof composition,
   and Sepolia submission before any mainnet funds are considered. A hosted endpoint is
   optional; do not block on an unpublished URL.
2. **Self-deploying the anonymizer is not just a privacy choice, it is the only way to
   exercise the primitive without StarkWare's backend.** The constructor takes
   `privacy_contract` as a parameter, so any address — including an ordinary account —
   can be named the authorised caller.

Also recorded for reproducibility: the bare `api.cartridge.gg/x/starknet/sepolia` host
serves RPC 0.9.0, which snforge 0.59.0 rejects outright. The versioned path
`…/sepolia/rpc/v0_10` serves 0.10.2 and works. Nethermind's free endpoint returned
nothing, Lava's testnet endpoint returned a provider error, and Blast is retired.

---

### 6.14 Live Sepolia confirmation — 18 August 2026

The decoded §6.4 invocation was executed on Starknet Sepolia using a fresh account and a
self-deployed anonymizer. Signing stayed local; no mainnet funds were used.

| Item | Result |
|---|---|
| Sepolia account | `0x1bd5f6f84a45d7f547876d1d083d5bcbeb3d7544e96638851959da32813cbb5` |
| Account deployment | `0x17600d9f07f92a4f684bafd468a45a314035a1677f8bee1b86deab6d9623199` |
| Anonymizer | `0x041521155e2fac699bba66200c77c80e6186693a3ae0923aeb51dc51b34a1bc9` |
| Anonymizer deployment | `0x014eb1f86482ae09c32d5784d604115b9e8ab24c3c6f9349308028e6d5a3ab29` |
| Shadow-account materialisation | `0x0719c8ddafc64eebaea496f84d0ec4ccbee46d561a227422d94e5f0be874e9b7` |
| Derived shadow account | `0x2f394a36cec15b11de15243d9049d871a7b81621e27f98803976f3744c99065` |
| 0.5 STRK funding | `0x067c272692c0afe9f95535504a81352b0ec664c4b09eb8ccbe0c5ae84a571193` |
| Eleven-felt replay | `0x01278bd9634d952da1502118c3bf6f8578b5e4148da6ab992384aeca110675cf` |

The anonymizer's privacy contract resolved to the Sepolia account. After the replay, the
derived shadow account's STRK balance was zero, confirming that the exact `CollectPolicy::Exact`
amount from slot 12 was collected. The replay accepted on chain without contradiction.

### 6.15 First Mainnet eligibility shield — 19 August 2026

The eligibility shield was completed through Ready X. The transaction was checked against the
mainnet receipt: it succeeded, touched the deployed STRK20 pool, and transferred 7 STRK from the
Ready wallet into the pool. At this historical checkpoint it was an eligibility transaction only;
the later Facet/Ekubo and Facet/Endur protocol receipts are recorded in §§6.29 and 6.32.

| Item | Result |
|---|---|
| Ready X Starknet Mainnet wallet | `0x0470c4cca0dd62caecaeb3f9bf047aa3e65fc2f6aa64c6c06ca85929306714fa` |
| STRK token | `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d` |
| Pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Shield amount | 7 STRK |
| Transaction | `0x0721505c4a33bf6457ad21781d7b798203f06faa7ca054a857b738058045716a` |
| Block | 13,538,709 |
| Status | `SUCCEEDED`, `ACCEPTED_ON_L1` |
| Explorer | <https://voyager.online/tx/0x0721505c4a33bf6457ad21781d7b798203f06faa7ca054a857b738058045716a> |

The receipt contains the expected pool event. This paragraph records the state at the first
eligibility checkpoint, before the later Mainnet helper deployments and wallet-mediated protocol
receipts.

### 6.16 Account separation, funding provenance, and Phase A authorization — 19 August 2026

The accounts used in this project are deliberately separated by network and purpose:

| Account | Network | Purpose |
|---|---|---|
| Active Sepolia signer — `0x7a00bfa75ea68c2baa0d6ef2a10f42905d17f9868bfe2d4424072d06139b135` | Sepolia | Private-transaction signer and fee payer; two facets verified |
| `facet-sepolia` — `0x1bd5f6f84a45d7f547876d1d083d5bcbeb3d7544e96638851959da32813cbb5` | Sepolia | Retired historical replay signer; no longer authorized |
| `starknet-gate2` — `0x033ce0b8b9288aabfc75c0b3f9e5323ba50cf8076f7497d14b2b14cd8a2da64b` | Mainnet | Funded deployment account reserved for later Facet/Mainnet work |
| Ready X — `0x0470c4cca0dd62caecaeb3f9bf047aa3e65fc2f6aa64c6c06ca85929306714fa` | Mainnet | Eligibility shield wallet; not the Facet deployment account |

The Sepolia and Mainnet deployment accounts are different addresses. Starknet addresses
may omit leading zeroes, so the Mainnet account may also appear as
`0x33ce0b8b9288aabfc75c0b3f9e5323ba50cf8076f7497d14b2b14cd8a2da64b`.

The public Mainnet funding transaction supplied for that account is
[`0x047052e30cbb17f8f7f284d673a431788a8a9e41c56c39eb109501b27304e751`](https://voyager.online/tx/0x047052e30cbb17f8f7f284d673a431788a8a9e41c56c39eb109501b27304e751).
Its sender is `0x069a7818562b608ce8c5d0039e7f6d1c6ee55f36978f633b151858d85c022d2f`,
and its calldata names the Mainnet account above as the recipient. The transfer amount
encoded in the receipt is **70.28 STRK** (`0x3cf54b7a3fe740000`), not 76 STRK; the
owner's earlier 76 STRK description is retained as an unverified wallet-level report,
while the chain value is authoritative. Any additional funding must be verified as a
separate transaction before being counted.

The owner confirmed the following operational authorization on 19 August 2026, later narrowed
to the current 27 August test plan:

- use the newly created Sepolia private-transaction account for private transactions;
- target 0.5 STRK for the initial private note, plus fees;
- treat 40 STRK as the current maximum total exposure for the approved Mainnet run, not as a
  requirement to spend the full amount;
- approve at most registration, a 0.1 STRK private deposit, and a 0.1 STRK Ekubo action, plus
  gas, subject to the displayed route, amount, recipient, and proof-aware preflight matching;
- trust VPS `38.49.216.59` as the prover host.

This is authorization to proceed, not authorization to spend the full ceiling. The private
transaction path has since passed twice on Sepolia. The prover remains trusted infrastructure
and must not be exposed as an unauthenticated public endpoint.
The current SDK proof invocation places the viewing key in the proof input sent to the
prover, so wallet signing material and viewing-key derivation remain outside the repo and
must never be logged or committed.

The first read-only Sepolia preflight, using the versioned RPC endpoint
`https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10`, returned `0x5589683b1ad782c20`
low and `0x0` high for STRK, equal to **0.055896839199782920 STRK**. The account's ETH
balance was `0x0` low and `0x0` high. No transaction was sent. This is insufficient for
the planned 0.5 STRK note plus fees, so it waits for a Sepolia STRK top-up; Mainnet
funds do not satisfy this preflight.

The active Sepolia account `0x7a00bfa75ea68c2baa0d6ef2a10f42905d17f9868bfe2d4424072d06139b135`
was funded and used for the two successful Sepolia facets recorded in §§6.17–6.18.

---

### 6.17 The §6.6 sequence executed on Sepolia — 25 August 2026

`UseNote → Withdraw → ComputeAndInvoke` has been executed. §6.6 established the sequence was
sound in source and recorded that it had never been run by anyone; it now has two successful
transactions on Starknet Sepolia. Both were proved by the self-hosted transaction prover
(§6.13) and submitted by a self-hosted AVNU-compatible paymaster.

| Item | Result |
|---|---|
| Pool | `0x073f3c4bc1ef39490f09587b11f6ea7f2cc66854d5df3306cda4736234693546` |
| Anonymizer | `0x057e5052865eb08bc1134a62fadfef067015802ce7e989af29fe94913c535efd` |
| Sender | `0x07a00bfa75ea68c2baa0d6ef2a10f42905d17f9868bfe2d4424072d06139b135` |
| Shadow account | `0x05709c3b9dc422ed56c8b21fb3f151a833e078d9f79b6189955f853f793d9d39` |
| Shadow account class | `0x0346e143e3b353473a0d6f681c31ffcf2866537898008027fb3b57335bad7b5f` |
| Deploy + withdraw + collect | `0x05faace1d275d2a301b10dd1fb3f809cc65d3ba8799fbc68f0828eca4a1dedef`, block 14,018,840, 2026-08-25 09:49:52Z |
| Withdraw + dapp call + collect | `0x0111b815a660ee41c17bf285bde7c6b43cbef5bc5d6fbf43d25e94e7f17f3693`, block 14,020,928, 2026-08-25 10:47:41Z |
| Status | Both `SUCCEEDED` and `ACCEPTED_ON_L1` |
| Withdrawn per transaction | 0.5 STRK (`0x6f05b59d3b20000`) |
| Fee, paid by the relayer | 2.786 STRK and 2.737 STRK |

**The on-chain transaction is not the proved transaction.** The prover proves the user's
invoke, whose hash never appears on chain; what is broadcast is the paymaster relayer's
`apply_actions` call against the pool, under a different hash. Looking up the proved hash
returns "Transaction hash not found" on a run that fully succeeded. Both hashes above are
relayer transactions, sender
`0x040374c3084946da092a48c8e4fa9fbec58cdef2653ac4cd354e2b85204d39cb`, nonces 1 and 2.

**What the receipts show.** The two transactions differ in one respect, and between them they
cover both halves of the pattern.

The first carries an anonymizer event naming the shadow account — the deployment — followed by
a 0.5 STRK transfer from the pool to that address, and the same 0.5 STRK returning to the
anonymizer and being re-deposited to the pool. Nothing was spent, so the collect is exact.

The second finds the account already deployed and therefore shows the invoke itself:

1. STRK `Transfer`, pool → shadow account, `0x6f05b59d3b20000` (0.5 STRK) — the `Withdraw` leg
   paying the *predicted* address.
2. STRK `Transfer`, shadow account → sender, `0x1` — **the dapp call, executed as the shadow
   account.** One wei is a deliberately trivial call; what matters is the caller.
3. STRK `Transfer`, shadow account → anonymizer, `0x6f05b59d3b1ffff` — the remainder, which is
   the withdrawal less the one wei spent, collected in full.
4. `Approval` by the anonymizer to the pool for that amount, and a pool deposit event carrying
   it. The change re-enters the shield rather than sitting in the open.

The arithmetic closes exactly: 0.5 STRK in, 1 wei spent, 0.5 STRK − 1 wei back. The shadow
account's STRK balance is **0** at the time of writing, which is the §6.12 prediction holding
on chain rather than in a fork test: the collect is exact and nothing strands.

Not every event in the two receipts has been decoded to a named variant; the four legs above
are asserted from the token contract's own `Transfer` and `Approval` events and from the
anonymizer and pool addresses emitting them.

**Proving cost, measured.** 362.1s and 348.0s wall clock on the Zen 2 VPS
(`ghcr.io/jennycruzy/facet-prover:znver2`, §6.13), consistent with the 485s of the first
recorded proof and the ~290–360s band across eleven proofs run on 25 August.

**Three failure modes cost most of that day**, all of them in the transaction-submission path
rather than in the privacy primitive, and all worth recording because they are invisible in
the SDK's documentation:

1. `argent/multicall-failed` → `ENTRYPOINT_NOT_FOUND` from the paymaster's forwarder. The
   deployed forwarder class did not carry the private entrypoint the privacy path calls.
   Resolved by declaring the current forwarder class, redeploying the paymaster stack against
   it, and upgrading the pool.
2. The same error at the redeployed estimate account, for the same reason, one layer in.
3. `ValidationFailure: Resources bounds … exceed balance`. The relayer needed roughly 6.74
   STRK of resource bounds and held 4.28. Funding it from the gas tank cleared it.

**Fee estimation runs after proving.** In each case the paymaster rejected the transaction
seconds after a five-to-six minute proof had already been generated, so every configuration
error costs a full proof before it surfaces. Any integration should estimate against the
paymaster with a trivial call before spending prover time.

### 6.18 A second, clean facet on Sepolia — 25 August 2026

The first smoke call in §6.17 sent one wei to the Sepolia transaction account's owner, which is a real-world
linkage and is recorded as a limitation rather than hidden. A second run used a different
dapp name and an unrelated recipient to test that the linkage is avoidable.

| Item | Result |
|---|---|
| Dapp name | `facet-second` |
| Dapp recipient | `0x000000000000000000000000000000000000000000000000000000000000dead` |
| Owner excluded from call | `0x7a00bfa75ea68c2baa0d6ef2a10f42905d17f9868bfe2d4424072d06139b135` |
| Predicted shadow account | `0x560b198338b9e7cef36d8c775725e10a8e4fb6a5acfb54fe868a7d07f89e2b8` |
| Deposit transaction | `0x4cee84654535d0f98f7a8e0402fce4c47aab1ff62b6b132d725184e5eb30a07`, block 14,027,039 |
| Private transaction | `0x68510769914a25f6dc9d90fa7f5672bd83908c4ddafc77b1fd6ff3782286b3a`, block 14,028,014 |
| Status | Both `SUCCEEDED` and `ACCEPTED_ON_L1`; the dapp call delivered 1 wei to the unrelated recipient |
| Proof wall time | 400 seconds |
| Actual fees | 2.700103764871909120 STRK (deposit), 2.888034439422903072 STRK (private transaction) |

Receipt verification showed the pool withdrawing 0.5 STRK to the predicted account, the
shadow account sending 1 wei to `0x…dead`, and the remainder returning to the anonymizer.
The owner's address does not appear as the dapp recipient. This is the clean comparison
run required to shrink the first facet's recipient-linkage limitation.

### 6.19 Facet contracts deployed to mainnet — 25 August 2026

The mainnet deployment is complete. The package now has a real `starknet-contract` target; the classes used
for deployment are production artifacts rather than Starknet Foundry test classes. The
test classes had trace instrumentation that mainnet's audited Sierra compiler rejects.
After rebuilding the production target, both classes were declared and deployed from the
encrypted `starknet-gate2` account.

| Contract | Address | Class hash | Compiled class hash | Declaration transaction | Deployment transaction |
|---|---|---|---|---|---|
| Immutable anonymizer | `0x741fe9dcdf3729919e8c44422fbb963e76a0788f3abad20bb25a50445f363bc` | `0x85fbf40e535f188b695c1c3b4492c3045de7305c94e2ce7de4d0f9551adb21` | `0x47ba3ac050abb5b4b94f80bf512afb5c36a623669656134666bf709b09f6706` | `0x708f7621502bf317d0e184c0edc47efc9300651129fc9667c24b3075d4bbeef` | `0x277a84c5b063c235acdd5b5e866e2c6078554517e984536b3bb889b26f07922` |
| FacetAccount | `0x42e9d345c46705408394b7a67e291c2bde9f2638297125a7fec2b5740371a45` | `0x5d07634600fff340d733946c2c8f925ee4c3c637c33f61e33e187b9024de46d` | `0x147d6e959eada2c5dcd90745a62f968a0ac8813499f9f82ba64de0db2db4793` | `0x384426545f8f59e9603674f309acd1fa749911d6f8573dbd9752f40b4294669` | `0x4e9305a7b362901c0ccd1017bba3269993e724383c1fa9608ba94a63011732f` |

Both deployment receipts are `SUCCEEDED` and `ACCEPTED_ON_L1`: the anonymizer is in block
13,850,369 with an actual fee of `0.073135974514343200 STRK`; `FacetAccount` is in block
13,850,382 with an actual fee of `0.073136283779715200 STRK`. The deployed addresses return
the class hashes shown above from `starknet_getClassHashAt`.

The immutable anonymizer constructor is fixed to the mainnet pool
`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` and shadow-account
class `0x346e143e3b353473a0d6f681c31ffcf2866537898008027fb3b57335bad7b5f`. Its compiled ABI
contains no upgrade, proxy, governance, role, or admin entrypoint. The deployment account
was not used as a DeFi recipient. The owner has approved the exact 0.1 STRK test targets for
the pending Mainnet registration/deposit/Ekubo sequence, plus a 40 STRK total ceiling including
fees. No Facet Mainnet DeFi receipt is claimed until the paymaster-backed proof and final manual
gate pass.

### 6.20 Historical Mainnet proof-facts compatibility checks — 28 August 2026

The first direct Facet Mainnet run used the deployed pool, the funded `starknet-gate2`
account, a 0.1 STRK target, and the exact Ekubo route pinned in the adapter. Read-only
preflight passed: the account was deployed, the pool and anonymizer were present, the live
Ekubo quote succeeded, and the account was not yet registered. The runner generated a full
registration proof and then stopped at proof-aware simulation before broadcast. These checks were
made while the node was using the previous protocol-version gate; the current 0.14.3 constants
supersede the candidate conclusion in this section.

The first two attempts rewrote the prover's `PROOF1` marker to `PROOF0` and were rejected
because the accompanying virtual-OS hashes were not allowed. A later attempt preserved the
current prover's original `PROOF1` facts and was rejected because the deployed Mainnet
proof-facts parser expects `PROOF0`. No Mainnet transaction was submitted and no funds moved:

| Attempt | Proof facts | Virtual-OS fact | Wall time | Result |
|---|---|---|---:|---|
| 1 | `PROOF0` after rewrite | `0x53f6c9fcfd31d27279ff7d7e422b44623550a732b59fe193354a7316a96daa1` | 367s | Virtual-OS program hash not allowed |
| 2 | `PROOF0` after rewrite | `0x47fb7a3dfec1ede12156a1dfeec3b2b9c7e549e0ae208d1b760dea41c248901` | 393s | Virtual-OS program hash not allowed |
| 3 | Original `PROOF1` | `0x53f6c9fcfd31d27279ff7d7e422b44623550a732b59fe193354a7316a96daa1` | 375s | Proof-facts parser expected `PROOF0`, received `PROOF1` |
| 4 | `PROOF0` after rewrite | `0x39f55918423cade9e95a6a52286b56bed1c5c9b6fe39aa00301361457a3c604` | 508s | Virtual-OS program hash not allowed |

The source-level `0x3e98c2d7703b03a7edb73ed7f075f97f1dcbaa8f717cdf6e1a57bf058265473`
value was an untested PROOF0 candidate for the previous gate, not a current compatibility result.
The live 0.14.3 node now requires the PROOF1/`0x53f6c9…` pair; candidate selection is not a
transaction receipt and is not submission evidence.

This failure establishes an infrastructure/version gate, not a failure of the Facet action
design. It also establishes why a warm queue matters: the current host spends several minutes
before the rejection becomes visible. The queue can avoid keeping a browser request open and
can prevent duplicate retries, but it cannot bypass proof validation or reduce the raw proof
computation. The complete proof-version/hash pair must be compatible with both the deployed
pool and the live node.

### 6.21 No proof-free registration shortcut on the deployed pool — 27 August 2026

The deployed pool's external write surface routes non-admin actions through `apply_actions`,
which validates proof facts before applying `SetViewingKey`, deposit, withdrawal, or invoke
actions. The deployed ABI does not expose a separate public `register`, `shield`, or `deposit`
entrypoint that avoids proving. Consequently, a headless RPC-only service can read state and
construct an intent, but it cannot move value into this private pool without a proof-bearing
transaction. The Ready X wallet may manage its own STRK20 state, but its currently advertised
Wallet API does not expose Facet's `shadow_account_invoke` action shape.

This corrects the earlier assumption that registration or shielding could be used as a
proof-free workaround. The implementation and issue context are tracked in
[STRK20 issue #156](https://github.com/starkience/strk20-hackathon/issues/156); the hosted
prover requests remain separate infrastructure work.

### 6.22 Public Mainnet proof transport dropped proof facts — 28 August 2026

The first complete Mainnet proof using the then-accepted PROOF0/virtual-OS pair passed the local
proof-aware simulation with nine facts. Its direct `starknet_addInvokeTransaction` submission was
then accepted by the RPC but reverted on-chain as `EMPTY_PROOF_FACTS`:

| Transaction | Execution | Actual fee | State change |
|---|---|---:|---|
| [`0x54ae85094a3baaba9e27c39b52687f3149c6c2a9c532f84452f3d75e4e60b1e`](https://voyager.online/tx/0x54ae85094a3baaba9e27c39b52687f3149c6c2a9c532f84452f3d75e4e60b1e) | `REVERTED`, `ACCEPTED_ON_L1` | `0.035290550669266304 STRK` | none; approval and registration rolled back |

Read-only retrieval of the submitted transaction showed `proof_facts: []`, while the local signed
transaction had nine facts and the same signed object passed `starknet_simulateTransactions`.
The account therefore remains unregistered, with pool allowance `0`; the only loss was the normal
network fee. This isolates the failure to the public direct-RPC transport path, not to the prover,
proof facts, pool fee, or STRK allowance.

`packages/sdk/scripts/gate-c-ekubo.mjs` now fails closed for direct Mainnet proof submission and
uses AVNU's privacy paymaster/forwarder. Its documented private flow wraps the proof-bearing
`apply_action` and, for a deposit, the user's signed `approve` in
`invoke_and_apply_action` ([AVNU private-transaction documentation](https://github.com/avnu-labs/paymaster/blob/main/docs/private-transactions.md)).
For this unregistered account, the first proof combines registration, channel setup, deposit, and
both private fee reserves; the script quotes the public approval and refuses to prove at or above
the owner's 40 STRK ceiling. Subsequent Gate C submission carries the proof and proof facts through
`paymaster_executeTransaction` rather than the direct node endpoint.

### 6.23 Shared 8 GiB VPS cannot complete the bootstrap proof — 28 August 2026

The AVNU quote and public approval were valid: the latest run calculated an initial private
deposit of `28.91752671630441904 STRK` and a user-signed public approval of
`34.91752671630441904 STRK`, below the authorized 40 STRK ceiling. Private-deposit preflight also
passed. During proof generation, however, the compatible `facet-prover-gate-a-0b96` worker reached
about 7.54 GiB resident memory. The VPS kernel logged `global_oom` and killed the prover process;
the client consequently received `curl` exit 52 (empty reply). The container restarted once.

This was an infrastructure-capacity failure before `paymaster_executeTransaction`, not an
allowance, quote, proof-facts, or contract failure. The unrelated services were subsequently
stopped and disabled, and the worker's swap allowance was increased. The remaining failure was
then isolated to the proof-version mismatch recorded below.

### 6.24 Mainnet protocol upgrade selects the PROOF1 worker — 28 August 2026

The previous compatibility conclusion used the wrong protocol-version constants. The live
Mainnet node is on Starknet 0.14.3, whose current Blockifier constants allow only
`PROOF1` (`0x50524f4f4631`) and virtual-OS program hash
`0x53f6c9fcfd31d27279ff7d7e422b44623550a732b59fe193354a7316a96daa1`. Starknet 0.14.2
allowed the older `PROOF0` / `0x3e98c2d7…` pair. The official constants are versioned in the
[Starknet sequencer repository](https://github.com/starkware-libs/sequencer/blob/main/crates/blockifier/resources/blockifier_versioned_constants_0_14_3.json).

That explains the latest paymaster error exactly: the `facet-prover-gate-a-0b96` worker emitted
`PROOF0`, so AVNU's forwarder rejected it with `Proof version ... is not allowed under this
protocol version` before transaction execution. No funds moved in that attempt. The healthy
`facet-prover-gate-a-53f6` worker emits the pair accepted by the current node and has 12 GiB RAM
plus 12 GiB swap available. The runner now selects it by default on Mainnet and fails immediately
if any other proof-facts pair is emitted; it never rewrites the facts.

The deployed privacy pool's current validator does not impose the obsolete `PROOF0` marker
requirement; the live node's protocol gate is the decisive check. The next authorized run is
therefore the existing AVNU paymaster flow using `facet-prover-gate-a-53f6` on port `3100`, with
the same 0.1 STRK deposit, 0.1 STRK Ekubo input, and 40 STRK total ceiling.

### 6.25 AVNU rejected the legacy proof before Mainnet execution — 28 August 2026

After the unrelated VPS services were removed and the prover survived the full workload, the
paymaster-backed private-deposit proof completed in 525 seconds with nine proof facts. The quote,
private-deposit preflight, and 40 STRK approval ceiling all passed. The selected `0b96` worker
then emitted `PROOF0`; AVNU returned `TRANSACTION_EXECUTION_ERROR` before forwarding it:
`Proof version 88314448135728 (PROOF0) is not allowed under this protocol version.` No transaction
hash was returned and no Mainnet funds moved. This confirms the failure is the worker's proof
version, not VPS memory, allowance, paymaster quoting, or the Facet action.

### 6.26 Detached SSH tunnel reused the wrong prover — 28 August 2026

The subsequent run selected `facet-prover-gate-a-53f6` on VPS port `3100`, but the client still
received the `PROOF0` / `0x3e98c2d7…` pair. The local machine had a healthy detached SSH forward
from an earlier run: `127.0.0.1:3017 → VPS:3110`, which targeted the `0b96` worker. The runner's
old health check treated any healthy local endpoint as sufficient and did not verify the remote
port, so it silently reused that stale tunnel. The guard stopped the run before paymaster
submission; no funds moved.

The stale forward was closed. `gate-c-ekubo.mjs` now derives a local tunnel port from the selected
remote port (`3100 → 33100`, unless `FACET_PROVER_URL` or `FACET_PROVER_LOCAL_PORT` is explicitly
set), preventing a healthy tunnel to a different worker from being reused. A short health check
through `127.0.0.1:33100` returned `0.10.3-rc.2` from the `53f6` worker. The next full run is
therefore authorized to use the existing AVNU flow with `facet-prover-gate-a-53f6` / `3100`.

### 6.27 Mainnet pool requires a real screening attestation — 28 August 2026

The next run used the correct `facet-prover-gate-a-53f6` worker. It completed the Mainnet private-
deposit proof in 254 seconds with nine proof facts, passed the private-deposit preflight, and then
AVNU rejected the proof-bearing transaction before returning a transaction hash:

```text
SCREENING_REQUIRED
ENTRYPOINT_FAILED
```

No transaction was submitted and no funds moved in this attempt. The live pool's read-only
`get_screener_public_key` call returned a non-zero key, confirming that screening is enabled. The
pool's `apply_actions` path requires a fresh screening attestation for the proof-bound
`TransferFrom.from_addr`; a missing attestation is serialized by the SDK as `Option::None` and
reverts exactly as observed.

The VPS has no proof-interceptor or elliptic-proxy container, and the running prover has no
`BLOCKING_CHECK_URL`. The pinned prover does support the blocking-check client and relays an
allowed response's opaque `additional_data`, but the official proof-interceptor still needs an
operator-issued screening endpoint/credentials. The pool's production signing private key is not
in this checkout and must not be replaced with the test signer or a mock endpoint.

`gate-c-ekubo.mjs` now fails closed before paymaster submission when a Mainnet initial deposit
proof has no `additional_data.signature`, and refuses to start that expensive proof unless
`FACET_MAINNET_SCREENING_READY=1` is explicitly set after the sidecar's health and screening
metrics have been verified. This is an operational guard, not a bypass of the pool's compliance
check. Do not rerun the deposit proof until a valid screening source or an authorized pool-policy
alternative is available.

### 6.28 Supported Wallet API fallback is the active Mainnet route — 28 August 2026

The direct runner cannot create the production screening attestation required by the live pool,
but this does not make Mainnet unavailable. The official application route is the Privacy Wallet
API: the dapp submits ordinary STRK20 actions, while the privacy-enabled wallet owns the viewing
key, notes, proof generation, and screening. The existing Ready X Mainnet shield proves that this
wallet-managed route can pass the live pool. Ready X advertises Wallet API `0.10.3` and `0.7.2`,
so the supported plain `invoke` action is used; the unadvertised `shadow_account_invoke` action is
not forced.

The upstream `EkuboSwapAnonymizer` helper was rebuilt with the pinned Cairo toolchain. The class
was already declared on Mainnet, and the reserved unique address was deployed from the local
Facet checkout after the read-only check:

| Item | Value |
|---|---|
| Class hash | `0x2a4ac595283d4d64b9952f5ef5c0da1775bfdb7c9d92237524a21dd8d19ebd7` |
| Predicted address | `0x2bd92991a0c90757caeb5d0908892637d4288ff4e2013877e0a2707a3788537` |
| Constructor | empty; stateless |
| Deployment | [`0x188808f3c11914c6ada25cae55defe4d34332f4ff955d1eb272ce9962f08dfc`](https://voyager.online/tx/0x188808f3c11914c6ada25cae55defe4d34332f4ff955d1eb272ce9962f08dfc), `SUCCEEDED`, block 14,000,701 |
| Post-deployment check | class hash at address matches; no upgrade/admin path in the stateless helper |

`packages/sdk/scripts/deploy-ekubo-helper-mainnet.mjs` is idempotent and verifies the address and
class before waiting for the deployment receipt. `packages/web/mainnet-ekubo.html` constructs the
reviewed action sequence: withdraw `0.1 STRK` to the helper, create one `OPEN` ETH note for the
Ready account, and invoke the helper with a live Ekubo quote and 10% slippage floor. The final
write is still a manual Ready X approval; the page does not receive a key or proof. The helper
deployment is verified, and the successful wallet action is recorded below with STRK20 pool,
helper, and protocol evidence.

### 6.29 The reviewed Ready X Facet/Ekubo action succeeded on Mainnet — 28 August 2026

The browser launcher completed the reviewed native STRK20 action through Ready X. The wallet
withdrew `0.1 STRK` to Facet's stateless helper, invoked the helper with the live Mainnet Ekubo
quote, and returned the ETH result to an open note. The transaction was verified through the
Mainnet RPC:

| Item | Result |
|---|---|
| Transaction | [`0x2d3c449ebb9cef73f953df5c233a6d932c6f0a4dd5f1f54fc5605e3eab236ab`](https://voyager.online/tx/0x2d3c449ebb9cef73f953df5c233a6d932c6f0a4dd5f1f54fc5605e3eab236ab) |
| Sender | `0x6cc0a8a10349f4296d3b4b948f754080cc993d72b68fc341de087ba6ccbb558` (Ready-managed shadow account) |
| Block | 14,004,049 |
| Finality | `ACCEPTED_ON_L1` |
| Execution | `SUCCEEDED` |
| STRK20 pool event source | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Ekubo core event source | `0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b` |
| Helper and router evidence | Transaction calldata contains the deployed helper `0x2bd92991a0c90757caeb5d0908892637d4288ff4e2013877e0a2707a3788537` and Ekubo router `0x0199741822c2dc722f6f605204f35e56dbc23bceed54818168c4c49e4fb8737e` |

The receipt also contains STRK and ETH token events. The transaction data contains the expected
STRK20 pool and helper/router addresses; the receipt contains pool events and an Ekubo core event.
This is the first verified Facet protocol action on Mainnet. The direct self-hosted runner remains
a separate path and still stops at AVNU's `SCREENING_REQUIRED` response.

### 6.30 The first wallet-mediated Vesu attempt returned an opaque paymaster error — 29 August 2026

The deployed Vesu helper and the Vesu V1.1 Genesis vSTRK vault passed the browser's read-only
checks: the vault reports STRK as its underlying asset, returns a positive
`preview_deposit(0.1 STRK)`, and accepts the helper in `max_deposit`. The Ready X account had
enough shielded STRK after its fee top-up. The reviewed `wallet_strk20InvokeTransaction` then
returned:

```text
PaymasterV2Error: Paymaster error 156: An error occurred (TRANSACTION_EXECUTION_ERROR) failed
```

Ready returned no transaction hash, so there is no receipt, pool event, helper event, or Vesu
event to claim. Code 156 is only the paymaster wrapper and does not identify whether the nested
failure was screening, helper execution, or the Vesu vault. The route's previous `errorText`
formatter discarded the structured cause; the current working tree preserves bounded
`code`/`message`/`reason`/`details`/`data`/`error`/`execution_error`/`cause` fields and includes
the last error in safe diagnostics. That diagnostic change was subsequently deployed and tested
once; §6.31 records the resulting live migration-extension reason. Repeated retries without a
changed vault configuration are not useful evidence.

### 6.31 The Vesu code-156 wrapper is a live migration-extension revert; Endur passes simulation — 29 August 2026

The diagnostic web build was deployed from the authoritative local checkout and the Vesu route
was retried once. Ready X returned the same top-level error:

```text
PaymasterV2Error: Paymaster error 156: An error occurred (TRANSACTION_EXECUTION_ERROR)
```

It still returned no transaction hash. The page formatter is therefore not the missing fix: the
wallet is exposing only the paymaster wrapper for this failure.

A non-broadcast Mainnet `starknet_simulateTransactions` call was then run against the funded
deployment account using the protocol portion of the same route: `approve(STRK, Vesu, 0.1 STRK)`
followed by `Vesu.deposit(0.1 STRK, owner)`. The live vault passed the ordinary read-only checks,
but the execution trace reverted at:

```text
Vesu vault 0x037ae3f583c8d644b7556c93a04b83b52fa96159b2b0cbd83c14d3122aef80a2
  → singleton 0x02545b2e5d519fc230e9cd781046d3a64e092114f07e44771e0d719d148725ef
  → migration extension 0x034e4027d136afe7ab2da70ff35b742078581fd4d3c87c74e7c035e7bfdd8f2d
  → before_modify_position: "not-allowed"
```

This isolates code 156 to a live Vesu protocol execution failure for the configured Genesis
vSTRK vault. It is not a proof-version, screening, helper-address, quote, or frontend-formatting
failure. The simulation was read-only: no token approval, deposit, protocol position, or note was
created. Vesu's V1.1 vToken source confirms that its `deposit` path delegates into the configured
singleton position flow; Vesu's migration documentation also treats V2 as a separate pool model.

The same read-only Mainnet simulation shape against the deployed Endur xSTRK vault
`0x028d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a` completed successfully,
including the STRK approval, deposit, xSTRK output, and simulated state diff. It was not broadcast.

The Vesu route is therefore blocked and must not be retried under its current vault configuration.
At this point in the timeline, the next safe wallet test was the reviewed Endur page; §6.32 records
that its receipt contains the Mainnet STRK20 pool event, the deployed Endur helper, and the Endur
protocol event.

### 6.32 The reviewed Endur route succeeded on Mainnet — 29 August 2026

The next controlled Ready X Wallet API action used the deployed Endur xSTRK helper and succeeded:

| Item | Result |
|---|---|
| Transaction | [`0x240d2b8285a19485536f686ef9915eb1c6ae5214091ebd10b9770ecab2163f5`](https://voyager.online/tx/0x240d2b8285a19485536f686ef9915eb1c6ae5214091ebd10b9770ecab2163f5) |
| Sender | `0x795a64eaa58c613e489872c8a774138f12cab9390c0c51192ce1c72e926d463` (Ready-managed shadow account) |
| Block | 14,052,044 |
| Finality | `ACCEPTED_ON_L1` |
| Execution | `SUCCEEDED` |
| STRK20 pool event source | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Endur helper event source | `0x292df14818896b5366a075581471b4dd9436f6590f696e6f9658a777c4a1240` |
| Endur protocol event source | `0x028d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a` |

The transaction calldata contains the STRK20 action bundle, the deployed Endur helper, the STRK
input, and the Endur vault. Its receipt contains STRK20 pool events, the helper's protocol-bound
execution event, and Endur xSTRK deposit/share events. This is the second verified Facet protocol
action on Mainnet and is safe to record in `strk20.json`. The Vesu failure remains excluded.

### 6.33 Why the Mainnet routes execute through a protocol-bound helper — 30 August 2026

The Mainnet routes call a Facet-owned helper bound to one protocol rather than a per-application
account. This section records the measurements behind that choice, so the architecture can be
audited rather than taken on trust. The README's implementation boundary states the resulting
limitation; this is the evidence, not a restatement.

**The primitive itself is proven.** §6.6, §6.12 and §6.17 establish the `UseNote → Withdraw →
ComputeAndInvoke` sequence in source, in fork tests against deployed bytecode, and on Sepolia
twice. What follows concerns Mainnet reachability, not whether the mechanism works.

Two transports can drive a shadow account, and each is gated by a different third party.

**(a) The SDK transport requires a screening attestation Facet does not hold.** Recorded in §6.27: a compatible proof completed
and AVNU returned `SCREENING_REQUIRED`. The live pool's screener key is configured, and this
project has no authorized screening endpoint, no `BLOCKING_CHECK_URL`, and no proof-interceptor
deployment. Anyone holding a viewing key can build the actions; nobody outside the authorized
screening service can get them applied to the Mainnet pool.

**(b) The Wallet API transport depends on wallet support this project cannot confirm.** The action
exists in the specification — `shadow_account_invoke`, carrying `dapp_name`, `nonce`, `calls`
and a `collect_policy`, alongside `wallet_strk20ShadowAccountCommitment` for resolving the
partial commitment. It is **not present in any type package this repository installs**, checked
on 30 August 2026:

```
starknet                          10.5.0
@starknet-io/types-js             0.7.10
@starknet-io/starknet-types-09    0.9.2
@starknet-io/starknet-types-0103  0.10.3
grep -rl "shadow_account_invoke" node_modules/@starknet-io node_modules/starknet/dist  → no match
```

The definitions used while investigating this came from a **vendored shim** in the upstream
privacy client, whose own comment marks them as not yet shipped in `@starknet-io/starknet-types`.
`starknet` 10.6.x is published; this repository pins 10.5.0. So the wallet leg has two distinct
unknowns — whether the dependency bump exposes the action, and whether the connected wallet
answers it — and **neither has been tested from this project.** Do not record the wallet leg as
refused; record it as untested. The check is cheap and needs a connected wallet, which this VPS
does not have:

```js
// returns the partial commitment when the wallet implements it; throws otherwise.
await wallet.request({ type: "wallet_strk20ShadowAccountCommitment",
                       params: { dapp_name: "facet-mainnet-ekubo-v1" } });
```

Treat a `NOT_REGISTERED` error as support-with-no-registration, not as absence.

**What the chain says about the consequence.** The official Mainnet shadow-account anonymizer
`0x4f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7` has been live since block
12,199,879 (23 July 2026). Full event scan to block 14,118,501 on 30 August 2026:

| Measure | Value |
|---|---|
| Events since deploy | **20** |
| Distinct transactions | **6** |
| Last event | block **13,180,956** |
| Blocks since last event | **937,545** |

Six transactions, and nothing for the better part of a million blocks. Combined with §5's census —
of 326 `privacy_invoke_with_computation` calls only 39 reached a shadow-account anonymizer, and
all 39 targeted the STRK token contract — the defensible claim is unchanged and now stronger:
**no shadow account has ever interacted with a DeFi protocol on Starknet Mainnet.** The measured
reason is transport availability, not the primitive: both transports above are gated upstream, and
the gates are dated and reproducible from the commands in this section.

**What the helper buys in the meantime.** A protocol-bound helper is not a weaker substitute for a
shadow account; it is a different privacy shape, and for the routes Facet ships today it is the
stronger one. The helper gives every user of a route the same
on-chain identity, which is an anonymity set that grows with usage. A per-application account
gives a fresh identity that is unlinked but alone, and therefore still exposed to amount and
timing correlation on a single interaction. The helper is the better shape for **flow-through**
actions — swap, or stake-and-take-the-shares — where nothing is owned afterwards.

It is the wrong shape for **persistent positions**, and §6.34 is the concrete case: a protocol that
records a lasting owner needs something with an identity to be that owner. A shared helper cannot
hold a position, a claim ticket, or a debt on behalf of one user among many. That is the boundary
the account layer exists to cross, and it is why the account layer is the roadmap rather than a
nice-to-have.

### 6.34 Endur's exit is a queue, so the working exit is the secondary market — 30 August 2026

The obvious exit from the §6.32 Endur position is `redeem` on the xSTRK vault. It does not
return the asset. Verified against a real Mainnet redemption,
`0x4419bf1d39a6af73b9a141a44a988dc6a74bc43ec2af1def48ff4c577c4d8a` (block 14,100,824,
SUCCEEDED, 85,290 xSTRK):

```
xSTRK   Transfer   holder -> 0x0            85,290.00      shares burned
0x518a…  Transfer   0x0 -> holder            (ERC-721)      withdrawal-queue ticket minted
0x518a…  WithdrawQueue event
xSTRK   Withdraw   100,360.26
STRK    Transfer   holder -> fee token                      the fee, and nothing else
```

No STRK reaches the caller in that transaction. The queue contract
`0x518a66e579f9eb1603f5ffaeff95d3f013788e9c37ee94995555026b9648b6` exposes
`request_withdrawal(assets, shares, receiver)`, `claim_withdrawal(request_id)` and a full
`ERC721ABI`; `get_queue_state` reported 10,456 outstanding requests on 30 August 2026. The vault
holds **1.0 STRK liquid against 140,237,299 STRK of total assets** — deposits are forwarded to
validators immediately — which is why redemption cannot settle synchronously. Note that
`max_redeem` returns the holder's full share balance regardless, so the ERC-4626 views do not
predict this.

**The helper cannot express that exit, and this is the safe outcome.** `erc4626_anonymizer.cairo`
computes `balance_after - balance_before` on the output token and asserts
`output_amount.is_non_zero()`. On a queue redemption that difference is zero, the assert fires,
and by §6.12 the panic propagates out of `apply_actions` and reverts the whole invoke including
the `Withdraw`. Nothing strands. Had it not reverted the result would have been worse: the
ERC-721 ticket would mint to the shared helper, which has no `claim_withdrawal` path and no way
to attribute a ticket to one user. **A queue exit requires an owner with an identity.**

**The exit that works is the secondary market.** Quoted live against the Mainnet router on
30 August 2026. The `0.05% / 1000` key returns `NOT_INITIALIZED` for this pair; the initialised
key is `0.01% / 200`:

| Size | Output | vs. `preview_redeem` NAV (1.176055 STRK/xSTRK) |
|---|---|---|
| 0.084999208 xSTRK | 0.099588073 STRK | −0.38% |
| 100 xSTRK | 117.163517 STRK | −0.38% |
| 1,000 xSTRK | 1,171.633996 STRK | −0.38% |
| 10,000 xSTRK | 11,716.222166 STRK | −0.38% |

A flat 38 basis points out to 10,000 xSTRK: the discount is the spread, not depth. Paying 38 bps
to settle in one transaction instead of joining a 10,456-deep queue is the trade a position
holder would choose on the merits, so the exit route is the product answer and not a workaround.
It is implemented as the `ekubo-exit` route; its successful Mainnet receipt is recorded in §6.37.

**The trap is now guarded in code, not only documented.** `erc4626HelperBinding` requires a
`withdraw` binding to name its vault, and refuses any vault listed in `QUEUED_REDEMPTION_VAULTS` —
Endur's xSTRK among them. A queued redemption is rejected when the binding is constructed rather
than reverting on chain after a proof has been paid for. The registry is mirrored in the browser
executor and the two copies are pinned to each other by `tests/executor-parity.test.mjs`.


### 6.35 The Ekubo route settles one token, not two — resolved 30 August 2026

Found by routing the SDK adapters through the reference executor for the first time, which is the
point of having one.

`buildEkuboSwapPlan` returns **two** `settlements` — the input-token remainder and the output
token — each with its own `diff` policy and reasoning. The deployed Ekubo helper's
`IEkuboSwapAnonymizer::privacy_invoke(router_addr, token_amount, pool_key, minimum_received,
skip_ahead, note_id)` takes **one** `note_id`. The live page has always sent one `OPEN` transfer
and one placeholder, so the transaction that succeeded on Mainnet is correct; the *adapter's*
declared settlement set has never been the thing that was submitted.

Nothing was mis-settled, because the two representations never met. That is precisely the risk of
two independent action constructions: the divergence is invisible until something consumes both.
`buildWalletActions` now refuses the combination rather than truncating it, and
`tests/executor.test.ts` pins the refusal.

**Resolved in favour of one settlement**, because the chain says there is no second thing to
settle. This route is an exact-input single hop: the whole input is transferred to the router and
consumed by the swap. In the verified Mainnet transaction `0x2d3c449e…` the full 0.1 STRK reached
the router, and the swap's reported input delta equalled it exactly; the live `quote_swap` returns
the same. There is no input-token remainder, so the adapter was describing a settlement that
cannot occur.

`buildEkuboSwapPlan` now returns a single settlement for the output token, matching both the chain
and the deployed helper's one `note_id`. The comment on that builder records the boundary: a
multi-hop or exact-output route *can* leave an input remainder and must not reuse the builder
unchanged. `buildWalletActions` still refuses any plan whose settlement count exceeds what its
helper can settle, so the class of error stays caught even though this instance is gone.


### 6.36 Production compositions now match their tests — 31 August 2026

A clean-room audit found that passing unit tests did not reproduce several browser compositions.
The correction is deliberately narrow:

- The real `endurAdapter → WalletFacetExecutor` path now produces the helper's supported shape:
  one xSTRK settlement and one open-note reference. Its test calls `executeAppIntent` with the real
  adapter instead of a hand-built substitute.
- The configured Ekubo exit records its result against the Endur context and explicitly closes the
  xSTRK asset. Starknet addresses are canonicalized before comparison, so zero padding cannot leave
  a position falsely marked as held.
- `AdapterPlan.publicRecipients` is required. Endur declares its ERC-4626 receiver, and both SDK and
  browser executors compare every declared recipient with the required linked-address set. Fixed
  helper routes declare an empty list because they expose no user-selected public recipient. This
  control depends on complete adapter declarations; it does not decode arbitrary unknown calldata
  and is not described as a correlation guarantee.
- `executeAppIntent` and `FacetExecutor.execute` no longer accept a facet record that the Ready X
  executor cannot use. The browser calls its storage a device-local activity record and states that
  it does not choose Ready X's execution account.
- Mainnet wallet discovery accepts only the explicit Ready X injections or a generic Starknet
  injection whose identity clearly names Ready X. Argent, Braavos, and unidentified providers are
  not selected for these routes.
- Web publishing now defaults to the checkout containing the script, rejects a dirty checkout and
  broad destinations, validates the source tree, stages the complete release, and retains the prior
  deployment for rollback. A test publishes twice into a temporary destination and checks both the
  live tree and backup.

The remaining product boundaries are unchanged: the local map does not control persistent on-chain
app accounts; general automatic recovery is not implemented; Facet has no Mainnet shielding UI; and
randomized timing is not implemented.


### 6.37 The reviewed xSTRK exit succeeded on Mainnet — 31 August 2026

The configured `ekubo-exit` route was executed against the initialised xSTRK/STRK Ekubo pool after
the Endur position was created. The transaction succeeded and returned the STRK result to the
privacy pool in the same action:

| Item | Result |
|---|---|
| Transaction | [`0xf5ac560c25e7935cb47691d2f025735395e45d04de723a818d5b5a2df090b0`](https://voyager.online/tx/0xf5ac560c25e7935cb47691d2f025735395e45d04de723a818d5b5a2df090b0) |
| Sender | `0x1a8b86c9bb05047b0136a96146c3a5bb5c806afa90687756be45341a86f8e37` (wallet-managed shadow account) |
| Block | 14,134,005 |
| Finality | `ACCEPTED_ON_L2` |
| Execution | `SUCCEEDED` |
| xSTRK input | `0.084999208389004780 xSTRK` |
| STRK output | `0.099599126592305147 STRK` |
| STRK20 pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Facet helper | `0x2bd92991a0c90757caeb5d0908892637d4288ff4e2013877e0a2707a3788537` |
| Ekubo router | `0x0199741822c2dc722f6f605204f35e56dbc23bceed54818168c4c49e4fb8737e` |

The receipt contains the xSTRK transfer from the pool through the deployed Facet helper to the
Ekubo router, the router's STRK output, and the return transfer through the helper into the pool.
The pool and protocol events are present alongside those token transfers, and the helper/router
addresses are visible in the transfer path, so this is the receipt-backed Mainnet execution of the
exit route—not only a quote or simulation.

### 6.38 The launcher now reconciles the portfolio from wallet and chain reads — 1 September 2026

The extension closes the browser-side portfolio gap without adding a backend or pretending that
localStorage is an on-chain registry:

- `packages/web/assets/js/portfolio.js` requests all route assets through
  `wallet_strk20Balances`. That response is the source of truth for the connected user's shielded
  balances; missing assets are displayed as zero and malformed responses fail closed.
- When a wallet implements the optional `wallet_strk20ShadowAccountCommitment` request, the
  launcher keeps the returned partial commitment in memory, calls the Mainnet anonymizer's
  `get_shadow_accounts` view for the configured app and nonce, and reads each discovered account's
  public token balances with `starknet_call`.
- `packages/web/assets/js/chain.js` decodes the returned `Span<ShadowAccountInfo>` and enforces a
  one-nonce view. Discovery bypasses the generic `sessionStorage` RPC cache so the partial
  commitment is not present in a cache key. `facet-map.js` can cache the resulting address,
  deployment flag, balances and observation time, but it never stores the commitment and the UI
  labels cached observations as stale.
- A wallet that lacks the optional request is not treated as an error: the launcher still shows
  the live private balance and the reviewed Wallet API routes, while stating that direct account
  discovery is unavailable. A `NOT_REGISTERED` response is reported as a registration state, not
  as proof that the wallet lacks the capability.

The pure decoder, wallet-response parser, cache reconciliation and end-to-end test-double path are
covered in `packages/web/tests/chain.test.mjs` and `packages/web/tests/portfolio.test.mjs`. No
connected-wallet capability result is claimed here until a Ready X session answers the optional
request.

The static site also now consumes the SDK's actual executor: deployment builds
`packages/sdk/src/index.ts` into `packages/web/assets/js/facet-sdk.js`, and the route-facing
`executor.js` re-exports that artifact. This removes the former hand-maintained browser mirror;
the build output remains dependency-free at runtime. The direct Mainnet identity write is still
blocked by the external screening attestation described in §§6.27 and 6.33.


### 6.39 Facet persistence, encryption, and recovery routing — 2 September 2026

Four gaps between the launcher and a complete facet product closed together, because they are the
same gap seen from different sides: a facet existed for one visit, its record was plaintext, its
recovery had no route, and the browser kept a second copy of the lifecycle.

**Persistence.** `createStorageFacetStore` backs a `FacetStore` with any `getItem`/`setItem`
pair, so a record outlives the tab. A returning wallet resolves the facet it already had rather
than starting over — `createOrRetainFacet` over the same storage returns the original record and
its original address, which is the property the test pins. Writes are defensive: a
private-browsing area that throws on `setItem` degrades the launcher rather than breaking it,
because the record is a cache and never the authority for a facet's existence on chain.

**Encryption.** The interim `recovery.encryptedMetadata` field was typed but did not make a record
private; it has now been removed. The actual capability is generic whole-record sealing via
`sealRecoveryRecord`: AES-GCM with a fresh IV per write, under a non-extractable AES-256 key derived
by HKDF from a verified user-held secret, scoped by the wallet address and domain-separated from
the pool viewing key. A tampered envelope fails authentication instead of decoding, and a
different wallet or secret cannot open the record.

**Sealing that one field was not enough, and the first version of this work shipped believing it
was.** A `FacetRecord` also carries `wallet`, `app`, `strategy` and `address` as ordinary columns,
and `createStorageFacetStore` keys the persisted map by `wallet:app:strategy`. So the
wallet-to-application mapping — the single thing this field exists to protect — was written in
the clear twice while the leaf beside it was encrypted. The test that was supposed to catch this
asserted only that the *position asset* was absent, so it passed. Encrypting a leaf while the
index stays readable protects nothing.

The fix is `saveSealedFacets`/`loadSealedFacets`, which persist the whole record set as one
opaque AES-GCM envelope under a fixed namespace: no wallet, no app id, no address, and no
per-record key to count or correlate — the number of facets is not observable, only the
approximate total size. `loadSealedFacets` deliberately distinguishes an absent namespace (a
first visit, empty) from one that will not open (the wrong wallet, or corruption), because
reporting the second as "no facets" would let a caller overwrite records it merely could not
read. `createStorageFacetStore` is kept for callers that do not need this, and both its
documentation and its test now state plainly that it writes identifying fields in the clear.

**Recovery routing.** `recoveryPlan` classified positions but could not say what to do about
them. `planFacetRecovery` resolves each persistent position against the deployed exit catalogue,
which `exitRoutesFromApps` reads straight out of the same `data/facets.json` the execution pages
use — so a real xSTRK position routes to the real `ekubo-exit`, verified against the shipped file
rather than a fixture. Assets are compared numerically, because the catalogue writes
`0x028d70…` and the browser record writes `0x28d70…`. A route counts only for the facet named in
its `contextApp`, so one facet's exit never appears to rescue another's identical position.
Anything no configured route closes returns `RECOVERY_REQUIRES_ADAPTER` rather than being treated
as recoverable.

One distinction is load-bearing and was found by the tests: **an unconfigured catalogue is not an
empty one.** A caller that has not loaded `facets.json` knows of no routes, and reporting that as
"no route can close this" would state something much stronger than it has established. The
launcher configures the catalogue once at startup (`configureExitRoutes`); without it the wording
falls back to "exit the position before recovering", which stays true either way.

**One lifecycle, not two.** `facet-map.js` previously restated the transition table and the
recovery classification in plain JavaScript, kept in step with the SDK by hand and by a parity
test. It now imports both from the deployed bundle, exactly as `executor.js` already did for the
executor (§6.38), and keeps only storage and the wording the launcher shows. The parity test was
strengthened accordingly: it asserts the browser and the bundle share the *same object*, which
equality could never catch and which is what stops the mirror from returning.

Suites after §6.39: 20 contract, 73 SDK, and the full web suite green.


### 6.40 The launcher stops storing the mapping rather than encrypting it — 2 September 2026

§6.39 sealed the SDK's facet record and left an honest gap: the launcher's own browser cache was
still written to `localStorage` keyed by `wallet:app:strategy`, which is the wallet-to-application
mapping in the clear on the visitor's disk — the exact relationship the product exists not to
publish.

The obvious fix, encrypting that cache, does not work. Separating two wallets' records on disk
requires a label derived from the wallet, and an attacker with access to the browser profile
already holds both inputs: the wallet address, from the extension, and the app list, which is
public and three entries long. Any such label falls to a handful of guesses. Only a secret the
wallet holds would resist it, and obtaining one means a signature prompt on every visit — with the
further problem that the available derivation is EOA-shaped while Starknet wallets are
smart-contract accounts whose signatures are not.

**The first session-only explanation overclaimed what discovery provides.** The partial commitment
and deterministic `dappName`/`nonce` can rediscover an optional public shadow account, but the live
Mainnet routes use Ready X's wallet-mediated helper path. In particular, an Endur xSTRK association
and its lifecycle can exist only in the app-specific activity record; discovery cannot reliably
recreate them. A new tab must therefore treat the lifecycle as unknown, not as an empty record.

The safe fallback still moves new activity writes to `sessionStorage`, and
`purgeLegacyDeviceCache` deletes the pre-v2 `localStorage` record on load. This removes ordinary
persistent plaintext storage but is not cryptographic protection: session data remains readable to
the live page, extensions, injected scripts, and possibly browser session restoration. The cache is
not used to enable lifecycle controls after it disappears. `reconcile` now updates only an existing
session record, and the launcher renders unknown state read-only with recovery, retirement, and new
version controls disabled. A chain observation can block a transition when it exposes an
unaccounted position, but it cannot create authority or enable one.

The SDK's whole-record sealed envelope remains the only persistent privacy-preserving path. At this
point in the finding it was not wired into Ready X: a real Starknet-compatible or user-approved
unlock method was still required. A key stored beside the ciphertext, or an unverified EOA
signature route, would weaken the identity boundary rather than solve it. §6.41 records the later
explicit passphrase integration.

### 6.41 The launcher wires explicit passphrase recovery without weakening the identity boundary — 2 September 2026

The unresolved product choice in §6.40 is now implemented with the user-approved passphrase path,
not with an unverified Ready X signature. `facet-map.js` uses the SDK's PBKDF2-derived,
non-extractable AES-GCM key and stores one fixed-namespace envelope containing only a random KDF
salt and ciphertext. The wallet-to-app mapping, lifecycle positions, transaction history, and
recovery key are absent from persistent plaintext storage; the passphrase is cleared from the input
and is not retained by the page after an unlock or route save.

Unlocking restores only the connected wallet's records into the tab. A wrong passphrase, malformed
payload, unavailable storage area, or failed write is an error rather than an empty state. The
session record remains the active-page view and is intentionally plaintext while the tab is open;
this feature protects persistence at rest, not a compromised page or extension. If no record is
restored, or a chain observation contains an unaccounted position, recovery and retirement remain
disabled. Confirmed Mainnet route pages offer the optional encrypted save only after receipt, so a
failed transaction cannot manufacture recovery metadata.

### 6.42 Three additional Endur route receipts were verified on Mainnet — 3 September 2026

A read-only Mainnet event scan found three successful Ready X Endur actions that were already
finalized on chain but were not yet present in the root submission manifest. Each transaction
contains the deployed Facet Endur helper in its action data and the receipt contains the STRK20
pool event together with Endur xSTRK events:

| Transaction | Block | Result |
|---|---:|---|
| `0xfdd37a2a202261c61bacdb76e5c119f2779ee07db4a5c2bb0720536a71340f` | 14,141,064 | `SUCCEEDED`, `ACCEPTED_ON_L1` |
| `0x7f2ebefab8c9a5928258c3265eb996462092d4a1cf550bfe352f2e91cdc12d` | 14,141,554 | `SUCCEEDED`, `ACCEPTED_ON_L1` |
| `0x27f09f8321fe72765204ad1187f5eb33384e363199bbcba6145d2cd9965e726` | 14,143,128 | `SUCCEEDED`, `ACCEPTED_ON_L1` |

These are verified additions to the existing evidence set, not newly manufactured test claims.
With them, `strk20.json` now records seven pool-touching Mainnet hashes: the eligibility shield
plus six Facet-attributable protocol actions. The registry snapshot may continue to show its old
count until its next rescan; the repository manifest is the source of truth for the submission.

## 7. Toolchain

Upstream pins disagree and must be chosen between deliberately:

| Repository | scarb | starknet-foundry | node |
|---|---|---|---|
| `starknet-privacy` | 2.17.0 | 0.59.0 | 24.0.2 |
| `privacy-bridge` | 2.19.1 | 0.62.1 | 20.14.0 (`.nvmrc`) |

`starknet-privacy/Scarb.toml` further pins `starknet = "2.17.0"`, `snforge_std = "0.59.0"`,
`openzeppelin = "3.0.0"`, edition `2024_07`.

**Decision: pin to 2.17.0 / 0.59.0**, matching the pool — the contract actually linked
against. Installed and verified: `scarb 2.17.0 (aa8740944 2026-04-09)`, cairo 2.17.0,
sierra 1.8.0.

---

## 8. Sprint mechanics — corrections to commonly held assumptions

From `starkience/strk20-hackathon`, read directly:

- `CONTRIBUTING.md` requires **"at least three"** mainnet transaction hashes, not exactly
  three.
- `telegram` entries are **bare usernames** — no `@`, no `t.me` links. Confirmed against
  every existing entry in `registry.json`.
- `registry.json` accepts optional `name`, `one_liner`, `slug`, `category`, `team`,
  `x_handle`, and `inspired_by` beyond the two required fields.
- Registration pull requests **auto-merge**, and merge conflicts are rewritten by a bot.
  Resolving them by hand risks deleting accepted entries.
- `README.md:122` — the 30% integration-depth criterion names **"using stealth accounts"**
  explicitly, as its final item.
- `README.md:127` — *"If another team depends on something you published, that counts in
  your favour."* Published SDK and documentation work is directly scored.

Field size at time of writing: **35 registered projects.** Only three have any mainnet
transactions recorded in their `strk20.json`: `dmetagame/cutout` (4),
`kevlau1/redpocket` (3), `welttowelt/veilpass` (1).
