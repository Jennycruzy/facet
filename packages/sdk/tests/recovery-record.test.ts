import { describe, expect, it } from "vitest";
import {
  createMemoryFacetStore,
  createOrRetainFacet,
  createStorageFacetStore,
  derivePassphraseRecoveryKey,
  deriveRecoveryKey,
  isSealedRecoveryRecord,
  listFacets,
  loadPassphraseSealedFacets,
  loadSealedFacets,
  moveFacet,
  openRecoveryRecord,
  RECOVERY_PASSPHRASE_ITERATIONS,
  savePassphraseSealedFacets,
  saveSealedFacets,
  saveUnlockedPassphraseSealedFacets,
  SEALED_FACETS_KEY,
  sealRecoveryRecord,
  unlockPassphraseSealedFacets,
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

  it("supports an explicit passphrase vault without a plaintext index", async () => {
    expect(RECOVERY_PASSPHRASE_ITERATIONS).toBeGreaterThan(100_000);
    const storage = memoryStorage();
    const passphrase = "a deliberately long recovery passphrase";
    const records = [{ wallet: WALLET, app: "endur", state: "hold", positions: metadata.positions }];
    expect(await savePassphraseSealedFacets(storage, passphrase, records)).toBe(true);
    const persisted = [...storage.raw.values()].join("");
    for (const identifying of [WALLET, "endur", "0x28d7"]) expect(persisted).not.toContain(identifying);
    expect([...storage.raw.keys()]).toEqual([SEALED_FACETS_KEY]);
    expect(await loadPassphraseSealedFacets(storage, passphrase)).toEqual(records);
    await expect(loadPassphraseSealedFacets(storage, "a different recovery passphrase")).rejects.toThrow();
  });

  it("prepares a new vault in memory and only marks it configured after a successful write", async () => {
    const storage = memoryStorage();
    const passphrase = "another deliberately long recovery passphrase";
    const first = await unlockPassphraseSealedFacets(storage, passphrase);
    expect(first.configured).toBe(false);
    expect(first.records).toEqual([]);
    expect(await saveUnlockedPassphraseSealedFacets(storage, first, [{ wallet: WALLET }])).toBe(true);
    const later = await unlockPassphraseSealedFacets(storage, passphrase);
    expect(later.configured).toBe(true);
    expect(later.records).toEqual([{ wallet: WALLET }]);
    const otherSaltKey = await derivePassphraseRecoveryKey(passphrase, new Uint8Array(16));
    expect(otherSaltKey).toBeTruthy();
  });

  it("reports a persistent write failure instead of claiming it was saved", async () => {
    const key = await deriveRecoveryKey(SIGNATURE, WALLET);
    const hostile: KeyValueStorage = {
      getItem: () => null,
      setItem: () => { throw new Error("quota exceeded"); },
    };
    expect(await saveSealedFacets(hostile, key, [{ wallet: WALLET }])).toBe(false);
  });

  it("can cancel an in-flight passphrase write before it reaches storage", async () => {
    const storage = memoryStorage();
    const vault = await unlockPassphraseSealedFacets(storage, "a deliberately long recovery passphrase");
    expect(await saveUnlockedPassphraseSealedFacets(
      storage,
      vault,
      [{ wallet: WALLET }],
      SEALED_FACETS_KEY,
      () => false,
    )).toBe(false);
    expect(storage.raw.size).toBe(0);
  });
});

describe("persistent facet stores", () => {
  it("keeps a facet across sessions, so a returning wallet resolves the same identity", async () => {
    const storage = memoryStorage();
    const first = createOrRetainFacet(createStorageFacetStore(storage), {
      wallet: WALLET, app: "endur", strategy: "stake", address: "0x5709",
      recovery: { positions: [] },
    });
    // A brand new store over the same storage is what a later visit actually looks like.
    const later = createOrRetainFacet(createStorageFacetStore(storage), {
      wallet: WALLET, app: "endur", strategy: "stake", address: "0xdifferent",
      recovery: { positions: [] },
    });
    expect(later).toEqual(first);
    expect(later.address).toBe("0x5709");
  });

  it("leaves identifying fields in the clear, which is why it is not the private store", async () => {
    const storage = memoryStorage();
    createOrRetainFacet(createStorageFacetStore(storage), {
      wallet: WALLET, app: "endur", strategy: "stake", address: "0x5709",
      recovery: { positions: metadata.positions },
    });
    const persisted = [...storage.raw.values()].join("");
    // The entire record, including its recovery positions, is readable here. Sealing the whole
    // record set is required when this mapping must remain private.
    expect(persisted).toContain("0x28d7");
    expect(persisted).toContain("endur");
    expect(persisted).toContain(WALLET);
    expect([...storage.raw.keys()]).toEqual(["facet-records-v1"]);
  });

  it("saveSealedFacets writes one opaque envelope with no readable index", async () => {
    const storage = memoryStorage();
    const key = await deriveRecoveryKey(SIGNATURE, WALLET);
    const store = createMemoryFacetStore();
    createOrRetainFacet(store, {
      wallet: WALLET, app: "endur", strategy: "stake", address: "0x5709",
      recovery: { positions: [] },
    });
    await saveSealedFacets(storage, key, store.all());

    const persisted = [...storage.raw.values()].join("");
    for (const identifying of [WALLET, "endur", "stake", "0x5709"]) {
      expect(persisted).not.toContain(identifying);
    }
    expect([...storage.raw.keys()]).toEqual([SEALED_FACETS_KEY]);
    expect(await loadSealedFacets(storage, key)).toEqual(store.all());
  });

  it("distinguishes an unreadable record set from having no facets", async () => {
    const storage = memoryStorage();
    const key = await deriveRecoveryKey(SIGNATURE, WALLET);
    // A first visit is empty, not an error.
    expect(await loadSealedFacets(storage, key)).toEqual([]);
    await saveSealedFacets(storage, key, [{ key: "k" }]);
    // The wrong wallet must throw rather than report zero facets and overwrite them.
    const intruder = await deriveRecoveryKey(SIGNATURE, "0xintruder");
    await expect(loadSealedFacets(storage, intruder)).rejects.toThrow();
  });

  it("does not turn an unavailable storage area into an empty record set", async () => {
    const key = await deriveRecoveryKey(SIGNATURE, WALLET);
    const hostile: SealedRecordStorage = {
      getItem: () => { throw new Error("storage denied"); },
      setItem: () => {},
    };
    await expect(loadSealedFacets(hostile, key)).rejects.toThrow(/storage denied/);
  });

  it("rejects an authenticated but malformed record-set payload", async () => {
    const storage = memoryStorage();
    const key = await deriveRecoveryKey(SIGNATURE, WALLET);
    storage.setItem(SEALED_FACETS_KEY, await sealRecoveryRecord(key, { not: "an array" }));
    await expect(loadSealedFacets(storage, key)).rejects.toThrow(/Malformed sealed facet record set/);
  });

  it("survives a storage area that throws, because a record is a cache and not the truth", () => {
    const hostile: KeyValueStorage = {
      getItem: () => { throw new Error("private mode"); },
      setItem: () => { throw new Error("quota exceeded"); },
    };
    const store = createStorageFacetStore(hostile);
    expect(() => createOrRetainFacet(store, {
      wallet: WALLET, app: "ekubo", strategy: "swap", address: "0x1",
      recovery: { positions: [] },
    })).not.toThrow();
    expect(store.all()).toEqual([]);
  });

  it("lists a wallet's facets without leaking another wallet's", () => {
    const store = createMemoryFacetStore();
    const base = { strategy: "default", address: "0x1",
      recovery: { positions: [] } };
    createOrRetainFacet(store, { ...base, wallet: WALLET, app: "endur" });
    createOrRetainFacet(store, { ...base, wallet: WALLET, app: "ekubo" });
    createOrRetainFacet(store, { ...base, wallet: "0xother", app: "endur" });
    const retired = createOrRetainFacet(store, { ...base, wallet: WALLET, app: "retired" });
    moveFacet(store, retired, "retire");
    expect(listFacets(store, WALLET).map((record) => record.app).sort()).toEqual(["ekubo", "endur"]);
    expect(listFacets(store)).toHaveLength(3);
  });
});
