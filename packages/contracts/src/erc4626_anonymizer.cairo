//! Facet's allowlisted ERC-4626 protocol helper.
//!
//! The helper is deliberately bound at construction to one privacy pool, one
//! underlying token, and one vault. It is therefore suitable for both the
//! protocol routes without accepting arbitrary browser
//! calldata. The privacy pool withdraws the underlying token to this helper,
//! the helper calls the real vault, and the resulting shares are approved back
//! to the pool for an open note.

use starknet::ContractAddress;
use super::anonymizer::OpenNoteDeposit;

#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum LendingOperation {
    Deposit,
    Withdraw,
}

#[starknet::interface]
pub trait IERC4626Vault<T> {
    fn deposit(ref self: T, assets: u256, receiver: ContractAddress) -> u256;
    fn redeem(ref self: T, shares: u256, receiver: ContractAddress, owner: ContractAddress) -> u256;
}

#[starknet::interface]
pub trait IFacetErc4626Anonymizer<T> {
    fn privacy_invoke(
        ref self: T,
        operation: LendingOperation,
        in_token: ContractAddress,
        out_token: ContractAddress,
        amount: u256,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;
}

pub mod errors {
    pub const ZERO_PRIVACY_CONTRACT: felt252 = 'ZERO_PRIVACY_CONTRACT';
    pub const ZERO_UNDERLYING: felt252 = 'ZERO_UNDERLYING';
    pub const ZERO_VAULT: felt252 = 'ZERO_VAULT';
    pub const UNAUTHORIZED_CALLER: felt252 = 'UNAUTHORIZED_CALLER';
    pub const INVALID_TOKEN_PAIR: felt252 = 'INVALID_TOKEN_PAIR';
    pub const ZERO_AMOUNT: felt252 = 'ZERO_AMOUNT';
    pub const TOKENS_EQUAL: felt252 = 'TOKENS_EQUAL';
    pub const NEGATIVE_DIFF: felt252 = 'NEGATIVE_DIFF';
    pub const RECEIVED_AMOUNT_OVERFLOW: felt252 = 'RECEIVED_AMOUNT_OVERFLOW';
    pub const ZERO_OUT_AMOUNT: felt252 = 'ZERO_OUT_AMOUNT';
}

#[starknet::contract]
pub mod FacetErc4626Anonymizer {
    use core::num::traits::{CheckedSub, Zero};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use super::super::anonymizer::OpenNoteDeposit;
    use super::super::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use super::{
        IERC4626VaultDispatcher, IERC4626VaultDispatcherTrait, IFacetErc4626Anonymizer,
        LendingOperation, errors,
    };

    #[storage]
    struct Storage {
        privacy_contract: ContractAddress,
        underlying: ContractAddress,
        vault: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        privacy_contract: ContractAddress,
        underlying: ContractAddress,
        vault: ContractAddress,
    ) {
        assert(privacy_contract.is_non_zero(), errors::ZERO_PRIVACY_CONTRACT);
        assert(underlying.is_non_zero(), errors::ZERO_UNDERLYING);
        assert(vault.is_non_zero(), errors::ZERO_VAULT);
        assert(underlying != vault, errors::TOKENS_EQUAL);
        self.privacy_contract.write(privacy_contract);
        self.underlying.write(underlying);
        self.vault.write(vault);
    }

    #[abi(embed_v0)]
    pub impl FacetErc4626AnonymizerImpl of IFacetErc4626Anonymizer<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            operation: LendingOperation,
            in_token: ContractAddress,
            out_token: ContractAddress,
            amount: u256,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            assert(
                get_caller_address() == self.privacy_contract.read(), errors::UNAUTHORIZED_CALLER,
            );
            assert(amount.is_non_zero(), errors::ZERO_AMOUNT);

            let underlying = self.underlying.read();
            let vault = self.vault.read();
            match operation {
                LendingOperation::Deposit => {
                    assert(in_token == underlying, errors::INVALID_TOKEN_PAIR);
                    assert(out_token == vault, errors::INVALID_TOKEN_PAIR);
                },
                LendingOperation::Withdraw => {
                    assert(in_token == vault, errors::INVALID_TOKEN_PAIR);
                    assert(out_token == underlying, errors::INVALID_TOKEN_PAIR);
                },
            }

            let self_addr = get_contract_address();
            let privacy_addr = self.privacy_contract.read();
            let in_erc20 = IERC20Dispatcher { contract_address: in_token };
            let out_erc20 = IERC20Dispatcher { contract_address: out_token };
            let balance_before = out_erc20.balance_of(account: self_addr);

            match operation {
                LendingOperation::Deposit => {
                    in_erc20.approve(spender: vault, amount: amount);
                    IERC4626VaultDispatcher { contract_address: vault }
                        .deposit(assets: amount, receiver: self_addr);
                },
                LendingOperation::Withdraw => {
                    IERC4626VaultDispatcher { contract_address: vault }
                        .redeem(shares: amount, receiver: self_addr, owner: self_addr);
                },
            }

            let balance_after = out_erc20.balance_of(account: self_addr);
            let received = balance_after.checked_sub(balance_before).expect(errors::NEGATIVE_DIFF);
            let output_amount: u128 = received.try_into().expect(errors::RECEIVED_AMOUNT_OVERFLOW);
            assert(output_amount.is_non_zero(), errors::ZERO_OUT_AMOUNT);

            out_erc20.approve(spender: privacy_addr, amount: output_amount.into());
            [OpenNoteDeposit { note_id, token: out_token, amount: output_amount }].span()
        }
    }
}
