/**
 * Minimal third-party integration example.
 *
 * The application supplies a normal intent and reviewed route configuration. Facet's public
 * adapter/executor boundary builds the wallet action and checks the settlement policy; the wallet
 * still owns proving, screening, and broadcast. No private key, viewing key, or proof is accepted
 * by this example.
 */
import {
  endurAdapter,
  erc4626HelperBinding,
  executeAppIntent,
  WalletFacetExecutor,
  type Strk20WalletLike,
} from "@facet/sdk";

export interface CompatibleAppConfig {
  wallet: Strk20WalletLike;
  owner: string;
  token: string;
  applicationToken: string;
  helper: string;
  amount: bigint;
  maxAmount: bigint;
  linkedAddresses?: readonly string[];
}

/** Run one reviewed, delay-tolerant application action through the public Facet SDK surface. */
export function runCompatibleApp(config: CompatibleAppConfig) {
  const linkedAddresses = [config.owner, ...(config.linkedAddresses ?? [])];
  const executor = new WalletFacetExecutor({
    wallet: config.wallet,
    owner: config.owner,
    linkedAddresses,
    binding: erc4626HelperBinding({ helper: config.helper, operation: "deposit" }),
    policy: {
      supportedAssets: [config.token, config.applicationToken],
      amountBounds: { min: 1n, max: config.maxAmount },
      assetKinds: {
        [config.token]: "fungible",
        [config.applicationToken]: "exit-required",
      },
    },
  });

  return executeAppIntent({
    adapter: endurAdapter,
    intent: {
      action: "stake",
      parameters: {
        token: config.token,
        endur: config.applicationToken,
        receiver: config.helper,
        amount: config.amount,
      },
    },
    context: { linkedAddresses },
    executor,
  });
}
