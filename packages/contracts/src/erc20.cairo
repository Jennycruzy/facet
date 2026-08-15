//! Minimal ERC20 binding — only the entrypoints the fork tests exercise.
//!
//! Declared locally rather than pulled from OpenZeppelin so this package stays dependency-light.
//! STRK on mainnet exposes both the snake_case and camelCase entrypoints; the snake_case
//! `balance_of` selector is the one observed in the decoded mainnet invocations.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IERC20<T> {
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn allowance(self: @T, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: T, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
}
