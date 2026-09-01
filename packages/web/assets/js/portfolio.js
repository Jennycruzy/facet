/*
 * Chain-backed portfolio reads for the launcher.
 *
 * The browser has two separate sources of truth:
 *
 *   1. Ready X's private balance response, which is authoritative for shielded notes;
 *   2. the anonymizer's public view, which is authoritative for a discovered shadow account and
 *      its public token balances.
 *
 * localStorage is only updated as a convenience cache after those reads succeed. A wallet that
 * does not expose the optional shadow-account commitment is still useful: the launcher shows the
 * private portfolio and explains that direct facet discovery is unavailable instead of inventing
 * an address from local metadata.
 */

import { applicationContext } from "./app-context.js";
import { mapKey, readMap, reconcile } from "./facet-map.js";
import { errorText, request } from "./route-runtime.js";

export const SHADOW_ACCOUNT_COMMITMENT_REQUEST = "wallet_strk20ShadowAccountCommitment";

function canonicalFelt(value, label = "felt") {
  try {
    const numeric = BigInt(value);
    if (numeric < 0n) throw new RangeError(`${label} must be non-negative.`);
    return `0x${numeric.toString(16)}`;
  } catch (error) {
    throw new TypeError(`${label} is not a valid felt: ${errorText(error)}`);
  }
}

/** Extract the partial commitment without assuming one wallet vendor's response wrapper. */
export function extractPartialCommitment(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return canonicalFelt(value, "partial commitment");
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      try {
        const commitment = extractPartialCommitment(item);
        if (commitment) return commitment;
      } catch { /* try the next response shape */ }
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const key of ["partial_commitment", "partialCommitment", "commitment", "value", "result"]) {
    if (!(key in value)) continue;
    try {
      const commitment = extractPartialCommitment(value[key]);
      if (commitment) return commitment;
    } catch { /* try the next response shape */ }
  }
  return null;
}

/** Decode the object array returned by `wallet_strk20Balances`. */
export function decodeWalletBalances(result, tokens) {
  if (!Array.isArray(result)) throw new TypeError("The wallet returned malformed private balances.");
  const wanted = new Set(tokens.map((token) => canonicalFelt(token, "token")));
  const balances = new Map(tokens.map((token) => [canonicalFelt(token, "token"), 0n]));
  for (const entry of result) {
    if (!entry || typeof entry !== "object") continue;
    const token = canonicalFelt(entry.token, "balance token");
    if (!wanted.has(token)) continue;
    let balance;
    try { balance = BigInt(entry.balance ?? entry.amount ?? "0"); }
    catch { throw new TypeError(`The private balance for ${token} was not an integer.`); }
    if (balance < 0n) throw new RangeError(`The private balance for ${token} was negative.`);
    balances.set(token, balance);
  }
  return balances;
}

export function routeApps(apps) {
  return apps.filter((app) => !app.lifecycle?.contextApp);
}

function addAsset(catalog, token, symbol) {
  let normalized;
  try { normalized = canonicalFelt(token, "asset"); } catch { return; }
  if (!catalog.has(normalized) || (symbol && catalog.get(normalized) === "token")) {
    catalog.set(normalized, symbol || normalized);
  }
}

/** Build one symbol map for every token a supported route can produce or consume. */
export function assetCatalog(apps, strk) {
  const catalog = new Map();
  addAsset(catalog, strk, "STRK");
  for (const app of routeApps(apps)) {
    for (const token of app.policy?.supportedAssets ?? []) addAsset(catalog, token, "token");
    addAsset(catalog, app.outputToken, app.outputSymbol);
    addAsset(catalog, app.route?.tokenIn, app.route?.tokenInSymbol);
    addAsset(catalog, app.route?.tokenOut, app.route?.tokenOutSymbol);
  }
  return [...catalog.entries()].map(([token, symbol]) => ({ token, symbol }));
}

export async function readPrivatePortfolio(wallet, assets) {
  try {
    const result = await request(wallet, {
      type: "wallet_strk20Balances",
      params: { tokens: assets.map(({ token }) => token) },
    });
    return { balances: decodeWalletBalances(result, assets.map(({ token }) => token)), error: null };
  } catch (error) {
    return { balances: new Map(), error: `Private portfolio: ${errorText(error)}` };
  }
}

/**
 * Ask the wallet for its optional private commitment. This is a read-only capability probe; it
 * never requests a signature and never persists the returned commitment.
 */
export async function readShadowAccountCommitment(wallet, dappName) {
  try {
    const result = await request(wallet, {
      type: SHADOW_ACCOUNT_COMMITMENT_REQUEST,
      params: { dapp_name: dappName },
    });
    const partialCommitment = extractPartialCommitment(result);
    if (!partialCommitment) {
      return {
        status: "malformed",
        reason: "The wallet accepted shadow-account discovery but returned no partial commitment.",
      };
    }
    return { status: "available", partialCommitment };
  } catch (error) {
    const detail = errorText(error);
    if (/not[ _-]?registered/i.test(detail)) {
      return {
        status: "not-registered",
        reason: "The wallet supports discovery, but this private identity is not registered for the pool.",
      };
    }
    return {
      status: "unavailable",
      reason: "This wallet does not expose the optional shadow-account discovery request.",
      detail,
    };
  }
}

function appAssets(app, catalog) {
  const wanted = new Set([
    ...(app.policy?.supportedAssets ?? []),
    app.outputToken,
    app.route?.tokenIn,
    app.route?.tokenOut,
  ].filter(Boolean).map((token) => canonicalFelt(token, "route asset")));
  return catalog.filter(({ token }) => wanted.has(token));
}

function publicPositions(balances, assets) {
  return assets
    .map(({ token, symbol }) => ({ token, symbol, amount: balances[token] ?? 0n }))
    .filter(({ amount }) => amount > 0n);
}

/**
 * Read the private wallet portfolio and, when available, each app's deterministic public account.
 * The function is deliberately tolerant of an unsupported optional wallet method: that is a
 * capability result, not a failed portfolio refresh.
 */
export async function loadPortfolio({ wallet, chain, anonymizer, apps, strk, account, network = "mainnet" }) {
  const catalog = assetCatalog(apps, strk);
  const privateResult = await readPrivatePortfolio(wallet, catalog);
  const local = readMap();
  const facets = [];

  for (const app of routeApps(apps)) {
    const context = applicationContext(app);
    const cached = local[mapKey(account, app.id)] ?? null;
    const entry = { appId: app.id, context, cached, capability: null, chain: null, error: null };
    const capability = await readShadowAccountCommitment(wallet, context.dappName);
    entry.capability = { status: capability.status, reason: capability.reason ?? null };
    if (capability.status === "available") {
      try {
        const accounts = await chain.shadowAccounts(network, anonymizer, capability.partialCommitment, context.nonce);
        const discovered = accounts.find((candidate) => candidate.nonce === BigInt(context.nonce));
        if (!discovered) throw new Error(`No account returned for nonce ${context.nonce}.`);
        const assets = appAssets(app, catalog);
        const balances = {};
        const errors = [];
        for (const { token } of assets) {
          try { balances[token] = (await chain.balanceOf(network, token, discovered.address)).toString(); }
          catch (error) { errors.push(`${token}: ${errorText(error)}`); }
        }
        entry.chain = {
          address: discovered.address,
          isDeployed: discovered.isDeployed,
          balances,
          positions: publicPositions(
            Object.fromEntries(Object.entries(balances).map(([token, amount]) => [token, BigInt(amount)])),
            assets,
          ),
          observedAt: new Date().toISOString(),
          errors,
        };
        if (account) {
          entry.cached = reconcile(account, app.id, entry.chain);
        }
      } catch (error) {
        entry.error = `On-chain facet read: ${errorText(error)}`;
      }
    }
    facets.push(entry);
  }

  return {
    assets: catalog,
    privateBalances: Object.fromEntries([...privateResult.balances.entries()].map(([token, amount]) => [token, amount.toString()])),
    privateBalanceError: privateResult.error,
    facets,
    refreshedAt: new Date().toISOString(),
  };
}
