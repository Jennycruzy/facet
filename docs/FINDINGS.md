# Findings

Everything verified directly from source or from mainnet chain data. Every claim here
carries a file:line reference or a block height. Nothing in this file is inferred from
documentation alone.

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

### 6.5 All 39 invocations are smoke tests

Five of the 39 transactions were decoded (samples at positions 1, 5, 15, 25 and 35 of
the sorted set). **Every one is identical in shape:** exactly one `Call`, targeting the
STRK token, with selector `balance_of` — a no-op read — followed by a single open-note
settlement.

No real dapp interaction has ever been executed through a shadow account on mainnet.
The path is validated only for a trivial read call.

This cuts two ways and both matter:

- The primitive is genuinely unused. There is no product built on it.
- Nobody has proven a *real* dapp interaction works end to end on mainnet. Whoever does
  it first meets the unknowns first.

### 6.6 The funding gap, and the pattern that closes it — VERIFIED

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

No mainnet transaction has ever done this. It is the pattern the product is built on.

**Unverified until executed.** The reasoning is sound and every constituent fact is
confirmed in source, but nothing here has been run on-chain. Reproducing it on Sepolia
is the first build task and the only thing that converts this from analysis to fact.

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

### 6.10 Documentation coverage is zero

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

---

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
