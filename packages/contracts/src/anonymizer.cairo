//! Local bindings for the deployed shadow account anonymizer.
//!
//! These mirror `starkware-libs/starknet-privacy`
//! `packages/shadow_account_anonymizer/src/shadow_account_anonymizer.cairo` so tests can talk to
//! the live mainnet deployment without pulling the upstream workspace and its Ekubo and Vesu
//! dependencies. Entrypoint selectors derive from function names and the structs below reproduce
//! the upstream Serde layouts, so the ABI matches by construction.

use core::hash::HashStateTrait;
use core::poseidon::{PoseidonTrait, poseidon_hash_span};
use starknet::account::Call;
use starknet::{ClassHash, ContractAddress};

/// Identifies a single shadow account: `hash(hash(identity_key, dapp_name), nonce)`.
pub type IdentityCommitment = felt252;

/// The nonce-independent half of an identity commitment, `hash(identity_key, dapp_name)`.
pub type PartialCommitment = felt252;

/// Domain-separation tag for `identity_key`, from `privacy::hashes::domain_separation`.
pub const IDENTITY_KEY_TAG: felt252 = 'IDENTITY_KEY_TAG:V1';

/// Upper bound on the nonce range a single `get_shadow_accounts` call may resolve.
pub const MAX_SCAN_RANGE: u64 = 1024;

pub mod errors {
    pub const UNAUTHORIZED_CALLER: felt252 = 'UNAUTHORIZED_CALLER';
    pub const ZERO_BALANCE: felt252 = 'ZERO_BALANCE';
    pub const NEGATIVE_DIFF: felt252 = 'NEGATIVE_DIFF';
    pub const INSUFFICIENT_BALANCE: felt252 = 'INSUFFICIENT_BALANCE';
    pub const AMOUNT_OVERFLOW: felt252 = 'AMOUNT_OVERFLOW';
    pub const RANGE_TOO_LARGE: felt252 = 'RANGE_TOO_LARGE';
    pub const INVALID_RANGE: felt252 = 'INVALID_RANGE';
    pub const ZERO_ADDRESS: felt252 = 'ZERO_ADDRESS';
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct ShadowAccountInfo {
    pub nonce: u64,
    pub address: ContractAddress,
    pub is_deployed: bool,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum CollectPolicy {
    /// Collect the shadow account's entire `token` balance.
    All,
    /// Collect only the balance gained during this interaction.
    Diff,
    /// Collect this exact amount.
    Exact: u128,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNote {
    pub note_id: felt252,
    pub token: ContractAddress,
    /// Pass at most one note per token: a second approval overwrites the first.
    pub collect_policy: CollectPolicy,
}

/// `privacy::objects::OpenNoteDeposit` — one per settled note, returned to the privacy contract.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

#[starknet::interface]
pub trait IShadowAccountAnonymizer<T> {
    fn privacy_compute(
        self: @T, identity_key: felt252, dapp_name: felt252, nonce: felt252,
    ) -> IdentityCommitment;
    fn privacy_invoke_with_computation(
        ref self: T,
        identity_commitment: IdentityCommitment,
        calls: Array<Call>,
        open_notes: Span<OpenNote>,
    ) -> Span<OpenNoteDeposit>;
    fn get_shadow_accounts(
        self: @T,
        partial_commitment: PartialCommitment,
        start_nonce: u64,
        end_nonce: u64,
        until_undeployed: bool,
    ) -> Span<ShadowAccountInfo>;
    fn get_shadow_account(self: @T, identity_commitment: IdentityCommitment) -> ContractAddress;
    fn get_privacy_contract(self: @T) -> ContractAddress;
    fn get_shadow_account_class_hash(self: @T) -> ClassHash;
}

/// `h(IDENTITY_KEY_TAG, user_addr, user_private_key, contract_address)`, the value the pool derives
/// inside the proved execution and forwards as calldata slot 0.
///
/// Note the construction differs from the two commitment stages below: this one is a
/// `poseidon_hash_span` over four felts, they are chained `PoseidonTrait` updates.
pub fn compute_identity_key(
    user_addr: ContractAddress, user_private_key: felt252, contract_address: ContractAddress,
) -> felt252 {
    poseidon_hash_span(
        [IDENTITY_KEY_TAG, user_addr.into(), user_private_key, contract_address.into()].span(),
    )
}

/// `hash(identity_key, dapp_name)`.
pub fn partial_commitment(identity_key: felt252, dapp_name: felt252) -> PartialCommitment {
    PoseidonTrait::new().update(identity_key).update(dapp_name).finalize()
}

/// `hash(partial_commitment, nonce)`.
pub fn commitment_from_partial(
    partial_commitment: PartialCommitment, nonce: felt252,
) -> IdentityCommitment {
    PoseidonTrait::new().update(partial_commitment).update(nonce).finalize()
}
