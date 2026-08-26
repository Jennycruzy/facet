import { describe, expect, it } from "vitest";
import { ec } from "starknet";
import {
  deriveViewingKeyFromSignature,
  foldViewingKey,
  MAX_VIEWING_KEY,
  normalizeWalletSignature,
} from "../src/index.js";

const SIGNATURE = `0x${"11".repeat(64)}1b`;
const EXPECTED_VIEWING_KEY =
  1303569664237614496489143458037667391579691182938090923584262300633580987291n;

describe("wallet-derived viewing key", () => {
  it("matches the bridge-core two-limb golden vector", () => {
    expect(deriveViewingKeyFromSignature(SIGNATURE)).toBe(EXPECTED_VIEWING_KEY);
  });

  it("normalizes signatures and rejects malformed or unsupported values", () => {
    expect(normalizeWalletSignature(SIGNATURE.toUpperCase())).toBe(SIGNATURE);
    expect(() => normalizeWalletSignature("0x1234")).toThrow(/65-byte/);
    expect(() => normalizeWalletSignature(`0x${"11".repeat(64)}02`)).toThrow(/recovery/);
  });

  it("stays strictly inside the pool's canonical range", () => {
    expect(MAX_VIEWING_KEY).toBe(ec.starkCurve.CURVE.n / 2n);
    expect(deriveViewingKeyFromSignature(SIGNATURE)).toBeGreaterThan(0n);
    expect(deriveViewingKeyFromSignature(SIGNATURE)).toBeLessThan(MAX_VIEWING_KEY);
  });

  it("handles the zero and upper-bound fold cases without emitting an invalid key", () => {
    const order = ec.starkCurve.CURVE.n;
    const max = order / 2n;
    expect(foldViewingKey(0n, order)).toBe(1n);
    expect(foldViewingKey(max, order)).toBe(max - 1n);
    expect(foldViewingKey(max + 1n, order)).toBe(max - 1n);
    expect(() => foldViewingKey(-1n, order)).toThrow();
    expect(() => foldViewingKey(order, order)).toThrow();
  });
});
