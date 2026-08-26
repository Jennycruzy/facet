import { ec, hash } from "starknet";

/** Versioned label; changing it intentionally creates a new identity keyspace. */
export const VIEWING_KEY_LABEL = "viewing-key:v1";

const CURVE_ORDER = ec.starkCurve.CURVE.n;
export const MAX_VIEWING_KEY = CURVE_ORDER / 2n;
const PERSONAL_SIGNATURE = /^0x[0-9a-f]{130}$/i;

/** Validate the canonical 65-byte EVM signature returned by `personal_sign`. */
export function normalizeWalletSignature(value: string): string {
  if (typeof value !== "string" || !PERSONAL_SIGNATURE.test(value)) {
    throw new TypeError("Expected a 65-byte 0x-prefixed EVM wallet signature.");
  }
  const recovery = Number.parseInt(value.slice(-2), 16);
  if (![0, 1, 27, 28].includes(recovery)) {
    throw new TypeError("EVM wallet signature has an unsupported recovery byte.");
  }
  return value.toLowerCase();
}

/**
 * Fold a reduced Stark scalar into the strict canonical pool viewing-key range [1, order / 2).
 * The boundary clamp mirrors the upstream bridge implementation and keeps the pool's
 * `is_canonical_key` check true even for the two vanishingly unlikely upper-bound seeds.
 */
export function foldViewingKey(reduced: bigint, order = CURVE_ORDER): bigint {
  if (reduced < 0n || reduced >= order) throw new RangeError("Reduced viewing key is outside the curve order.");
  const max = order / 2n;
  let canonical = reduced < max ? reduced : order - reduced;
  if (canonical >= max) canonical = max - 1n;
  return canonical === 0n ? 1n : canonical;
}

/**
 * Derive the privacy-pool viewing key from the in-memory EVM wallet signature.
 *
 * This matches the preserved bridge-core recipe: hash two labelled strings with Starknet-Keccak,
 * concatenate the <=250-bit limbs into a wider seed, reduce by the Stark curve order, and fold.
 * The signature is never persisted or logged by this function.
 */
export function deriveViewingKeyFromSignature(evmSignature: string): bigint {
  const signature = normalizeWalletSignature(evmSignature);
  const base = `${signature}:${VIEWING_KEY_LABEL}`;
  const low = BigInt(hash.starknetKeccak(`${base}:0`));
  const high = BigInt(hash.starknetKeccak(`${base}:1`));
  const seed = (high << 250n) | low;
  return foldViewingKey(seed % CURVE_ORDER);
}
