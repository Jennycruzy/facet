import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { exitRoutesFromCatalogue, runCompatibleApp, runPersistentApp } from "../examples/compatible-app.js";
import {
  deriveRecoveryKey, loadSealedFacets, SEALED_FACETS_KEY,
  type FacetRecord, type SealedRecordStorage,
} from "../src/index.js";

const STRK = "0x200";
const XSTRK = "0x500";
const HELPER = "0x400";
const OWNER = "0xabc";

describe("compatible application example", () => {
  it("uses the public intent-to-executor boundary and returns the wallet hash", async () => {
    const request = vi.fn().mockResolvedValue({ transaction_hash: "0xexample" });
    const result = await runCompatibleApp({
      wallet: { request }, owner: OWNER, token: STRK, applicationToken: XSTRK,
      helper: HELPER, amount: 9n, maxAmount: 100n,
    });

    expect(result).toEqual({ transactionHash: "0xexample" });
    expect(request).toHaveBeenCalledWith({
      type: "wallet_strk20InvokeTransaction",
      params: { actions: [
        { type: "withdraw", token: STRK, amount: "0x9", recipient: HELPER },
        { type: "transfer", token: XSTRK, amount: "OPEN", recipient: OWNER },
        { type: "invoke", contract: HELPER, calldata: [
          "0x0", STRK, XSTRK, "0x9", "0x0", "${openNoteIds[0]}",
        ] },
      ] },
    });
  });
});

describe("persistent third-party integration", () => {
  const MAINNET_XSTRK = "0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a";
  const catalogue = JSON.parse(
    readFileSync(new URL("../../web/data/facets.json", import.meta.url), "utf8"),
  ) as { apps?: readonly unknown[] };

  function memoryStorage(): SealedRecordStorage & { raw: Map<string, string> } {
    const raw = new Map<string, string>();
    return { raw, getItem: (k) => raw.get(k) ?? null, setItem: (k, v) => { raw.set(k, v); } };
  }

  const config = (storage: SealedRecordStorage) => ({
    wallet: { request: vi.fn().mockResolvedValue({ transaction_hash: "0xexample" }) },
    owner: OWNER, token: STRK, applicationToken: MAINNET_XSTRK, helper: HELPER,
    amount: 9n, maxAmount: 100n,
    storage, walletSecret: "0xsignature", appId: "endur",
    exitRoutes: exitRoutesFromCatalogue(catalogue),
  });

  it("persists the facet, seals its metadata, and returns a real recovery route", async () => {
    const storage = memoryStorage();
    const result = await runPersistentApp(config(storage));

    expect(result.transactionHash).toBe("0xexample");
    expect(result.facetKey).toBe("0xabc:endur:stake");
    // The xSTRK the stake produced routes to the deployed Ekubo exit, not to a dead end.
    expect(result.recovery.ready).toBe(false);
    expect(result.recovery.unsupported).toHaveLength(0);
    expect(result.recovery.viaExit[0]!.route.appId).toBe("ekubo-exit");

    // Nothing identifying may survive outside the envelope. Sealing only the metadata field left
    // the wallet, the app id and the storage key itself in the clear, which protected nothing.
    const persisted = [...storage.raw.values()].join("");
    for (const secret of [OWNER, HELPER, "endur", "stake", result.facetKey]) {
      expect(persisted).not.toContain(secret);
    }
    expect([...storage.raw.keys()]).toEqual([SEALED_FACETS_KEY]);
    expect(persisted).toMatch(/^v1\./);

    // The wallet, and only the wallet, can read it back.
    const key = await deriveRecoveryKey("0xsignature", OWNER);
    const [record] = await loadSealedFacets<FacetRecord>(storage, key);
    expect(record).toMatchObject({ wallet: OWNER, app: "endur", address: HELPER });
    expect(record?.state).toBe("hold");
    expect(record?.recovery.positions).toEqual([
      { asset: MAINNET_XSTRK, kind: "xstrk" },
    ]);
    const wrongWallet = await deriveRecoveryKey("0xsignature", "0xintruder");
    await expect(loadSealedFacets(storage, wrongWallet)).rejects.toThrow();
  });

  it("retains the same facet when the wallet returns, rather than starting over", async () => {
    const storage = memoryStorage();
    const first = await runPersistentApp(config(storage));
    const second = await runPersistentApp({ ...config(storage), helper: "0x999" });
    expect(second.facetKey).toBe(first.facetKey);
    // The returning wallet keeps the identity it had, rather than being handed a new one.
    const key = await deriveRecoveryKey("0xsignature", OWNER);
    const [record] = await loadSealedFacets<FacetRecord>(storage, key);
    expect(record!.address).toBe(HELPER);
  });

  it("does not persist a held position when the protocol action fails", async () => {
    const storage = memoryStorage();
    const wallet = {
      request: vi.fn().mockRejectedValue(new Error("user rejected")),
    };
    await expect(runPersistentApp({
      wallet, owner: OWNER, token: STRK, applicationToken: MAINNET_XSTRK, helper: HELPER,
      amount: 9n, maxAmount: 100n, storage, walletSecret: "0xsignature", appId: "endur",
      exitRoutes: exitRoutesFromCatalogue(catalogue),
    })).rejects.toThrow("user rejected");
    expect([...storage.raw.keys()]).toEqual([]);
  });

  it("leaves the prior sealed record untouched when a later action fails", async () => {
    const storage = memoryStorage();
    await runPersistentApp(config(storage));
    const wallet = { request: vi.fn().mockRejectedValue(new Error("user rejected")) };
    await expect(runPersistentApp({
      wallet, owner: OWNER, token: STRK, applicationToken: MAINNET_XSTRK, helper: "0x999",
      amount: 9n, maxAmount: 100n, storage, walletSecret: "0xsignature", appId: "endur",
      exitRoutes: exitRoutesFromCatalogue(catalogue),
    })).rejects.toThrow("user rejected");
    const key = await deriveRecoveryKey("0xsignature", OWNER);
    const [record] = await loadSealedFacets<FacetRecord>(storage, key);
    expect(record?.address).toBe(HELPER);
    expect(record?.state).toBe("hold");
  });
});
