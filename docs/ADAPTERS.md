# Adapters

An adapter is the small piece of Facet that knows how to build one protocol's calldata. It is
not a copy of the protocol, not a wrapper, and not a mock. Facet builds the same calls the
protocol's own frontend would build and runs them through a shadow account, so the protocol
receives an ordinary interaction from an ordinary-looking address and never has to know Facet
exists.

Every address below was read from Starknet **mainnet** on 25 August 2026 — the ABIs were
fetched with `starknet_getClassAt` and the function signatures taken from them, not from
documentation and not from memory. Verify any of them yourself with the command at the end.

## Order, and why

Every Facet action needs a proof, and proving takes five to six minutes. Calls are built
*before* the proof exists, so anything whose parameters decay inside that window is a bad fit.
Adapters are therefore ordered by parameter decay rather than by prominence.

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

## Ekubo — swap

| | |
|---|---|
| Core | `0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b` |

Class hash confirmed on mainnet. The call shape is **not yet pinned down here**, because
Ekubo's core uses a lock/callback pattern rather than a plain swap entrypoint, and writing a
guess into this file would be worse than leaving it open. It is the third adapter for the
timing reason above, and its exact calldata will be recorded here when it is built and tested.

## Collect policy

Each adapter must state its `CollectPolicy` and the reasoning:

- **Vesu deposit** — the STRK leaves the facet and becomes a position. `Diff` settles whatever
  remains rather than assuming the balance is zero.
- **Endur stake** — the facet receives xSTRK, a *different* token from the one it spent. The
  policy must be reasoned about per token, not per interaction.

Do not copy a policy between adapters. `All` on an account that still holds a position token
does something different from `All` on an emptied one.

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
