import { validatePersonalSignature } from "./wallet-binding.js";

/* Keccak-256, the hash used by Starknet's `starknetKeccak` (padding byte 0x01, not SHA-3 0x06). */
const MASK_64 = (1n << 64n) - 1n;
const MASK_250 = (1n << 250n) - 1n;
const RATE_BYTES = 136;
const ROTATION = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];
const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

function rotateLeft(value, amount) {
  if (amount === 0) return value;
  const shift = BigInt(amount);
  return ((value << shift) | (value >> (64n - shift))) & MASK_64;
}

function keccakF(state) {
  for (const roundConstant of ROUND_CONSTANTS) {
    const columnParity = Array.from({ length: 5 }, (_, x) =>
      state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20]
    );
    const columnCorrection = columnParity.map((_, x) =>
      columnParity[(x + 4) % 5] ^ rotateLeft(columnParity[(x + 1) % 5], 1)
    );
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) state[x + 5 * y] ^= columnCorrection[x];
    }

    const rotated = Array(25).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const destinationX = y;
        const destinationY = (2 * x + 3 * y) % 5;
        rotated[destinationX + 5 * destinationY] = rotateLeft(state[x + 5 * y], ROTATION[x][y]);
      }
    }

    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const current = rotated[x + 5 * y];
        const next = rotated[(x + 1) % 5 + 5 * y];
        const nextNext = rotated[(x + 2) % 5 + 5 * y];
        state[x + 5 * y] = current ^ ((~next & MASK_64) & nextNext);
      }
    }
    state[0] ^= roundConstant;
  }
}

function readLittleEndianLane(bytes, offset) {
  let lane = 0n;
  for (let i = 0; i < 8; i += 1) lane |= BigInt(bytes[offset + i]) << BigInt(8 * i);
  return lane;
}

/** Return a Keccak-256 digest as lowercase hex without a prefix. */
export function keccak256Hex(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const paddedLength = Math.ceil((bytes.length + 1) / RATE_BYTES) * RATE_BYTES;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;

  const state = Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += RATE_BYTES) {
    for (let lane = 0; lane < RATE_BYTES / 8; lane += 1) {
      state[lane] ^= readLittleEndianLane(padded, offset + lane * 8);
    }
    keccakF(state);
  }

  let digest = "";
  for (let i = 0; i < 32; i += 1) {
    const byte = Number((state[Math.floor(i / 8)] >> BigInt(8 * (i % 8))) & 0xffn);
    digest += byte.toString(16).padStart(2, "0");
  }
  return digest;
}

function starknetKeccak(value) {
  return BigInt(`0x${keccak256Hex(value)}`) & MASK_250;
}

const CURVE_ORDER = 3618502788666131213697322783095070105526743751716087489154079457884512865583n;
export const MAX_VIEWING_KEY = CURVE_ORDER / 2n;
export const VIEWING_KEY_LABEL = "viewing-key:v1";

function foldViewingKey(reduced) {
  let canonical = reduced < MAX_VIEWING_KEY ? reduced : CURVE_ORDER - reduced;
  if (canonical >= MAX_VIEWING_KEY) canonical = MAX_VIEWING_KEY - 1n;
  return canonical === 0n ? 1n : canonical;
}

/** Derive the pool viewing key from the validated, in-memory EVM wallet signature. */
export function deriveViewingKeyFromSignature(evmSignature) {
  const signature = validatePersonalSignature(evmSignature);
  const base = `${signature}:${VIEWING_KEY_LABEL}`;
  const low = starknetKeccak(`${base}:0`);
  const high = starknetKeccak(`${base}:1`);
  return foldViewingKey(((high << 250n) | low) % CURVE_ORDER);
}
