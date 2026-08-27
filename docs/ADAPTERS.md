# Adapters

An adapter is the small piece of Facet that knows how to build one protocol's calldata. It is
not a copy of the protocol, not a wrapper, and not a mock. Facet builds the same calls the
protocol's own frontend would build and runs them through a shadow account, so the protocol
receives an ordinary interaction from an ordinary-looking address and never has to know Facet
exists.

The adapter boundary is also the safety boundary. An adapter may select a known route and
construct known calldata; it must not accept arbitrary calls from a browser or a queue service.
The launcher should describe these as **compatible Starknet applications**, not arbitrary
applications. Compatibility means that the protocol action can be represented as ordinary
account-level calls and that Facet has a tested policy for its balances or persistent position.

Every address below was read from Starknet **mainnet** on 25 August 2026 — the ABIs were
fetched with `starknet_getClassAt` and the function signatures taken from them, not from
documentation and not from memory. The SDK call serializers were checked against those ABI
layouts on 26 August. Verify any of them yourself with the command at the end.

## Order, and why

Every private pool action needs a proof, including `SetViewingKey` registration, private
deposits, and application actions. Proving takes roughly five to seven minutes on the current
development host. Calls are built *before* the proof exists, so anything whose parameters decay
inside that window is a bad fit. Adapters are therefore ordered by parameter decay rather than
by prominence.

| Order | Protocol | Action | Decay |
|---|---|---|---|
| 1 | Vesu | Deposit | None — a supplied balance does not go stale |
| 2 | Endur | Stake | None — the exchange rate moves slowly and monotonically |
| 3 | Ekubo | Swap | **High** — a quote can miss its slippage bound inside the window |

Ekubo is last by design. It is the adapter most likely to fail for reasons that have nothing
to do with privacy, and leading with it would misattribute a timing problem to the product.

## Vesu — deposit

| | |
|---|---|
| Pool | `0x451fe483d5921a2919ddd81d0de6696669bccdacd859f72a4fba7656b97c3b5` (V2, Prime) |
| Entrypoint | `modify_position` |

```cairo
fn modify_position(params: ModifyPositionParams) -> UpdatePositionResponse

struct ModifyPositionParams {
    collateral_asset: ContractAddress,
    debt_asset: ContractAddress,
    user: ContractAddress,
    collateral: Amount,
    debt: Amount,
}

struct Amount { denomination: AmountDenomination, value: i257 }
enum AmountDenomination { Native, Assets }
```

**`user` is the facet's address, not the person's.** That single field is what makes the
position belong to an identity nobody can trace. A supply-only deposit sets a positive
`collateral` and leaves `debt` at zero.

Two calls, one invocation: `approve` on the collateral token, then `modify_position`. The
anonymizer takes an `Array<Call>`, so both fit in a single proved transaction.

The pure SDK builder is `buildVesuDepositPlan`. It returns those two calls plus a per-token
`diff` settlement hint. It requires the caller to provide every address already linked to the
user; the `user` field is refused if it matches one of them.

## Endur — stake

| | |
|---|---|
| Contract | `0x028d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a` (xSTRK) |
| Entrypoint | `deposit` |

```cairo
fn deposit(assets: u256, receiver: ContractAddress) -> u256
```

Verified live: `name()` returns `Endur xSTRK`, `symbol()` returns `xSTRK`. The interface is
ERC-4626 shaped — `deposit`, `mint`, `withdraw`, `redeem` — so `receiver` is the facet, and
the xSTRK lands in the facet's balance.

Same two-call pattern: `approve` STRK to the xSTRK contract, then `deposit`.

The pure SDK builder is `buildEndurStakePlan`. It returns separate `diff` settlement hints for
the unused input token and the xSTRK output, because those are different balances.

## Ekubo — swap

| | |
|---|---|
| Core | `0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b` |
| Mainnet STRK/ETH route | `0.05%` fee · `1000` tick spacing · extension `0x0` |
| Sepolia STRK/ETH route | `0.05%` fee · `50` tick spacing · extension `0x0` |

The router's single-hop `swap` call is now pinned to the live ABI and the Sepolia rehearsal:

```text
RouteNode    = PoolKey(token0, token1, fee, tick_spacing, extension)
             + sqrt_ratio_limit(u256=0) + skip_ahead(u128=0)
TokenAmount  = token_in + i129(amount_in, positive)
```

The transaction uses three calls in one shadow-account invocation: ERC-20 `transfer` of the
input to the router, `swap`, and `clear_minimum` for the output token. `quote_swap` is exposed
as a separate read-only call builder so the minimum can be read immediately before proving.
The implementation is `buildEkuboQuoteCall` and `buildEkuboSwapPlan`; the latter returns
independent `diff` settlement hints for the input remainder and output token.

The mainnet route was checked against the live router on 26 August 2026. The earlier
`0.01%` / `200` pool key returned `NOT_INITIALIZED`; the runner now uses the initialized
`0.05%` / `1000` STRK/ETH pool key and refuses to proceed if the live quote fails.

## Funding denominations

**Facet chooses the amount. The user does not type one.**

The funding leg is public: it names the token and the exact figure. An arbitrary amount is a
fingerprint, and it survives across every identity that uses it. Funding one identity with
137.42 STRK and another with 137.42 STRK links them as surely as reusing an address.

The intended policy is to fund identities in fixed steps such as **10, 25, 50, 100, and 250
STRK**. The step is the anonymity set: an identity funded with 50 STRK is indistinguishable
from every other identity funded with 50 STRK. Change is collected back into the shield, so the
amount that leaves the pool never reveals what was actually spent. The current launcher and
Mainnet runner do not yet enforce the full denomination policy; it must remain documented as a
policy/roadmap item until the queue and adapter path reject arbitrary amounts in code.

## Timing separation

Two identities created in one sitting, funded seconds apart, correlate on timing no matter
how good the denominations are. Funding and acting should therefore be spaced, and the
interface must be explicit that a delay is deliberate rather than a stall. The current code
does not yet enforce randomized timing separation; do not describe it as a guarantee until it
does.

## Proving starts early

Proving takes five to seven minutes and cannot be shortened on modest hardware. The product
response is asynchronous rather than deceptive: after exact intent and preflight checks, the
launcher submits an allowlisted job, returns a job id, and lets a warm worker prove while the
user leaves the page. The UI polls `queued → preflight → proving → proof_ready → broadcasting
→ confirmed`, with a typed failure state. This improves page lifetime and prevents duplicate
work; it does not reduce the cryptographic proof wall time. See [`ASYNC_PROVING.md`](ASYNC_PROVING.md).

For a delay-tolerant deposit or stake, the worker can start as soon as the reviewed intent is
complete. For Ekubo, a quote and minimum output must be captured immediately before proving
and checked again at `proof_ready`; a stale quote fails closed and requires a new proof.

## The recipient guard

**An adapter must refuse to build a call that names an address linked to the user.**

This is not a style rule. The first Sepolia rehearsal sent one wei to the owner's own
address because it was a smoke test, and that single receipt permanently connects the
identity to its owner on chain. The funding leg was shielded and did its job; the dapp call
gave it away.

Every adapter therefore checks its recipient and refuses, rather than warns, when the target
is:

- the connected wallet's address,
- any address that has funded the shielded pool for this user,
- any other identity belonging to the same user.

The last one matters most and is the easiest to miss: paying one identity from another links
the two, which is the exact property the product sells.

A refusal here is a success, not an error state. The interface should say which rule was hit
and what to do instead, because a user who cannot see why will work around it.

## Collect policy

Each adapter must state its `CollectPolicy` and the reasoning. A fungible balance delta is not
the same asset class as a persistent protocol position:

- **Vesu deposit** — the STRK leaves the facet and becomes a position. `Diff` settles whatever
  remains rather than assuming the balance is zero.
- **Endur stake** — the facet receives xSTRK, a *different* token from the one it spent. The
  policy must be reasoned about per token, not per interaction.

Do not copy a policy between adapters. `All` on an account that still holds a position token
does something different from `All` on an emptied one. LP positions, debt, NFTs, staking
receipts, and protocol shares stay attached to the facet until an explicit protocol exit is
performed; they are not automatically recoverable into a shielded balance.

The SDK builders in `packages/sdk/src/adapters.ts` do not prove or broadcast. They only return
canonical calls and settlement metadata for composition with `buildGateAActionSet` and the
upstream privacy client. Vesu and Endur builders enforce the recipient guard; Ekubo has no
user-supplied recipient in its tested single-hop path. The browser queue must call these
reviewed builders through a narrow allowlist rather than serializing arbitrary calldata.

## Verify any address here

```bash
curl -s https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_9 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getClassAt","params":["latest","<address>"]}' \
  | python3 -c "import sys,json;a=json.load(sys.stdin)['result']['abi'];a=json.loads(a) if isinstance(a,str) else a;print([f['name'] for i in a if i.get('type')=='interface' for f in i['items']])"
```

Sources: Vesu's published [contract addresses](https://docs.vesu.xyz/developers/contract-addresses),
then confirmed against chain. Endur's xSTRK address confirmed by reading `name` and `symbol`
from the contract itself.
