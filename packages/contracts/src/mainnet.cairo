//! Mainnet constants, each verified on chain and recorded in `docs/FINDINGS.md`.
//!
//! Addresses are stated as `felt252` and converted at use, so nothing here depends on a
//! `ContractAddress` literal syntax.

/// Shadow account anonymizer. FINDINGS §6.1 — deployed at block 12,199,879.
pub const ANONYMIZER: felt252 =
    0x4f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7;

/// Class hash of the deployed anonymizer. FINDINGS §6.1.
pub const ANONYMIZER_CLASS_HASH: felt252 =
    0x7ffaf4f427c8de0ca35d32d44d97a31da3c24641e32b72f340660d5b9e7f5e6;

/// The privacy pool. FINDINGS §1 — deployed at block 8,978,970.
pub const POOL: felt252 = 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a;

/// STRK. FINDINGS §6.4.
pub const STRK: felt252 = 0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d;

/// The identity commitment carried by the decoded mainnet invocations. FINDINGS §6.4 slot 2.
pub const OBSERVED_COMMITMENT: felt252 =
    0x666db4d657c2da624db34bb82e21f0dd702054d93c771a949e41508f93ffb1c;

/// The shadow account `OBSERVED_COMMITMENT` resolves to. FINDINGS §6.5.
pub const OBSERVED_SHADOW_ACCOUNT: felt252 =
    0x344e658822ac3b5a48e69dbdd5a428d5298c4d3924ffa0b2e8b367554896e4;

/// `Call.selector` seen in the 32 read-only invocations. FINDINGS §6.5.
pub const OBSERVED_BALANCE_OF_SELECTOR: felt252 =
    0x35a73cd311a05d46deda634c5ee045db92f811b4e74bca4437fcb5302b7af33;

/// `Call.selector` seen in the 7 funding invocations. FINDINGS §6.5.
pub const OBSERVED_TRANSFER_FROM_SELECTOR: felt252 =
    0x3704ffe8fba161be0e994951751a5033b1462b918ff785c0a636be718dfdb68;

/// Class hash the anonymizer deploys shadow accounts from, read from the live mainnet
/// deployment via `get_shadow_account_class_hash`. Declared on Sepolia as well as mainnet.
pub const SHADOW_ACCOUNT_CLASS_HASH: felt252 =
    0x346e143e3b353473a0d6f681c31ffcf2866537898008027fb3b57335bad7b5f;

/// `OpenNote.note_id` at slot 9 of the decoded invocation. FINDINGS §6.4.
pub const OBSERVED_NOTE_ID: felt252 =
    0x2eaf46931e13473c9d55554b322394b36e0774d98f21b4abc5741c85a85062f;

/// The `CollectPolicy::Exact` payload at slot 12 — 0.5 STRK. FINDINGS §6.4.
pub const OBSERVED_EXACT_AMOUNT: felt252 = 0x6f05b59d3b20000;

/// The privacy pool on Sepolia, v2.0, named in the official SDK documentation. Its class hash
/// differs from the mainnet pool's, so action encodings must not be assumed identical.
pub const SEPOLIA_POOL: felt252 =
    0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91;

/// Facet's immutable anonymizer, deployed by the Mainnet deployment account on 25 August
/// 2026. The deployment transaction is recorded in `docs/FINDINGS.md` §6.19.
pub const FACET_ANONYMIZER: felt252 =
    0x741fe9dcdf3729919e8c44422fbb963e76a0788f3abad20bb25a50445f363bc;

/// FacetAccount, configured to call `FACET_ANONYMIZER`, deployed on 25 August 2026.
pub const FACET_ACCOUNT: felt252 =
    0x42e9d345c46705408394b7a67e291c2bde9f2638297125a7fec2b5740371a45;

/// Mainnet class hash of Facet's immutable anonymizer.
pub const FACET_ANONYMIZER_CLASS_HASH: felt252 =
    0x85fbf40e535f188b695c1c3b4492c3045de7305c94e2ce7de4d0f9551adb21;

/// Mainnet class hash of FacetAccount.
pub const FACET_ACCOUNT_CLASS_HASH: felt252 =
    0x5d07634600fff340d733946c2c8f925ee4c3c637c33f61e33e187b9024de46d;
