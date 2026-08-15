#!/usr/bin/env bash
#
# Replays the decoded invocation of FINDINGS.md §6.4 as a live Sepolia transaction.
#
# The fork test `decoded_invocation::decoded_payload_replays_on_sepolia` already runs this exact
# sequence against Sepolia state for free. This script is the on-chain confirmation: same class
# hashes, same eleven felts, real fees, a transaction hash anyone can check.
#
# It deploys its own anonymizer naming the caller as the privacy contract, which is what lets the
# payload through the caller check without a proving service. No official Sepolia anonymizer is
# involved, and none appears to exist.
#
# Requires: SEPOLIA_ACCOUNT_ADDRESS, SEPOLIA_PRIVATE_KEY, and roughly 2 STRK on Sepolia — 0.5 to
# collect plus fees. Get it from a faucet; nothing here needs mainnet funds.

set -euo pipefail

RPC="https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10"
ACCOUNT_NAME="facet-sepolia"

ANONYMIZER_CLASS_HASH=0x7ffaf4f427c8de0ca35d32d44d97a31da3c24641e32b72f340660d5b9e7f5e6
SHADOW_ACCOUNT_CLASS_HASH=0x346e143e3b353473a0d6f681c31ffcf2866537898008027fb3b57335bad7b5f
STRK=0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d

# The observed values, verbatim from the §6.4 table.
OBSERVED_COMMITMENT=0x666db4d657c2da624db34bb82e21f0dd702054d93c771a949e41508f93ffb1c
OBSERVED_BALANCE_OF_SELECTOR=0x35a73cd311a05d46deda634c5ee045db92f811b4e74bca4437fcb5302b7af33
OBSERVED_SHADOW_ACCOUNT=0x344e658822ac3b5a48e69dbdd5a428d5298c4d3924ffa0b2e8b367554896e4
OBSERVED_NOTE_ID=0x2eaf46931e13473c9d55554b322394b36e0774d98f21b4abc5741c85a85062f
OBSERVED_EXACT_AMOUNT=0x6f05b59d3b20000

: "${SEPOLIA_ACCOUNT_ADDRESS:?set SEPOLIA_ACCOUNT_ADDRESS}"
: "${SEPOLIA_PRIVATE_KEY:?set SEPOLIA_PRIVATE_KEY}"

sncast() { command sncast --json "$@"; }

echo "==> importing the account"
sncast account import \
  --name "$ACCOUNT_NAME" \
  --address "$SEPOLIA_ACCOUNT_ADDRESS" \
  --private-key "$SEPOLIA_PRIVATE_KEY" \
  --type oz \
  --url "$RPC" \
  --silent || echo "(already imported)"

echo "==> deploying an anonymizer with this account as its privacy contract"
# constructor(privacy_contract, shadow_account_class_hash, governance_admin)
DEPLOY=$(sncast --account "$ACCOUNT_NAME" deploy \
  --url "$RPC" \
  --class-hash "$ANONYMIZER_CLASS_HASH" \
  --constructor-calldata "$SEPOLIA_ACCOUNT_ADDRESS" "$SHADOW_ACCOUNT_CLASS_HASH" "$SEPOLIA_ACCOUNT_ADDRESS" \
  --salt 0x666163657430)
echo "$DEPLOY"
ANONYMIZER=$(echo "$DEPLOY" | python3 -c 'import json,sys; print(json.load(sys.stdin)["contract_address"])')
echo "    anonymizer: $ANONYMIZER"

echo "==> materialising the shadow account (empty calls, empty notes)"
sncast --account "$ACCOUNT_NAME" invoke \
  --url "$RPC" \
  --contract-address "$ANONYMIZER" \
  --function privacy_invoke_with_computation \
  --calldata "$OBSERVED_COMMITMENT" 0x0 0x0

SHADOW=$(sncast call \
  --url "$RPC" \
  --contract-address "$ANONYMIZER" \
  --function get_shadow_account \
  --arguments "$OBSERVED_COMMITMENT" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["response_raw"][0])')
echo "    shadow account: $SHADOW"

echo "==> funding it with the 0.5 STRK that slot 12 asks to collect"
sncast --account "$ACCOUNT_NAME" invoke \
  --url "$RPC" \
  --contract-address "$STRK" \
  --function transfer \
  --calldata "$SHADOW" "$OBSERVED_EXACT_AMOUNT" 0x0

echo "==> replaying the eleven felts of §6.4"
sncast --account "$ACCOUNT_NAME" invoke \
  --url "$RPC" \
  --contract-address "$ANONYMIZER" \
  --function privacy_invoke_with_computation \
  --calldata \
    "$OBSERVED_COMMITMENT" \
    0x1 \
    "$STRK" \
    "$OBSERVED_BALANCE_OF_SELECTOR" \
    0x1 \
    "$OBSERVED_SHADOW_ACCOUNT" \
    0x1 \
    "$OBSERVED_NOTE_ID" \
    "$STRK" \
    0x2 \
    "$OBSERVED_EXACT_AMOUNT"

echo
echo "Record the final transaction hash in FINDINGS.md §6.4 and, if it is kept, strk20.json."
