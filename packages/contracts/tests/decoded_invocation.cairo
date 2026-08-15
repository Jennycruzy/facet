//! Replays the exact calldata of the decoded mainnet invocation, `FINDINGS.md` §6.4.
//!
//! §6.4 was reconstructed by reading raw calldata against the source Serde layouts, never traced —
//! `starknet_traceTransaction` is unavailable on the public endpoints. This file settles it by
//! feeding the eleven felts back to the real anonymizer bytecode through
//! `call_contract_syscall`, with no typed dispatcher in between. A dispatcher would serialise the
//! arguments itself and prove nothing about the layout; a raw syscall only succeeds if the felts
//! deserialise exactly as §6.4 claims they do.
//!
//! The caller check is satisfied without a proof by deploying a *fresh* anonymizer from the
//! on-chain class hash and naming this test contract as its privacy contract. That is the same
//! escape hatch a self-deployed anonymizer gives Facet in production, and it is what makes this
//! question answerable at zero cost.

use facet_contracts::anonymizer::{
    IShadowAccountAnonymizerDispatcher, IShadowAccountAnonymizerDispatcherTrait, OpenNoteDeposit,
};
use facet_contracts::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
use facet_contracts::mainnet::{
    OBSERVED_BALANCE_OF_SELECTOR, OBSERVED_COMMITMENT, OBSERVED_EXACT_AMOUNT, OBSERVED_NOTE_ID,
    OBSERVED_SHADOW_ACCOUNT, POOL, SEPOLIA_POOL, SHADOW_ACCOUNT_CLASS_HASH, STRK,
};
use snforge_std::{start_cheat_caller_address, stop_cheat_caller_address};
use starknet::syscalls::{call_contract_syscall, deploy_syscall};
use starknet::{ContractAddress, SyscallResultTrait, get_contract_address};

fn addr(value: felt252) -> ContractAddress {
    value.try_into().unwrap()
}

/// Deploys a fresh anonymizer from the class hash already declared on chain, with this test
/// contract as the privacy contract so raw calls from here pass `UNAUTHORIZED_CALLER`.
fn deploy_anonymizer() -> IShadowAccountAnonymizerDispatcher {
    let calldata = array![
        get_contract_address().into(), SHADOW_ACCOUNT_CLASS_HASH, get_contract_address().into(),
    ];
    let (address, _) = deploy_syscall(
        SHADOW_ACCOUNT_ANONYMIZER_CLASS_HASH.try_into().unwrap(),
        'facet_decode_replay',
        calldata.span(),
        false,
    )
        .unwrap_syscall();
    IShadowAccountAnonymizerDispatcher { contract_address: address }
}

/// FINDINGS §6.1 — the class the live mainnet anonymizer runs.
const SHADOW_ACCOUNT_ANONYMIZER_CLASS_HASH: felt252 =
    0x7ffaf4f427c8de0ca35d32d44d97a31da3c24641e32b72f340660d5b9e7f5e6;

/// Moves STRK by impersonating a known holder — the network's pool, which holds a large balance on
/// both chains. STRK sits at the same address on mainnet and Sepolia.
fn fund_from(source: felt252, recipient: ContractAddress, amount: u256) {
    let strk = IERC20Dispatcher { contract_address: addr(STRK) };
    assert!(strk.balance_of(addr(source)) >= amount, "funding source balance too low");
    start_cheat_caller_address(strk.contract_address, addr(source));
    strk.transfer(recipient, amount);
    stop_cheat_caller_address(strk.contract_address);
}

/// The replay itself, run against whichever chain's state the caller forked. Returns the shadow
/// account it materialised so the assertions can inspect it.
fn replay_observed_payload(funding_source: felt252) -> (ContractAddress, ContractAddress) {
    let anonymizer = deploy_anonymizer();
    let strk = IERC20Dispatcher { contract_address: addr(STRK) };

    // §6.4 targets an account that already exists, so materialise it the cheap way first.
    anonymizer.privacy_invoke_with_computation(OBSERVED_COMMITMENT, array![], array![].span());
    let shadow_account = anonymizer.get_shadow_account(OBSERVED_COMMITMENT);
    assert!(shadow_account != addr(0), "expected the account to be deployed");

    // `CollectPolicy::Exact` settles a fixed amount, so the balance has to be there to collect.
    let exact: u256 = OBSERVED_EXACT_AMOUNT.into();
    fund_from(funding_source, shadow_account, exact);

    let mut returned = call_contract_syscall(
        anonymizer.contract_address,
        selector!("privacy_invoke_with_computation"),
        observed_calldata().span(),
    )
        .unwrap_syscall();

    // It deserialised. Now confirm it did so as the *intended* arguments, by checking the effects
    // those arguments describe rather than trusting that it merely did not revert.
    let deposits: Span<OpenNoteDeposit> = Serde::deserialize(ref returned)
        .expect('return did not decode');
    assert_eq!(deposits.len(), 1);
    let deposit = *deposits.at(0);
    assert_eq!(deposit.note_id, OBSERVED_NOTE_ID, "slot 9 is not note_id");
    assert_eq!(deposit.token, addr(STRK), "slot 10 is not the token");
    assert_eq!(
        deposit.amount, OBSERVED_EXACT_AMOUNT.try_into().unwrap(), "slot 12 is not the amount",
    );

    // `Exact` collected exactly what slot 12 asked for, and approved the privacy contract for it.
    assert_eq!(strk.balance_of(shadow_account), 0);
    assert_eq!(strk.allowance(anonymizer.contract_address, get_contract_address()), exact);

    (anonymizer.contract_address, shadow_account)
}

/// Slots 2 through 12 of the `ServerAction::InvokeWithComputation` payload, verbatim from the
/// §6.4 table. The eleven felts here are the entire argument list of
/// `privacy_invoke_with_computation`, which is what slot 1 (`0xb`) counts.
fn observed_calldata() -> Array<felt252> {
    array![
        OBSERVED_COMMITMENT, // slot 2  — identity_commitment
        0x1, // slot 3  — calls.len
        STRK, // slot 4  — Call.to
        OBSERVED_BALANCE_OF_SELECTOR, // slot 5  — Call.selector
        0x1, // slot 6  — Call.calldata.len
        OBSERVED_SHADOW_ACCOUNT, // slot 7  — Call.calldata[0]
        0x1, // slot 8  — open_notes.len
        OBSERVED_NOTE_ID, // slot 9  — OpenNote.note_id
        STRK, // slot 10 — OpenNote.token
        0x2, // slot 11 — CollectPolicy::Exact
        OBSERVED_EXACT_AMOUNT // slot 12 — 0.5 STRK
    ]
}

/// The felt count declared at slot 1 must equal the number of felts that follow it.
#[test]
fn observed_calldata_length_matches_slot_1() {
    assert_eq!(observed_calldata().len(), 0xb);
}

/// The decoded payload, replayed against real anonymizer bytecode with no dispatcher in between.
#[test]
#[fork("MAINNET")]
fn decoded_payload_deserialises_and_executes() {
    replay_observed_payload(POOL);
}

/// The same replay against Sepolia state. Sepolia carries the same two class hashes, so this is a
/// dry run of the live transaction — if the deployment or the payload were going to fail there for
/// a chain-specific reason, it fails here first, for free.
#[test]
#[fork("SEPOLIA")]
fn decoded_payload_replays_on_sepolia() {
    let (anonymizer, shadow_account) = replay_observed_payload(SEPOLIA_POOL);
    assert!(anonymizer != addr(0), "anonymizer should have deployed on sepolia");
    assert!(shadow_account != addr(0), "shadow account should have deployed on sepolia");
}

/// Slot 11 really is the `CollectPolicy` discriminant: replacing `0x2` with `0x0` turns the trailing
/// felt into a stray argument, and the payload no longer deserialises to the same call.
///
/// This is the control. Without it, a payload that happened to execute for unrelated reasons would
/// look like a confirmed decode.
#[test]
#[fork("MAINNET")]
#[should_panic]
fn shifting_the_collect_policy_discriminant_breaks_the_decode() {
    let anonymizer = deploy_anonymizer();
    anonymizer.privacy_invoke_with_computation(OBSERVED_COMMITMENT, array![], array![].span());
    let shadow_account = anonymizer.get_shadow_account(OBSERVED_COMMITMENT);
    fund_from(POOL, shadow_account, OBSERVED_EXACT_AMOUNT.into());

    let mut corrupted = observed_calldata();
    let mut rebuilt = array![];
    let mut i = 0;
    while i < corrupted.len() {
        // Swap `Exact` (2) for `All` (0) and leave the amount felt trailing behind it.
        rebuilt.append(if i == 9 {
            0x0
        } else {
            *corrupted.at(i)
        });
        i += 1;
    }

    call_contract_syscall(
        anonymizer.contract_address,
        selector!("privacy_invoke_with_computation"),
        rebuilt.span(),
    )
        .unwrap_syscall();
}
