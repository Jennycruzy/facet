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
