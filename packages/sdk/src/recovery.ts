/**
 * How a facet's public positions get back into the owner's shielded balance.
 *
 * {@link recoveryPlan} answers the *classification* question — which settled assets are ordinary
 * fungibles and which are persistent positions. That is enough to guard the lifecycle, but it is
 * not enough to act: knowing that xSTRK must be exited does not say through what.
 *
 * This module answers the routing question. It resolves each exit-required position against the
 * exit routes the product actually ships, so the launcher can offer "exit this, then recover"
 * instead of a dead end. An asset that no configured route closes is reported as
 * {@link RECOVERY_REQUIRES_ADAPTER} rather than being silently treated as recoverable — the
 * honest answer is that Facet cannot get it back without a new adapter.
 *
 * Routes are supplied by the caller, not hard-coded, because the deployed set lives in
 * `packages/web/data/facets.json` and is the same data the execution pages read. See
 * `docs/FINDINGS.md` §6.34 for why Endur's own redemption is a queue and the working exit is the
 * secondary market.
 */

import { recoveryPlan, type FacetPosition } from "./facets.js";
import { toHexFelt, type FeltLike } from "./gate-a.js";

/** Reported for a persistent position that no configured exit route can close. */
export const RECOVERY_REQUIRES_ADAPTER = "RECOVERY_REQUIRES_ADAPTER" as const;

export class RecoveryRouteError extends Error {
  readonly code = "recovery_requires_adapter" as const;

  constructor(readonly asset: string, message: string) {
    super(message);
    this.name = "RecoveryRouteError";
  }
}

/**
 * One configured way out of a persistent position.
 *
 * `contextApp` names the facet the route acts for: an exit is not a separate identity, it is the
 * same facet closing what it opened. `closesAssets` is the set of positions the route retires.
 */
export interface ExitRoute {
  appId: string;
  contextApp: string;
  closesAssets: readonly FeltLike[];
  outputToken: FeltLike;
  outputSymbol?: string;
}

export interface RecoveryStepAutomatic {
  status: "automatic";
  position: FacetPosition;
}

export interface RecoveryStepViaExit {
  status: "exit-required";
  position: FacetPosition;
  route: ExitRoute;
}

export interface RecoveryStepUnsupported {
  status: "unsupported";
  position: FacetPosition;
  code: typeof RECOVERY_REQUIRES_ADAPTER;
  reason: string;
}

export type RecoveryStep = RecoveryStepAutomatic | RecoveryStepViaExit | RecoveryStepUnsupported;

export interface FacetRecoveryRouting {
  /** Fungible balances that a collect policy sweeps back without any protocol call. */
  automatic: RecoveryStepAutomatic[];
  /** Positions with a configured exit route; run these before recovering. */
  viaExit: RecoveryStepViaExit[];
  /** Positions Facet cannot close today. */
  unsupported: RecoveryStepUnsupported[];
  /** Every step in one list, in the order a caller should present them. */
  steps: RecoveryStep[];
  /** True when nothing blocks recovery: no exits pending and nothing unsupported. */
  ready: boolean;
}

const asset = (value: FeltLike, label: string): string => {
  try {
    return toHexFelt(value);
  } catch {
    // A position may carry a symbol rather than an address; compare it as an opaque label.
    return String(value).trim().toLowerCase() || label;
  }
};

/**
 * Index the configured routes by the assets they close, scoped to one facet.
 *
 * A route only counts for the facet it names in `contextApp`. Without that scope an Endur exit
 * would appear to rescue an unrelated facet holding the same token, which is exactly the kind of
 * cross-facet assumption the product must not make.
 */
function routesFor(appId: string, routes: readonly ExitRoute[]): Map<string, ExitRoute> {
  const index = new Map<string, ExitRoute>();
  const wanted = appId.trim().toLowerCase();
  for (const route of routes) {
    if (route.contextApp.trim().toLowerCase() !== wanted) continue;
    for (const closes of route.closesAssets) {
      const key = asset(closes, "closed asset");
      if (!index.has(key)) index.set(key, route);
    }
  }
  return index;
}

/**
 * Resolve every position a facet holds into a concrete recovery step.
 *
 * `positions` is the facet's settled asset list; `routes` is the deployed exit catalogue. The
 * result is deliberately exhaustive — a caller can render it directly, and `ready` is the single
 * predicate that says whether recovery may proceed now.
 */
export function planFacetRecovery(
  appId: string,
  positions: readonly FacetPosition[],
  routes: readonly ExitRoute[] = [],
): FacetRecoveryRouting {
  const classified = recoveryPlan(positions);
  const index = routesFor(appId, routes);

  const automatic: RecoveryStepAutomatic[] = classified.automatic.map((position) => ({
    status: "automatic", position,
  }));
  const viaExit: RecoveryStepViaExit[] = [];
  const unsupported: RecoveryStepUnsupported[] = [];

  for (const position of classified.exitRequired) {
    const route = index.get(asset(position.asset, "position asset"));
    if (route) {
      viaExit.push({ status: "exit-required", position, route });
      continue;
    }
    unsupported.push({
      status: "unsupported",
      position,
      code: RECOVERY_REQUIRES_ADAPTER,
      reason:
        `No configured exit route closes ${position.asset} for facet ${appId}. ` +
        `Recovering it requires a new adapter.`,
    });
  }

  return {
    automatic,
    viaExit,
    unsupported,
    steps: [...viaExit, ...unsupported, ...automatic],
    ready: viaExit.length === 0 && unsupported.length === 0,
  };
}

/**
 * The same routing as a throw, for callers that want recovery to be an assertion.
 *
 * Kept separate from {@link planFacetRecovery} so the launcher can render a plan without a
 * try/catch while an automated caller still gets a hard failure.
 */
export function assertFacetRecoverable(
  appId: string,
  positions: readonly FacetPosition[],
  routes: readonly ExitRoute[] = [],
): FacetRecoveryRouting {
  const routing = planFacetRecovery(appId, positions, routes);
  const [blocked] = routing.unsupported;
  if (blocked) throw new RecoveryRouteError(String(blocked.position.asset), blocked.reason);
  const [pending] = routing.viaExit;
  if (pending) {
    throw new RecoveryRouteError(
      String(pending.position.asset),
      `Exit ${pending.position.asset} through ${pending.route.appId} before recovering facet ${appId}.`,
    );
  }
  return routing;
}

/** Read the deployed exit catalogue out of the `facets.json` app list. */
export function exitRoutesFromApps(apps: readonly {
  id: string;
  lifecycle?: { contextApp?: string; closesAssets?: readonly FeltLike[] };
  route?: { tokenOut?: FeltLike; tokenOutSymbol?: string };
}[]): ExitRoute[] {
  const routes: ExitRoute[] = [];
  for (const app of apps) {
    const contextApp = app.lifecycle?.contextApp;
    const closesAssets = app.lifecycle?.closesAssets;
    if (!contextApp || !closesAssets?.length || app.route?.tokenOut === undefined) continue;
    routes.push({
      appId: app.id,
      contextApp,
      closesAssets,
      outputToken: app.route.tokenOut,
      outputSymbol: app.route.tokenOutSymbol,
    });
  }
  return routes;
}
