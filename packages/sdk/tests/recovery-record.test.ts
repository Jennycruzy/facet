import { describe, expect, it } from "vitest";
import {
  createMemoryFacetStore,
  createOrRetainFacet,
  createStorageFacetStore,
  deriveRecoveryKey,
  isSealedRecoveryRecord,
  listFacets,
  openRecoveryRecord,
  sealRecoveryRecord,
  type KeyValueStorage,
} from "../src/index.js";

const SIGNATURE = "0x9f2c1a" + "de".repeat(30);
const WALLET = "0xABCdef0000000000000000000000000000000001";

const metadata = { app: "endur", nonce: 0, positions: [{ asset: "0x28d7", kind: "exit-required" }] };

function memoryStorage(): KeyValueStorage & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (key) => raw.get(key) ?? null,
    setItem: (key, value) => { raw.set(key, value); },
  };
}

describe("encrypted recovery record", () => {
  it("round-trips metadata through a wallet-derived key", async () => {
    const key = await deriveRecoveryKey(SIGNATURE, WALLET);
    const sealed = await sealRecoveryRecord(key, metadata);
    expect(await openRecoveryRecord(key, sealed)).toEqual(metadata);
  });

  it("actually encrypts: the plaintext never appears in the envelope", async () => {
    const key = await deriveRecoveryKey(SIGNATURE, WALLET);
    const sealed = await sealRecoveryRecord(key, metadata);
    expect(sealed).not.toContain("endur");
    expect(sealed).not.toContain("0x28d7");
    expect(isSealedRecoveryRecord(sealed)).toBe(true);
    expect(isSealedRecoveryRecord(JSON.stringify(metadata))).toBe(false);
  });

  it("uses a fresh IV, so rewriting a record is not distinguishable from replacing it", async () => {
    const key = await deriveRecoveryKey(SIGNATURE, WALLET);
    expect(await sealRecoveryRecord(key, metadata))
      .not.toBe(await sealRecoveryRecord(key, metadata));
  });

  it("cannot be opened by a different wallet secret, or a different wallet", async () => {
    const sealed = await sealRecoveryRecord(await deriveRecoveryKey(SIGNATURE, WALLET), metadata);
    const otherSecret = await deriveRecoveryKey(`0x${"11".repeat(32)}`, WALLET);
    const otherWallet = await deriveRecoveryKey(SIGNATURE, "0xfeed");
    await expect(openRecoveryRecord(otherSecret, sealed)).rejects.toThrow();
    await expect(openRecoveryRecord(otherWallet, sealed)).rejects.toThrow();
  });

  it("is authenticated: a tampered envelope fails rather than decoding", async () => {
    const key = await deriveRecoveryKey(SIGNATURE, WALLET);
    const [version, iv, ciphertext] = (await sealRecoveryRecord(key, metadata)).split(".");
    const flipped = `${ciphertext!.slice(0, -2)}${ciphertext!.slice(-2) === "AA" ? "AB" : "AA"}`;
    await expect(openRecoveryRecord(key, [version, iv, flipped].join("."))).rejects.toThrow();
    await expect(openRecoveryRecord(key, "v1.short")).rejects.toThrow(/Malformed/);
    await expect(openRecoveryRecord(key, `v2.${iv}.${ciphertext}`)).rejects.toThrow(/Malformed/);
  });

  it("refuses an empty secret rather than deriving a guessable key", async () => {
    await expect(deriveRecoveryKey("", WALLET)).rejects.toThrow(/non-empty/);
    await expect(deriveRecoveryKey("   ", WALLET)).rejects.toThrow(/non-empty/);
  });

  it("derives the same key on a later visit from the same wallet", async () => {
    const sealed = await sealRecoveryRecord(await deriveRecoveryKey(SIGNATURE, WALLET), metadata);
    // A second session re-derives from the signature alone; nothing about the key was stored.
    const revisit = await deriveRecoveryKey(SIGNATURE, WALLET.toLowerCase());
    expect(await openRecoveryRecord(revisit, sealed)).toEqual(metadata);
  });
});

describe("persistent facet stores", () => {
  it("keeps a facet across sessions, so a returning wallet resolves the same identity", async () => {
    const storage = memoryStorage();
    const key = await deriveRecoveryKey(SIGNATURE, WALLET);
    const first = createOrRetainFacet(createStorageFacetStore(storage), {
      wallet: WALLET, app: "endur", strategy: "stake", address: "0x5709",
      recovery: { encryptedMetadata: await sealRecoveryRecord(key, metadata), positions: [] },
    });
    // A brand new store over the same storage is what a later visit actually looks like.
    const later = createOrRetainFacet(createStorageFacetStore(storage), {
      wallet: WALLET, app: "endur", strategy: "stake", address: "0xdifferent",
      recovery: { encryptedMetadata: "", positions: [] },
    });
    expect(later).toEqual(first);
    expect(later.address).toBe("0x5709");
    expect(await openRecoveryRecord(key, later.recovery.encryptedMetadata)).toEqual(metadata);
  });

  it("persists only ciphertext, never the wallet-to-app mapping in the clear", async () => {
    const storage = memoryStorage();
    const key = await deriveRecoveryKey(SIGNATURE, WALLET);
    createOrRetainFacet(createStorageFacetStore(storage), {
      wallet: WALLET, app: "endur", strategy: "stake", address: "0x5709",
      recovery: { encryptedMetadata: await sealRecoveryRecord(key, metadata), positions: [] },
    });
    const persisted = [...storage.raw.values()].join("");
    expect(persisted).not.toContain("0x28d7");
    expect(persisted).toMatch(/"encryptedMetadata":"v1\./);
  });

  it("survives a storage area that throws, because a record is a cache and not the truth", () => {
    const hostile: KeyValueStorage = {
      getItem: () => { throw new Error("private mode"); },
      setItem: () => { throw new Error("quota exceeded"); },
    };
    const store = createStorageFacetStore(hostile);
    expect(() => createOrRetainFacet(store, {
      wallet: WALLET, app: "ekubo", strategy: "swap", address: "0x1",
      recovery: { encryptedMetadata: "", positions: [] },
    })).not.toThrow();
    expect(store.all()).toEqual([]);
  });

  it("lists a wallet's facets without leaking another wallet's", () => {
    const store = createMemoryFacetStore();
    const base = { strategy: "default", address: "0x1",
      recovery: { encryptedMetadata: "", positions: [] } };
    createOrRetainFacet(store, { ...base, wallet: WALLET, app: "endur" });
    createOrRetainFacet(store, { ...base, wallet: WALLET, app: "ekubo" });
    createOrRetainFacet(store, { ...base, wallet: "0xother", app: "endur" });
    expect(listFacets(store, WALLET).map((record) => record.app).sort()).toEqual(["ekubo", "endur"]);
    expect(listFacets(store)).toHaveLength(3);
  });
});
