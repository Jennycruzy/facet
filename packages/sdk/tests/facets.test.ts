import { describe, expect, it } from "vitest";
import {
  beginFacetRecovery,
  createOrRetainFacet,
  moveFacet,
  recoveryPlan,
  retireFacet,
  type FacetRecord,
} from "../src/index.js";

class MemoryStore {
  records = new Map<string, FacetRecord>();
  get(key: string) { return this.records.get(key) ?? null; }
  set(record: FacetRecord) { this.records.set(record.key, record); }
}

describe("persistent facet lifecycle", () => {
  it("retains one deterministic facet per wallet, app, and strategy", () => {
    const store = new MemoryStore();
    const input = { wallet: "0xABC", app: "Ekubo", strategy: "swap", address: "0x123",
      recovery: { positions: [] } };
    const first = createOrRetainFacet(store, input);
    expect(createOrRetainFacet(store, { ...input, address: "0x999" })).toEqual(first);
    expect(first.key).toBe("0xabc:ekubo:swap");
  });

  it("enforces the full lifecycle", () => {
    const store = new MemoryStore();
    let facet = createOrRetainFacet(store, { wallet: "0x1", app: "endur", strategy: "stake",
      address: "0x2", recovery: { positions: [] } });
    for (const state of ["use", "hold", "recover", "retire"] as const) facet = moveFacet(store, facet, state);
    expect(facet.state).toBe("retire");
    expect(() => moveFacet(store, facet, "use")).toThrow(/Invalid facet lifecycle/);
  });

  it("auto-recovers only ordinary fungible deltas", () => {
    const plan = recoveryPlan([
      { asset: "STRK", kind: "fungible", amount: "5" },
      { asset: "xSTRK", kind: "xstrk", amount: "4" },
      { asset: "position-1", kind: "lp" },
    ]);
    expect(plan.automatic.map((position) => position.asset)).toEqual(["STRK"]);
    expect(plan.exitRequired.map((position) => position.asset)).toEqual(["xSTRK", "position-1"]);
  });

  it("requires persistent positions to exit before recovery or retirement", () => {
    const store = new MemoryStore();
    let facet = createOrRetainFacet(store, { wallet: "0x3", app: "endur", strategy: "stake",
      address: "0x4", recovery: { positions: [
        { asset: "xSTRK", kind: "xstrk" },
      ] } });
    facet = moveFacet(store, facet, "use");
    facet = moveFacet(store, facet, "hold");

    expect(() => beginFacetRecovery(store, facet)).toThrow(/exit xSTRK through its protocol/);
    const recovering = { ...facet, state: "recover" as const };
    store.set(recovering);
    expect(() => retireFacet(store, recovering)).toThrow(/recover xSTRK first/);
    expect(store.get(facet.key)?.state).toBe("recover");
  });

  it("supports a clean recovery and retirement through the public helpers", () => {
    const store = new MemoryStore();
    let facet = createOrRetainFacet(store, { wallet: "0x5", app: "swap", strategy: "default",
      address: "0x6", recovery: { positions: [] } });
    facet = moveFacet(store, facet, "use");
    facet = beginFacetRecovery(store, facet);
    expect(facet.state).toBe("recover");
    facet = retireFacet(store, facet);
    expect(facet.state).toBe("retire");
  });
});
