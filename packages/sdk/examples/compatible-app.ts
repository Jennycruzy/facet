/**
 * Minimal third-party integration example.
 *
 * The application supplies a normal intent and reviewed route configuration. Facet's public
 * adapter/executor boundary builds the wallet action and checks the settlement policy; the wallet
 * still owns proving, screening, and broadcast. No private key, viewing key, or proof is accepted
 * by this example.
 */
import {
  createMemoryFacetStore,
  createOrRetainFacet,
  deriveRecoveryKey,
  endurAdapter,
  erc4626HelperBinding,
  executeAppIntent,
  exitRoutesFromApps,
  loadSealedFacets,
  moveFacet,
  planFacetRecovery,
  saveSealedFacets,
  WalletFacetExecutor,
  type ExitRoute,
  type FacetRecoveryRouting,
  type FacetRecord,
  type SealedRecordStorage,
  type Strk20WalletLike,
} from "@usefacet/sdk";

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

export interface PersistentAppConfig extends CompatibleAppConfig {
  /** Where the opaque sealed record envelope lives between visits. */
  storage: SealedRecordStorage;
  /**
   * A verified secret only the user can reproduce (for example a Starknet-native wallet result or
   * a recovery passphrase). An EOA-shaped personal_sign result is not assumed to work with a
   * Starknet smart-contract wallet. It is used to derive the record key and is never stored,
   * logged, or returned.
   */
  walletSecret: string;
  /** The app's own identifier, so one wallet can hold a separate facet per application. */
  appId: string;
  /** The deployed exit catalogue, as published in `data/facets.json`. */
  exitRoutes?: readonly ExitRoute[];
}

function sameAsset(left: string, right: string): boolean {
  try { return BigInt(left) === BigInt(right); }
  catch { return left.toLowerCase() === right.toLowerCase(); }
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

/**
 * The same action, but as a facet that survives the visit.
 *
 * This is the shape a third-party integration actually wants, and it exercises the full public
 * surface rather than the execution half of it: the facet is retained in memory, the complete
 * record set is sealed under a wallet-derived key only after the protocol action succeeds, the
 * action runs through the same adapter/executor boundary, and the caller is handed a concrete
 * recovery plan for whatever the action left behind.
 *
 * Nothing here needs a Facet backend. The store is the caller's, the key is the wallet's, and the
 * routing is computed from the published catalogue.
 */
export async function runPersistentApp(config: PersistentAppConfig): Promise<{
  transactionHash: string;
  facetKey: string;
  recovery: FacetRecoveryRouting;
}> {
  const key = await deriveRecoveryKey(config.walletSecret, config.owner);

  // Records are decrypted into memory, mutated, and resealed as a whole. The record's own wallet,
  // app and address fields are identifying, so none of them may be written outside the envelope.
  const store = createMemoryFacetStore(
    await loadSealedFacets<FacetRecord>(config.storage, key),
  );

  // xSTRK is a persistent position: the stake is what creates something to recover later.
  const positions = [{ asset: config.applicationToken, kind: "xstrk" as const }];
  const facet = createOrRetainFacet(store, {
    wallet: config.owner,
    app: config.appId,
    strategy: "stake",
    address: config.helper,
    recovery: { positions: [] },
  });

  const { transactionHash } = await runCompatibleApp(config);

  // Do not persist a held position before the wallet action is accepted. If the wallet rejects,
  // the prior sealed record remains untouched; a failed attempt cannot manufacture recovery state.
  const nextPositions = [
    ...facet.recovery.positions.filter((position) => !sameAsset(position.asset, config.applicationToken)),
    ...positions,
  ];
  let updated = { ...facet, recovery: { positions: nextPositions } };
  store.set(updated);
  if (updated.state === "launch") updated = moveFacet(store, updated, "use");
  if (updated.state === "use") updated = moveFacet(store, updated, "hold");
  const persisted = await saveSealedFacets(config.storage, key, store.all());
  if (!persisted) {
    throw new Error(
      "The transaction succeeded, but the encrypted recovery record could not be persisted.",
    );
  }

  return {
    transactionHash,
    facetKey: facet.key,
    recovery: planFacetRecovery(config.appId, updated.recovery.positions, config.exitRoutes ?? []),
  };
}

/** Read the deployed exit catalogue out of a fetched `facets.json` payload. */
export function exitRoutesFromCatalogue(catalogue: { apps?: readonly unknown[] }): ExitRoute[] {
  return exitRoutesFromApps((catalogue.apps ?? []) as never);
}
