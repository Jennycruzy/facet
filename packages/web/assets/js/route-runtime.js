// Everything two Mainnet route pages need and neither should own: wallet discovery, the RPC
// client, felt/amount formatting, shielded-balance reads, helper verification, receipt polling
// and diagnostics. Both pages had their own copy of all of it; the copies had already drifted
// into different string styles, which is how the next drift starts.

export const $ = (id) => document.getElementById(id);

export const MAINNET_CHAIN_IDS = new Set(["SN_MAIN", "0X534E5F4D41494E"]);

export function setStatus(kind, message) {
  $("ready-status").dataset.state = kind;
  $("ready-status-text").textContent = message;
}

export function normalizeAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return null;
  // Starknet displays equivalent felts with or without leading zeroes. Canonicalize before
  // comparing the wallet's token/address strings with Facet's configured constants.
  try { return `0x${BigInt(value).toString(16)}`; } catch { return null; }
}

export function sameAddress(left, right) {
  const a = normalizeAddress(left);
  const b = normalizeAddress(right);
  return Boolean(a && b && a === b);
}

export function short(value, start = 10, end = 8) {
  if (!value) return "—";
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

export function hex(value) {
  return `0x${BigInt(value).toString(16)}`;
}

export const felt = (value) => hex(value);

export function u256(value) {
  const big = BigInt(value);
  return [hex(big & ((1n << 128n) - 1n)), hex(big >> 128n)];
}

export function u256FromResult(result) {
  if (!Array.isArray(result) || result.length < 2) throw new Error("Expected a u256 pair.");
  return BigInt(result[0]) + (BigInt(result[1]) << 128n);
}

export function formatUnits(value, decimals = 18, maxFraction = 8) {
  const big = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = big / base;
  const remainder = big % base;
  if (remainder === 0n) return whole.toString();
  const fraction = remainder.toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function chainLabel(value) {
  if (typeof value !== "string") return "unknown";
  const upper = value.toUpperCase();
  if (MAINNET_CHAIN_IDS.has(upper)) return "Starknet Mainnet";
  if (upper === "SN_SEPOLIA" || upper === "0X534E5F5345504F4C4941") return "Starknet Sepolia";
  return value;
}

export function isMainnet(value) {
  return MAINNET_CHAIN_IDS.has(typeof value === "string" ? value.toUpperCase() : "");
}

export function errorDetail(value, depth = 0, seen = new Set()) {
  if (depth > 4 || value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "";
  seen.add(value);
  const parts = [];
  for (const key of ["message", "data", "error", "cause", "reason"]) {
    const detail = errorDetail(value[key], depth + 1, seen);
    if (detail && !parts.includes(detail)) parts.push(detail);
  }
  if (!parts.length) {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return parts.join(" · ");
}

export function errorText(error) {
  const detail = errorDetail(error);
  return detail || "The wallet returned an unknown error.";
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function candidateWallets(scope = globalThis) {
  const names = ["starknet_ready", "starknetReady", "starknet"];
  const seen = new Set();
  const found = [];
  for (const name of names) {
    const wallet = scope[name];
    if (!wallet || typeof wallet.request !== "function" || seen.has(wallet)) continue;
    const explicitReadyInjection = name === "starknet_ready" || name === "starknetReady";
    const identity = `${wallet.id ?? ""} ${wallet.name ?? ""}`;
    const identifiesAsReady = /(^|[^a-z])ready(?:[\s_-]*x)?([^a-z]|$)/i.test(identity);
    if (!explicitReadyInjection && !identifiesAsReady) continue;
    seen.add(wallet);
    found.push({ name, wallet });
  }
  return found;
}

export const detectReadyX = (scope = globalThis) => candidateWallets(scope)[0]?.wallet ?? null;

export async function request(wallet, message) {
  return wallet.request(message);
}

export function createRpc(url) {
  return async function rpc(method, params) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    });
    if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
    return body.result;
  };
}

export function versionAtLeast(version, major, minor, patch = 0) {
  const parts = String(version).split(".").map((part) => Number.parseInt(part, 10));
  if (parts.some(Number.isNaN)) return false;
  const [a = 0, b = 0, c = 0] = parts;
  return a > major || (a === major && (b > minor || (b === minor && c >= patch)));
}

export const hasNativeStrk20 = (versions) =>
  versions.some((version) => versionAtLeast(version, 0, 10, 3));

/**
 * Returns the first reason a reviewed route must not be submitted.
 *
 * The buttons are disabled while a review is incomplete, but this check also runs from the
 * click handler. That matters for an old tab, a wallet response that arrives out of order, or
 * an injected provider that invokes the handler programmatically: the user gets the missing
 * step instead of a silent no-op and a stale "no transaction" message.
 */
export function executionBlockReason(state, {
  confirmChecked = false,
  protocolName = "route",
  protocolReady = true,
  executionEnabled = true,
  pausedReason = "This route is paused.",
} = {}) {
  if (!executionEnabled) return pausedReason;
  if (!state.wallet || !state.connected || !state.account) {
    return "Connect Ready X before requesting a transaction.";
  }
  if (!isMainnet(state.chainId)) {
    return "Switch Ready X to Starknet Mainnet before requesting this action.";
  }
  if (!hasNativeStrk20(state.apiVersions)) {
    return "This wallet does not support the private action required by this route.";
  }
  if (!state.helperDeployed) return "The Facet helper is not available yet.";
  if (protocolReady === false) return `The ${protocolName} protocol check is not ready.`;
  if (state.balanceWei === null) return "Refresh the private balance before requesting a transaction.";
  if (state.amountError) return state.amountError;
  if (state.balanceWei < state.amountWei) return "The private STRK balance is below the selected input.";
  if (!state.quote) return `Refresh the ${protocolName} quote before requesting a transaction.`;
  if (!confirmChecked) return "Check the review box before requesting a transaction.";
  if (state.executing) return "A transaction is already in progress.";
  return null;
}

/** Reads account, chain, advertised API versions and the shielded balance of one token. */
export async function readWalletState(wallet, token, silent = false) {
  const errors = [];
  let accounts = [];
  // Keep the connection request separate from the reads. Some injected wallets serialize their
  // approval UI; starting several requests at once can make the balance call race the connection.
  try {
    accounts = await request(wallet, { type: "wallet_requestAccounts", params: { silent_mode: silent } });
  } catch (error) {
    errors.push(`Account request: ${errorText(error)}`);
  }
  const account = Array.isArray(accounts) ? normalizeAddress(accounts[0]) : null;
  if (!account) return { account, chainId: null, versions: [], balanceWei: null, errors };

  let chainId = null;
  try { chainId = await request(wallet, { type: "wallet_requestChainId" }); }
  catch (error) { errors.push(`Chain request: ${errorText(error)}`); }

  let versionsResult = null;
  try { versionsResult = await request(wallet, { type: "wallet_supportedWalletApi" }); }
  catch (error) { errors.push(`Wallet API versions: ${errorText(error)}`); }

  let balancesResult = null;
  try { balancesResult = await request(wallet, { type: "wallet_strk20Balances", params: { tokens: [token] } }); }
  catch (error) { errors.push(`Shielded balance: ${errorText(error)}`); }

  const entry = Array.isArray(balancesResult)
    ? balancesResult.find((item) => sameAddress(item?.token, token))
    : null;
  let balanceWei = null;
  if (entry) {
    try { balanceWei = BigInt(entry.balance ?? "0"); } catch { errors.push("Shielded balance was not an integer."); }
  } else if (Array.isArray(balancesResult)) {
    balanceWei = 0n;
  }

  return {
    account,
    chainId,
    versions: Array.isArray(versionsResult) ? versionsResult.filter((version) => typeof version === "string") : [],
    balanceWei,
    errors,
  };
}

/** Confirms the reserved helper address carries the class Facet reviewed. */
export async function checkHelper(rpc, helper, classHash) {
  try {
    const live = await rpc("starknet_getClassHashAt", ["latest", helper]);
    if (sameAddress(live, classHash)) return { deployed: true, error: null };
    return { deployed: false, error: `Helper address has class ${live}, not the expected Facet allowlisted class.` };
  } catch {
    return { deployed: false, error: null };
  }
}

/**
 * Polls until Mainnet accepts or reverts the transaction, updating the shared status and result
 * panel. Both route pages had their own copy; this is the Ekubo one, which is the stricter of the
 * two — it checks finality as well as execution status.
 */
export async function waitForReceipt(rpc, transactionHash, { attempts = 72, delayMs = 5000 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const receipt = await rpc("starknet_getTransactionReceipt", [transactionHash]);
      const execution = String(receipt.execution_status ?? "").toUpperCase();
      const finality = String(receipt.finality_status ?? receipt.status ?? "").toUpperCase();
      if (execution.includes("REVERT") || finality.includes("REVERT")) {
        throw new Error(`Mainnet transaction reverted: ${transactionHash}`);
      }
      if (execution.includes("SUCC") || finality.includes("ACCEPTED")) {
        setStatus("bound", "Mainnet transaction accepted.");
        $("result-panel").innerHTML = `<p>Success: <a href="https://voyager.online/tx/${encodeURIComponent(transactionHash)}" target="_blank" rel="noreferrer">${escapeHtml(transactionHash)}</a></p>`;
        return receipt;
      }
    } catch (error) {
      if (String(errorText(error)).includes("reverted")) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  setStatus("submitted", "Transaction submitted; confirmation is still pending.");
  return null;
}

export async function copyToClipboard(text, statusId = "copy-status") {
  try {
    await navigator.clipboard.writeText(text);
    $(statusId).textContent = "copied";
  } catch {
    $(statusId).textContent = "Clipboard unavailable";
  }
}
