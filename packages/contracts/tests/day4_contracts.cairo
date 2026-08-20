//! Day 4 contract checks.
//!
//! These tests pin the security boundary introduced by the local contracts:
//! the anonymizer has constructor-only configuration, while FacetAccount is
//! owner-gated. The fork test compares the immutable fork's commitment logic
//! with the deployed upstream anonymizer.

use facet_contracts::anonymizer::{
    IShadowAccountAnonymizerDispatcher, IShadowAccountAnonymizerDispatcherTrait,
};
use facet_contracts::facet_account::{IFacetAccountDispatcher, IFacetAccountDispatcherTrait};
use facet_contracts::anonymizer::partial_commitment;
use facet_contracts::mainnet::{ANONYMIZER, POOL};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::{ClassHash, ContractAddress, SyscallResultTrait};

const OWNER: felt252 = 'DAY4_OWNER';
const PRIVACY: felt252 = 'DAY4_PRIVACY';

fn addr(value: felt252) -> ContractAddress {
    value.try_into().unwrap()
}

fn declare_class(name: ByteArray) -> ClassHash {
    *declare(name).unwrap_syscall().contract_class().class_hash
}

fn deploy_immutable(
    privacy_contract: ContractAddress, shadow_account_class_hash: ClassHash,
) -> ContractAddress {
    let class = declare("ImmutableShadowAccountAnonymizer").unwrap_syscall().contract_class();
    let (address, _) = class
        .deploy(@array![privacy_contract.into(), shadow_account_class_hash.into()])
        .unwrap_syscall();
    address
}

fn deploy_account(owner: ContractAddress, anonymizer: ContractAddress) -> ContractAddress {
    let class = declare("FacetAccount").unwrap_syscall().contract_class();
    let (address, _) = class.deploy(@array![owner.into(), anonymizer.into()]).unwrap_syscall();
    address
}

#[test]
fn immutable_anonymizer_has_constructor_only_configuration() {
    let class_hash = declare_class("FacetAccount");
    let anonymizer = deploy_immutable(addr(PRIVACY), class_hash);
    let dispatcher = IShadowAccountAnonymizerDispatcher { contract_address: anonymizer };

    assert_eq!(dispatcher.get_privacy_contract(), addr(PRIVACY));
    assert_eq!(dispatcher.get_shadow_account_class_hash(), class_hash);
    assert_eq!(dispatcher.get_shadow_account('never_deployed'), addr(0));
}

#[test]
fn immutable_anonymizer_preserves_deterministic_commitments() {
    let class_hash = declare_class("FacetAccount");
    let anonymizer = deploy_immutable(addr(PRIVACY), class_hash);
    let dispatcher = IShadowAccountAnonymizerDispatcher { contract_address: anonymizer };

    let commitment = dispatcher.privacy_compute('identity', 'ekubo', 4);
    let accounts = dispatcher.get_shadow_accounts(partial_commitment('identity', 'ekubo'), 0, 1, false);
    assert_eq!(commitment, dispatcher.privacy_compute('identity', 'ekubo', 4));
    assert_eq!(accounts.len(), 1);
    let account = *accounts.at(0);
    assert!(!account.is_deployed);
    assert!(account.address != addr(0));
}

#[test]
#[should_panic]
fn immutable_anonymizer_rejects_non_privacy_callers() {
    let class_hash = declare_class("FacetAccount");
    let anonymizer = deploy_immutable(addr(PRIVACY), class_hash);
    let dispatcher = IShadowAccountAnonymizerDispatcher { contract_address: anonymizer };
    dispatcher.privacy_invoke_with_computation('unauthorized', array![], array![].span());
}

#[test]
fn facet_account_binds_owner_and_anonymizer_once() {
    let account = deploy_account(addr(OWNER), addr('DAY4_ANONYMIZER'));
    let dispatcher = IFacetAccountDispatcher { contract_address: account };
    assert_eq!(dispatcher.get_owner(), addr(OWNER));
    assert_eq!(dispatcher.get_anonymizer(), addr('DAY4_ANONYMIZER'));

    start_cheat_caller_address(account, addr(OWNER));
    dispatcher.execute(array![]);
    stop_cheat_caller_address(account);
}

#[test]
#[should_panic]
fn facet_account_rejects_non_owner_execution() {
    let account = deploy_account(addr(OWNER), addr('DAY4_ANONYMIZER'));
    let dispatcher = IFacetAccountDispatcher { contract_address: account };
    dispatcher.execute(array![]);
}

#[test]
#[fork("MAINNET")]
fn immutable_fork_matches_live_commitment_logic() {
    let class_hash = declare_class("FacetAccount");
    let forked = deploy_immutable(addr(POOL), class_hash);
    let local = IShadowAccountAnonymizerDispatcher { contract_address: forked };
    let live = IShadowAccountAnonymizerDispatcher { contract_address: addr(ANONYMIZER) };

    assert_eq!(local.get_privacy_contract(), live.get_privacy_contract());
    assert_eq!(
        local.privacy_compute('fork_identity', 'facet', 9),
        live.privacy_compute('fork_identity', 'facet', 9),
    );
}
