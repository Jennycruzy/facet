/*
 * Application context naming is deliberately deterministic and non-secret.
 * The user's private identity and the application namespace are combined by the
 * privacy SDK; this module only keeps the namespace stable across sessions.
 */

const APP_ID = /^[a-z][a-z0-9-]{0,31}$/;
const DAPP_NAME = /^[a-z][a-z0-9-]{0,63}$/;

export const CONTEXT_VERSION = "v1";

export function applicationContext(app) {
  if (!app || typeof app !== "object") throw new TypeError("An application is required.");
  const id = String(app.id ?? "").toLowerCase();
  if (!APP_ID.test(id)) throw new TypeError("Application id is not a valid context identifier.");

  const dappName = String(app.dappName ?? `facet-mainnet-${id}-${CONTEXT_VERSION}`).toLowerCase();
  if (!DAPP_NAME.test(dappName)) throw new TypeError("Application dapp name is not valid.");

  const nonce = app.nonce == null ? 0 : Number(app.nonce);
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    throw new RangeError("Application context nonce must be a non-negative safe integer.");
  }

  return Object.freeze({
    appId: id,
    dappName,
    nonce,
    lifecycle: "persistent",
  });
}

export function contextLabel(context) {
  if (!context || typeof context !== "object") throw new TypeError("A context is required.");
  return `${context.dappName} · nonce ${context.nonce}`;
}
