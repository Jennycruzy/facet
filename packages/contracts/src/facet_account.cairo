//! Owner-controlled Facet account wrapper.
//!
//! This is the Day 4 account boundary: the owner may submit a bounded batch of
//! calls, and may explicitly drive the configured immutable anonymizer. The
//! anonymizer address is constructor-only; there is no setter or upgrade hook.
//! Signature validation and wallet integration belong to the later universal
//! wallet phase, so this contract deliberately does not pretend to be a full
//! SNIP-6 account yet.

use starknet::ContractAddress;
use starknet::account::Call;
use super::anonymizer::{IdentityCommitment, OpenNote, OpenNoteDeposit};

#[starknet::interface]
pub trait IFacetAccount<T> {
    fn execute(ref self: T, calls: Array<Call>);
    fn invoke_shadow_account(
        ref self: T,
        identity_commitment: IdentityCommitment,
        calls: Array<Call>,
        open_notes: Span<OpenNote>,
    ) -> Span<OpenNoteDeposit>;
    fn get_owner(self: @T) -> ContractAddress;
    fn get_anonymizer(self: @T) -> ContractAddress;
}

#[starknet::contract]
pub mod FacetAccount {
    use core::num::traits::Zero;
    use starknet::account::Call;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::syscalls::call_contract_syscall;
    use starknet::{ContractAddress, SyscallResultTrait, get_caller_address};
    use super::IFacetAccount;
    use super::super::anonymizer::{
        IShadowAccountAnonymizerDispatcher, IShadowAccountAnonymizerDispatcherTrait,
        IdentityCommitment, OpenNote, OpenNoteDeposit,
    };

    pub const UNAUTHORIZED: felt252 = 'UNAUTHORIZED';
    pub const ZERO_ADDRESS: felt252 = 'ZERO_ADDRESS';

    #[storage]
    struct Storage {
        owner: ContractAddress,
        anonymizer: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, anonymizer: ContractAddress) {
        assert(owner.is_non_zero(), ZERO_ADDRESS);
        assert(anonymizer.is_non_zero(), ZERO_ADDRESS);
        self.owner.write(owner);
        self.anonymizer.write(anonymizer);
    }

    #[abi(embed_v0)]
    pub impl FacetAccountImpl of IFacetAccount<ContractState> {
        fn execute(ref self: ContractState, calls: Array<Call>) {
            self.assert_owner();
            for call in calls {
                call_contract_syscall(call.to, call.selector, call.calldata).unwrap_syscall();
            }
        }

        fn invoke_shadow_account(
            ref self: ContractState,
            identity_commitment: IdentityCommitment,
            calls: Array<Call>,
            open_notes: Span<OpenNote>,
        ) -> Span<OpenNoteDeposit> {
            self.assert_owner();
            let anonymizer = IShadowAccountAnonymizerDispatcher {
                contract_address: self.anonymizer.read(),
            };
            anonymizer.privacy_invoke_with_computation(identity_commitment, calls, open_notes)
        }

        fn get_owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
        }

        fn get_anonymizer(self: @ContractState) -> ContractAddress {
            self.anonymizer.read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn assert_owner(self: @ContractState) {
            assert(get_caller_address() == self.owner.read(), UNAUTHORIZED);
        }
    }
}
