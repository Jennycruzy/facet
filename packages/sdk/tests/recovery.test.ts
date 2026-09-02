import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertFacetRecoverable,
  exitRoutesFromApps,
  planFacetRecovery,
  RECOVERY_REQUIRES_ADAPTER,
  RecoveryRouteError,
  type FacetPosition,
} from "../src/index.js";

const facetsData = JSON.parse(
  readFileSync(new URL("../../web/data/facets.json", import.meta.url), "utf8"),
) as { apps: { id: string }[] };

const XSTRK = "0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a";
const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const position = (asset: string, kind: FacetPosition["kind"]): FacetPosition => ({ asset, kind });

describe("recovery routing", () => {
  it("reads the deployed exit catalogue out of the shipped app list", () => {
    const routes = exitRoutesFromApps(facetsData.apps as never);
    const exit = routes.find((route) => route.appId === "ekubo-exit");
    expect(exit).toBeDefined();
    expect(exit?.contextApp).toBe("endur");
    // The route must close the position Endur actually opens, or the launcher offers a dead end.
    expect(exit?.closesAssets.map(String).map((value) => BigInt(value))).toContain(BigInt(XSTRK));
  });

  it("routes a real xSTRK position through the configured Ekubo exit", () => {
    const routes = exitRoutesFromApps(facetsData.apps as never);
    const routing = planFacetRecovery("endur", [position(XSTRK, "exit-required")], routes);
    expect(routing.ready).toBe(false);
    expect(routing.unsupported).toHaveLength(0);
    expect(routing.viaExit).toHaveLength(1);
    expect(routing.viaExit[0]!.route.appId).toBe("ekubo-exit");
    expect(BigInt(String(routing.viaExit[0]!.route.outputToken))).toBe(BigInt(STRK));
  });

  it("compares assets numerically, so a leading zero does not lose the route", () => {
    const routes = exitRoutesFromApps(facetsData.apps as never);
    // facets.json writes 0x028d70…; the browser record writes 0x28d70…. Same asset.
    const padded = planFacetRecovery("endur", [position(`0x0${XSTRK.slice(2)}`, "exit-required")], routes);
    expect(padded.viaExit).toHaveLength(1);
  });

  it("sweeps fungible balances automatically and needs no route for them", () => {
    const routing = planFacetRecovery("ekubo", [position(STRK, "fungible")], []);
    expect(routing.ready).toBe(true);
    expect(routing.automatic).toHaveLength(1);
    expect(routing.viaExit).toHaveLength(0);
  });

  it("reports RECOVERY_REQUIRES_ADAPTER instead of pretending an unknown position is recoverable", () => {
    const routing = planFacetRecovery("endur", [position("0xdeadbeef", "lp")], []);
    expect(routing.ready).toBe(false);
    expect(routing.unsupported).toHaveLength(1);
    expect(routing.unsupported[0]!.code).toBe(RECOVERY_REQUIRES_ADAPTER);
    expect(routing.unsupported[0]!.reason).toMatch(/requires a new adapter/);
  });

  it("does not let one facet's exit route rescue another facet's position", () => {
    const routes = exitRoutesFromApps(facetsData.apps as never);
    // The Ekubo exit is scoped to the Endur facet; an unrelated facet holding xSTRK is unsupported.
    const routing = planFacetRecovery("ekubo", [position(XSTRK, "exit-required")], routes);
    expect(routing.viaExit).toHaveLength(0);
    expect(routing.unsupported[0]!.code).toBe(RECOVERY_REQUIRES_ADAPTER);
  });

  it("throws for callers that want recovery to be an assertion", () => {
    const routes = exitRoutesFromApps(facetsData.apps as never);
    expect(() => assertFacetRecoverable("endur", [position(XSTRK, "exit-required")], routes))
      .toThrow(RecoveryRouteError);
    expect(() => assertFacetRecoverable("endur", [position("0xdeadbeef", "nft")], routes))
      .toThrow(/requires a new adapter/);
    expect(assertFacetRecoverable("ekubo", [position(STRK, "fungible")], routes).ready).toBe(true);
  });
});
