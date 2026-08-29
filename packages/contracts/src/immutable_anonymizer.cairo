//! Facet's immutable fork of the STRK20 shadow-account anonymizer.
//!
//! The upstream anonymizer embeds `ReplaceabilityComponent` and gives its
//! `governance_admin` an immediate implementation-replacement path. Facet does
//! not need that control plane: the class is selected at deployment and this
//! contract contains no upgrade, role, or proxy entrypoint.

use starknet::account::Call;

/// The subset of the deployed shadow-account ABI used by the anonymizer.
///
/// Keeping this interface local avoids coupling the Facet contracts to the
/// upstream package's replaceability and role components. The deployed class
/// accepts the same `execute(Array<Call>)` shape.
#[starknet::interface]
pub trait IFacetShadowAccount<T> {
    fn execute(ref self: T, calls: Array<Call>);
}

#[starknet::contract]
pub mod ImmutableShadowAccountAnonymizer {
    use core::num::traits::{CheckedSub, Zero};
    use openzeppelin::utils::deployments::calculate_contract_address_from_deploy_syscall;
    use starknet::account::Call;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::syscalls::deploy_syscall;
    use starknet::{
        ClassHash, ContractAddress, SyscallResultTrait, get_caller_address, get_contract_address,
    };
    use super::super::anonymizer::{
        CollectPolicy, IShadowAccountAnonymizer, IdentityCommitment, OpenNote, OpenNoteDeposit,
        PartialCommitment, ShadowAccountInfo, commitment_from_partial, errors, partial_commitment,
    };
    use super::super::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use super::{IFacetShadowAccountDispatcher, IFacetShadowAccountDispatcherTrait};

    #[storage]
    struct Storage {
        /// The only caller allowed to drive this anonymizer.
        privacy_contract: ContractAddress,
        /// The shadow-account class deployed at each commitment-derived address.
        shadow_account_class_hash: ClassHash,
        /// Maps a commitment to the account deployed for it.
        shadow_accounts: Map<IdentityCommitment, ContractAddress>,
    }

    #[derive(Serde, Copy, Debug, Drop, PartialEq, starknet::Event)]
    pub struct ShadowAccountDeployed {
        #[key]
        pub identity_commitment: IdentityCommitment,
        #[key]
        pub shadow_account: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        ShadowAccountDeployed: ShadowAccountDeployed,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        privacy_contract: ContractAddress,
        shadow_account_class_hash: ClassHash,
    ) {
        assert(privacy_contract.is_non_zero(), errors::ZERO_ADDRESS);
        assert(shadow_account_class_hash.is_non_zero(), errors::ZERO_ADDRESS);
        self.privacy_contract.write(privacy_contract);
        self.shadow_account_class_hash.write(shadow_account_class_hash);
    }

    #[abi(embed_v0)]
    pub impl ImmutableShadowAccountAnonymizerImpl of IShadowAccountAnonymizer<ContractState> {
        fn privacy_compute(
            self: @ContractState, identity_key: felt252, dapp_name: felt252, nonce: felt252,
        ) -> IdentityCommitment {
            commitment_from_partial(partial_commitment(identity_key, dapp_name), nonce)
        }

        fn privacy_invoke_with_computation(
            ref self: ContractState,
            identity_commitment: IdentityCommitment,
            calls: Array<Call>,
            open_notes: Span<OpenNote>,
        ) -> Span<OpenNoteDeposit> {
            assert(
                get_caller_address() == self.privacy_contract.read(), errors::UNAUTHORIZED_CALLER,
            );
            let shadow_account = self.get_or_deploy_shadow_account(:identity_commitment);
            let note_balance_snapshots = snapshot_open_notes(
                shadow_account: shadow_account.contract_address, :open_notes,
            );
            shadow_account.execute(calls);
            self.collect_open_notes(:shadow_account, :note_balance_snapshots)
        }

        fn get_shadow_accounts(
            self: @ContractState,
            partial_commitment: PartialCommitment,
            start_nonce: u64,
            end_nonce: u64,
            until_undeployed: bool,
        ) -> Span<ShadowAccountInfo> {
            assert(end_nonce >= start_nonce, errors::INVALID_RANGE);
            assert(
                end_nonce - start_nonce <= super::super::anonymizer::MAX_SCAN_RANGE,
                errors::RANGE_TOO_LARGE,
            );
            let class_hash = self.shadow_account_class_hash.read();
            let deployer_address = get_contract_address();
            let mut shadow_accounts: Array<ShadowAccountInfo> = array![];
            for nonce in start_nonce..end_nonce {
                let commitment = commitment_from_partial(partial_commitment, nonce.into());
                let stored = self.shadow_accounts.read(commitment);
                let is_deployed = stored.is_non_zero();
                if until_undeployed && !is_deployed {
                    break;
                }
                let address = if is_deployed {
                    stored
                } else {
                    calculate_contract_address_from_deploy_syscall(
                        salt: commitment,
                        :class_hash,
                        constructor_calldata: array![].span(),
                        :deployer_address,
                    )
                };
                shadow_accounts.append(ShadowAccountInfo { nonce, address, is_deployed });
            }
            shadow_accounts.span()
        }

        fn get_shadow_account(
            self: @ContractState, identity_commitment: IdentityCommitment,
        ) -> ContractAddress {
            self.shadow_accounts.read(identity_commitment)
        }

        fn get_privacy_contract(self: @ContractState) -> ContractAddress {
            self.privacy_contract.read()
        }

        fn get_shadow_account_class_hash(self: @ContractState) -> ClassHash {
            self.shadow_account_class_hash.read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn get_or_deploy_shadow_account(
            ref self: ContractState, identity_commitment: IdentityCommitment,
        ) -> IFacetShadowAccountDispatcher {
            let stored = self.shadow_accounts.read(identity_commitment);
            if stored.is_non_zero() {
                return IFacetShadowAccountDispatcher { contract_address: stored };
            }
            let (shadow_account, _) = deploy_syscall(
                class_hash: self.shadow_account_class_hash.read(),
                contract_address_salt: identity_commitment,
                calldata: array![].span(),
                deploy_from_zero: false,
            )
                .unwrap_syscall();
            assert(shadow_account.is_non_zero(), errors::ZERO_ADDRESS);
            self.shadow_accounts.write(identity_commitment, shadow_account);
            self.emit(ShadowAccountDeployed { identity_commitment, shadow_account });
            IFacetShadowAccountDispatcher { contract_address: shadow_account }
        }

        fn collect_open_notes(
            self: @ContractState,
            shadow_account: IFacetShadowAccountDispatcher,
            note_balance_snapshots: Array<(OpenNote, u256)>,
        ) -> Span<OpenNoteDeposit> {
            let anonymizer = get_contract_address();
            let privacy_contract = self.privacy_contract.read();
            let mut transfer_calls: Array<Call> = array![];
            let mut deposits: Array<OpenNoteDeposit> = array![];

            for (note, pre_balance) in note_balance_snapshots {
                let OpenNote { note_id, token, collect_policy } = note;
                let token_contract = IERC20Dispatcher { contract_address: token };
                let balance = token_contract.balance_of(account: shadow_account.contract_address);
                let collected = match collect_policy {
                    CollectPolicy::All => balance,
                    CollectPolicy::Diff => balance
                        .checked_sub(pre_balance)
                        .expect(errors::NEGATIVE_DIFF),
                    CollectPolicy::Exact(exact) => {
                        assert(balance >= exact.into(), errors::INSUFFICIENT_BALANCE);
                        exact.into()
                    },
                };
                assert(collected.is_non_zero(), errors::ZERO_BALANCE);
                transfer_calls
                    .append(build_transfer_call(:token, recipient: anonymizer, amount: collected));
                token_contract.approve(spender: privacy_contract, amount: collected);
                let amount: u128 = collected.try_into().expect(errors::AMOUNT_OVERFLOW);
                deposits.append(OpenNoteDeposit { note_id, token, amount });
            }

            shadow_account.execute(transfer_calls);
            deposits.span()
        }
    }

    fn snapshot_open_notes(
        shadow_account: ContractAddress, open_notes: Span<OpenNote>,
    ) -> Array<(OpenNote, u256)> {
        let mut snapshots: Array<(OpenNote, u256)> = array![];
        for note in open_notes {
            let pre_balance = match *note.collect_policy {
                CollectPolicy::Diff => IERC20Dispatcher { contract_address: *note.token }
                    .balance_of(account: shadow_account),
                _ => 0,
            };
            snapshots.append((*note, pre_balance));
        }
        snapshots
    }

    fn build_transfer_call(
        token: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> Call {
        let mut calldata = array![recipient.into()];
        amount.serialize(ref calldata);
        Call { to: token, selector: selector!("transfer"), calldata: calldata.span() }
    }
}
