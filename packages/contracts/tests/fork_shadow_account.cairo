//! Fork tests against the live mainnet shadow account anonymizer.
//!
//! These run the real deployed bytecode at a pinned mainnet block, so every assertion here is a
//! statement about the contract users actually interact with, not about a local redeployment.
//! They cost nothing and require no key.
//!
//! What they are for: `docs/FINDINGS.md` §6.6 reasons about a withdraw-then-invoke sequence that
//! has never executed on chain. The reasoning rests on three facts — a withdrawal may target any
//! address, the shadow account address is computable before deployment, and withdraw precedes
//! invoke. The middle two are exercised directly below by pre-funding a predicted address and then
//! invoking. The proof-system half of the sequence cannot be reproduced in a test; the anonymizer
//! half can, and is.

use facet_contracts::anonymizer::{
    CollectPolicy, IShadowAccountAnonymizerDispatcher, IShadowAccountAnonymizerDispatcherTrait,
    OpenNote, commitment_from_partial, compute_identity_key, partial_commitment,
};
use facet_contracts::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
use facet_contracts::mainnet::{
    ANONYMIZER, OBSERVED_BALANCE_OF_SELECTOR, OBSERVED_COMMITMENT, OBSERVED_SHADOW_ACCOUNT,
    OBSERVED_TRANSFER_FROM_SELECTOR, POOL, STRK,
};
use snforge_std::{start_cheat_caller_address, stop_cheat_caller_address};
use starknet::account::Call;
use starknet::{ContractAddress, get_contract_address};

const ONE_STRK: u256 = 1000000000000000000;

/// A destination for tokens the tests move out of a shadow account. Any address will do; it only
/// has to be distinct from the participants.
const SINK: felt252 = 0x5171c;

fn addr(value: felt252) -> ContractAddress {
    value.try_into().unwrap()
}

fn anonymizer() -> IShadowAccountAnonymizerDispatcher {
    IShadowAccountAnonymizerDispatcher { contract_address: addr(ANONYMIZER) }
}

fn strk() -> IERC20Dispatcher {
    IERC20Dispatcher { contract_address: addr(STRK) }
}

/// A fresh identity, scoped by `seed` so tests never collide on a commitment.
fn fresh_identity(seed: felt252) -> (felt252, felt252) {
    let identity_key = compute_identity_key(
        user_addr: get_contract_address(),
        user_private_key: seed,
        contract_address: addr(ANONYMIZER),
    );
    let partial = partial_commitment(identity_key, 'facet_fork_test');
    (partial, commitment_from_partial(partial, 0))
}

/// Moves STRK to `recipient` by impersonating the pool — the same source the real `Withdraw` leg
/// pays from, so the funding step under test matches the one the product would perform.
fn fund_from_pool(recipient: ContractAddress, amount: u256) {
    let strk = strk();
    assert!(strk.balance_of(addr(POOL)) >= amount, "pool STRK balance too low to fund the test");
    start_cheat_caller_address(strk.contract_address, addr(POOL));
    strk.transfer(recipient, amount);
    stop_cheat_caller_address(strk.contract_address);
}

fn transfer_call(token: ContractAddress, recipient: ContractAddress, amount: u256) -> Call {
    Call {
        to: token,
        selector: selector!("transfer"),
        calldata: array![recipient.into(), amount.low.into(), amount.high.into()].span(),
    }
}

/// The address nonce 0 of `partial` resolves to, plus whether it is already deployed.
fn predicted_account(partial: felt252) -> (ContractAddress, bool) {
    let infos = anonymizer().get_shadow_accounts(partial, 0, 1, false);
    let info = *infos.at(0);
    (info.address, info.is_deployed)
}

// ---------------------------------------------------------------------------------------------
// Decode checks — no chain state needed, these confirm the selector attribution in FINDINGS
// §6.5.
// ---------------------------------------------------------------------------------------------

#[test]
fn decoded_selectors_match_their_entrypoint_names() {
    assert_eq!(selector!("balance_of"), OBSERVED_BALANCE_OF_SELECTOR);
    assert_eq!(selector!("transfer_from"), OBSERVED_TRANSFER_FROM_SELECTOR);
}

// ---------------------------------------------------------------------------------------------
// Live state — what the deployed anonymizer says about itself.
// ---------------------------------------------------------------------------------------------

#[test]
#[fork("MAINNET")]
fn anonymizer_is_wired_to_the_privacy_pool() {
    assert_eq!(anonymizer().get_privacy_contract(), addr(POOL));
}

#[test]
#[fork("MAINNET")]
fn observed_commitment_resolves_to_the_observed_shadow_account() {
    assert_eq!(anonymizer().get_shadow_account(OBSERVED_COMMITMENT), addr(OBSERVED_SHADOW_ACCOUNT));
}

/// The two commitment stages can be derived off-chain, which is what account discovery depends on.
#[test]
#[fork("MAINNET")]
fn on_chain_privacy_compute_matches_local_derivation() {
    let identity_key = compute_identity_key(
        user_addr: addr(0x1234), user_private_key: 0xbeef, contract_address: addr(ANONYMIZER),
    );
    let on_chain = anonymizer().privacy_compute(identity_key, 'facet', 7);
    let local = commitment_from_partial(partial_commitment(identity_key, 'facet'), 7);
    assert_eq!(on_chain, local);
}

/// An undeployed nonce still resolves to an address — the precondition for funding before
/// deploying.
#[test]
#[fork("MAINNET")]
fn undeployed_nonces_resolve_to_a_nonzero_predicted_address() {
    let (partial, _) = fresh_identity('predict');
    let (address, is_deployed) = predicted_account(partial);
    assert!(!is_deployed, "a fresh commitment should not be deployed");
    assert!(address != addr(0), "predicted address must be non-zero");
}

#[test]
#[fork("MAINNET")]
#[should_panic]
fn invoke_rejects_callers_other_than_the_privacy_contract() {
    let (_, commitment) = fresh_identity('unauthorized');
    anonymizer().privacy_invoke_with_computation(commitment, array![], array![].span());
}

// ---------------------------------------------------------------------------------------------
// The core pattern: fund a predicted address, then invoke.
// ---------------------------------------------------------------------------------------------

/// FINDINGS §6.6, minus the proved execution: tokens sent to an address that does not yet hold
/// code are picked up by the shadow account that later deploys there, and settle into an open note.
#[test]
#[fork("MAINNET")]
fn prefunded_predicted_address_deploys_and_collects() {
    let anonymizer = anonymizer();
    let strk = strk();
    let (partial, commitment) = fresh_identity('prefund');

    let (predicted, is_deployed) = predicted_account(partial);
    assert!(!is_deployed, "expected an undeployed commitment");
    assert_eq!(anonymizer.get_shadow_account(commitment), addr(0));

    // The withdraw leg: funds arrive before any code exists at the address.
    fund_from_pool(predicted, ONE_STRK);
    assert_eq!(strk.balance_of(predicted), ONE_STRK);

    // The invoke leg: an empty call array deploys the account and settles the balance.
    let note = OpenNote {
        note_id: 'facet_note_prefund', token: addr(STRK), collect_policy: CollectPolicy::All,
    };
    start_cheat_caller_address(anonymizer.contract_address, addr(POOL));
    let deposits = anonymizer
        .privacy_invoke_with_computation(commitment, array![], array![note].span());
    stop_cheat_caller_address(anonymizer.contract_address);

    // The account deployed exactly where the prediction said it would.
    assert_eq!(anonymizer.get_shadow_account(commitment), predicted);

    assert_eq!(deposits.len(), 1);
    let deposit = *deposits.at(0);
    assert_eq!(deposit.note_id, 'facet_note_prefund');
    assert_eq!(deposit.token, addr(STRK));
    assert_eq!(deposit.amount, ONE_STRK.low);

    // Funds end up in the anonymizer, approved for the pool to pull into the note.
    assert_eq!(strk.balance_of(predicted), 0);
    assert_eq!(strk.allowance(anonymizer.contract_address, addr(POOL)), ONE_STRK);
}

/// FINDINGS §6.10(a): one invoke action carries many calls, so a multi-step dapp flow fits in a
/// single transaction. Verified here against live code rather than the upstream test harness.
#[test]
#[fork("MAINNET")]
fn one_invoke_runs_several_calls_as_the_shadow_account() {
    let anonymizer = anonymizer();
    let strk = strk();
    let (partial, commitment) = fresh_identity('multicall');
    let (predicted, _) = predicted_account(partial);

    fund_from_pool(predicted, ONE_STRK * 2);

    let half = ONE_STRK / 2;
    let calls = array![
        transfer_call(addr(STRK), addr(SINK), half), transfer_call(addr(STRK), addr(SINK), half),
    ];
    let note = OpenNote {
        note_id: 'facet_note_multi', token: addr(STRK), collect_policy: CollectPolicy::All,
    };

    let sink_before = strk.balance_of(addr(SINK));
    start_cheat_caller_address(anonymizer.contract_address, addr(POOL));
    let deposits = anonymizer
        .privacy_invoke_with_computation(commitment, calls, array![note].span());
    stop_cheat_caller_address(anonymizer.contract_address);

    // Both calls ran: the sink gained exactly two halves, and the remainder settled to the note.
    assert_eq!(strk.balance_of(addr(SINK)) - sink_before, ONE_STRK);
    assert_eq!(*deposits.at(0).amount, ONE_STRK.low);
}

/// The stranded-funds question, part one (FINDINGS §6.10(c) — untested upstream).
///
/// A dapp call the shadow account cannot satisfy takes the whole invoke down. The pool applies the
/// action with `call_contract_syscall(...).unwrap_syscall()` (`privacy.cairo:982-985`), so the
/// panic propagates out of `apply_actions` and the `Withdraw` in the same transaction reverts with
/// it. In the single-transaction pattern of §6.6 there is therefore nothing to strand: either the
/// funds arrive and are spent, or the note is never used.
#[test]
#[fork("MAINNET")]
#[should_panic]
fn a_reverting_dapp_call_reverts_the_whole_invoke() {
    let anonymizer = anonymizer();
    let (partial, commitment) = fresh_identity('revert');
    let (predicted, _) = predicted_account(partial);

    fund_from_pool(predicted, ONE_STRK);

    let doomed = array![transfer_call(addr(STRK), addr(SINK), ONE_STRK * 10)];
    let note = OpenNote {
        note_id: 'facet_note_revert', token: addr(STRK), collect_policy: CollectPolicy::All,
    };

    start_cheat_caller_address(anonymizer.contract_address, addr(POOL));
    anonymizer.privacy_invoke_with_computation(commitment, doomed, array![note].span());
}

/// The stranded-funds question, part two: the case that *can* strand funds is funding and invoking
/// in **separate** transactions. This shows the exposure is recoverable — a shadow account that
/// has already been deployed and emptied still sweeps a later top-up, because the commitment
/// resolves to the same address forever.
#[test]
#[fork("MAINNET")]
fn an_already_deployed_account_sweeps_a_later_top_up() {
    let anonymizer = anonymizer();
    let strk = strk();
    let (partial, commitment) = fresh_identity('topup');
    let (predicted, _) = predicted_account(partial);

    // First interaction: deploy and empty it.
    fund_from_pool(predicted, ONE_STRK);
    let first = OpenNote {
        note_id: 'facet_note_first', token: addr(STRK), collect_policy: CollectPolicy::All,
    };
    start_cheat_caller_address(anonymizer.contract_address, addr(POOL));
    anonymizer.privacy_invoke_with_computation(commitment, array![], array![first].span());

    assert_eq!(anonymizer.get_shadow_account(commitment), predicted);
    assert_eq!(strk.balance_of(predicted), 0);

    // Second, separate funding of the same facet: no redeploy, and the balance still settles.
    fund_from_pool(predicted, ONE_STRK * 3);
    let second = OpenNote {
        note_id: 'facet_note_second', token: addr(STRK), collect_policy: CollectPolicy::All,
    };
    let deposits = anonymizer
        .privacy_invoke_with_computation(commitment, array![], array![second].span());
    stop_cheat_caller_address(anonymizer.contract_address);

    assert_eq!(*deposits.at(0).amount, (ONE_STRK * 3).low);
    assert_eq!(strk.balance_of(predicted), 0);
}
