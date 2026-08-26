/*
 * The browser-side wallet boundary for the staged launcher.
 *
 * This module deliberately stops at a wallet signature. It does not derive or persist a private
 * key, and it never asks an injected wallet for one. `wallet-derivation.js` consumes the signature
 * in the same live session to derive the read-only viewing key needed by the proving client.
 */

export const WALLET_BINDING_DOMAIN = "Facet";
export const WALLET_BINDING_VERSION = "1";

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const PERSONAL_SIGNATURE = /^0x[0-9a-f]{130}$/i;

/** Normalize an EOA address without changing its fixed-width EVM representation. */
export function normalizeEoaAddress(value) {
  if (typeof value !== "string" || !EVM_ADDRESS.test(value)) {
    throw new TypeError("The injected account is not a 20-byte EOA address.");
  }
  return value.toLowerCase();
}

/** Normalize a Starknet felt used in the binding message. */
export function normalizeStarknetFelt(value, label = "felt") {
  let numeric;
  try {
    numeric = BigInt(value);
  } catch {
    throw new TypeError(`${label} must be an integer.`);
  }
  if (numeric <= 0n) throw new RangeError(`${label} must be positive.`);
  return `0x${numeric.toString(16)}`;
}

/**
 * Construct the one message a wallet signs for this browser session.
 *
 * The network, pool, wallet address, and origin are all bound into the text. The message explicitly
 * says that it authorizes no transaction, so a wallet user can distinguish this from a spend.
 */
export function canonicalWalletBindingMessage({ network, pool, wallet, origin }) {
  if (!network || !origin) throw new TypeError("network and origin are required.");
  const account = normalizeEoaAddress(wallet);
  const poolAddress = normalizeStarknetFelt(pool, "pool");
  return [
    "Facet wallet binding",
    `domain: ${WALLET_BINDING_DOMAIN}`,
    `version: ${WALLET_BINDING_VERSION}`,
    `origin: ${origin}`,
    `starknet_network: ${network}`,
    `privacy_pool: ${poolAddress}`,
    `wallet: ${account}`,
    "purpose: derive a private Facet viewing capability",
    "This signature authorizes no transaction and spends no funds.",
  ].join("\n");
}

/** Encode UTF-8 text for the standard EIP-1193 `personal_sign` request. */
export function encodePersonalSignMessage(message) {
  if (typeof message !== "string" || message.length === 0) {
    throw new TypeError("The wallet binding message must be non-empty text.");
  }
  const bytes = new TextEncoder().encode(message);
  let encoded = "0x";
  for (const byte of bytes) encoded += byte.toString(16).padStart(2, "0");
  return encoded;
}

/** Validate and normalize a 65-byte ECDSA signature returned by `personal_sign`. */
export function validatePersonalSignature(value) {
  if (typeof value !== "string" || !PERSONAL_SIGNATURE.test(value)) {
    throw new TypeError("The wallet returned an unexpected personal-sign signature.");
  }
  const recovery = Number.parseInt(value.slice(-2), 16);
  if (![0, 1, 27, 28].includes(recovery)) {
    throw new TypeError("The wallet returned an unsupported signature recovery byte.");
  }
  return value.toLowerCase();
}

/** Find an EIP-1193 provider injected by an EOA wallet. */
export function detectEoaProvider(scope = globalThis) {
  const injected = scope?.ethereum;
  const candidates = [
    ...(Array.isArray(injected?.providers) ? injected.providers : []),
    injected,
  ];
  return candidates.find((candidate) => candidate && typeof candidate.request === "function") ?? null;
}

/** Read accounts without opening a wallet approval prompt. */
export async function readEoaAccounts(provider) {
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts)) throw new TypeError("The wallet returned malformed accounts.");
  return accounts.map(normalizeEoaAddress);
}

/** Request one EOA account from the injected wallet. */
export async function requestEoaAccount(provider) {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("The wallet did not return an EOA account.");
  }
  return normalizeEoaAddress(accounts[0]);
}

/** Sign the binding message; the caller owns the returned signature and must keep it in memory. */
export async function signWalletBinding(provider, account, message) {
  const wallet = normalizeEoaAddress(account);
  const signature = await provider.request({
    method: "personal_sign",
    params: [encodePersonalSignMessage(message), wallet],
  });
  return validatePersonalSignature(signature);
}
