import { createGem } from "./gem.js";
import {
  canonicalWalletBindingMessage,
  detectEoaProvider,
  normalizeEoaAddress,
  readEoaAccounts,
  requestEoaAccount,
  signWalletBinding,
} from "./wallet-binding.js";
import { deriveViewingKeyFromSignature } from "./wallet-derivation.js";
import { applicationContext, contextLabel } from "./app-context.js";

const $ = (id) => document.getElementById(id);

const data = await fetch("data/facets.json").then((response) => {
  if (!response.ok) throw new Error(`Facet configuration unavailable (${response.status}).`);
  return response.json();
});

const networkName = `SN_${data.deployment.network.toUpperCase()}`;
const bindingContext = {
  network: networkName,
  pool: data.deployment.pool,
  origin: window.location.origin,
};

const mark = createGem($("mark"), { segments: 6 });
mark.setFacets(data.facets);
mark.start();

// The signature and derived viewing key are intentionally held only in this module's live session
// object. They are never put in localStorage, sessionStorage, the URL, the DOM, or a log. A refresh
// asks the wallet again.
const session = {
  provider: detectEoaProvider(),
  account: null,
  message: null,
  signature: null,
  viewingKey: null,
  selectedApp: null,
  state: "idle",
};

function setStatus(state, text) {
  session.state = state;
  $("wallet-status").dataset.state = state;
  $("wallet-status-text").textContent = text;
}

function short(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "not connected";
}

function render() {
  const connected = Boolean(session.account);
  const bound = Boolean(session.signature && session.viewingKey !== null);
  const busy = session.state === "signing";
  $("wallet-address").textContent = connected ? short(session.account) : "not connected";
  $("wallet-address").title = connected ? session.account : "";
  $("connect").disabled = !session.provider || bound || busy;
  $("connect").textContent = connected ? "Wallet connected" : "Connect EOA wallet";
  $("sign").disabled = !connected || bound || busy;
  $("sign").textContent = bound ? "Binding signed" : "Sign binding message";
  $("binding-message").textContent = session.message ??
    "Connect an EOA wallet to preview the exact message. Nothing is signed on page load.";
  $("copy-message").disabled = !session.message;
  $("bound-pill").textContent = bound ? "bound · key in memory" : "not bound";
  $("bound-pill").className = `pill ${bound ? "pill-good" : ""}`;
  $("reset").hidden = !connected;
  const selected = data.apps.find((app) => app.id === session.selectedApp) ?? null;
  const context = selected ? applicationContext(selected) : null;
  const activeQueueStep = selected ? "quote" : "context";
  document.querySelectorAll("[data-queue-step]").forEach((step) => {
    const active = step.dataset.queueStep === activeQueueStep;
    step.classList.toggle("active", active);
    if (active) step.setAttribute("aria-current", "step");
    else step.removeAttribute("aria-current");
  });
  document.querySelectorAll("[data-launch-action]").forEach((button) => {
    const isSelected = selected?.id === button.dataset.appId;
    button.disabled = !bound;
    button.setAttribute("aria-pressed", String(isSelected));
    button.classList.toggle("selected", isSelected);
  });
  $("context-detail").hidden = !context;
  if (context) {
    $("context-dapp").textContent = context.dappName;
    $("context-nonce").textContent = String(context.nonce);
  }
  $("selection-note").textContent = selected
    ? `${selected.name} selected. ${contextLabel(context)} is retained for this application; no transaction was prepared.`
    : bound
      ? "Choose an application context. Selection only previews the next step; no transaction is prepared."
      : "Sign the binding message to choose an application context. No transaction is prepared here.";
}

function clearSession(text = "Wallet disconnected from this launcher.") {
  session.account = null;
  session.message = null;
  session.signature = null;
  session.viewingKey = null;
  session.selectedApp = null;
  $("copy-message-status").textContent = "";
  setStatus("idle", text);
  render();
}

async function connect() {
  if (!session.provider) {
    setStatus("error", "No EOA wallet detected. Install an EIP-1193 wallet to continue.");
    return;
  }
  try {
    const account = await requestEoaAccount(session.provider);
    session.account = account;
    session.message = canonicalWalletBindingMessage({ ...bindingContext, wallet: account });
    setStatus("connected", "Wallet connected. Read the message before signing.");
    render();
  } catch (error) {
    setStatus("error", error instanceof Error ? error.message : "Wallet connection failed.");
  }
}

async function sign() {
  if (!session.provider || !session.account || !session.message) return;
  try {
    setStatus("signing", "Waiting for the wallet to approve the binding message…");
    render();
    const signature = await signWalletBinding(session.provider, session.account, session.message);
    // Derive and retain the viewing key only in this live module session. Never render or log it.
    const viewingKey = deriveViewingKeyFromSignature(signature);
    session.signature = signature;
    session.viewingKey = viewingKey;
    setStatus("bound", "Wallet bound. Viewing key derived in memory; no transaction was authorized.");
    render();
  } catch (error) {
    session.signature = null;
    session.viewingKey = null;
    setStatus("error", error instanceof Error ? error.message : "Wallet signature failed.");
    render();
  }
}

function selectApp(id) {
  if (!session.signature || session.viewingKey === null) return;
  const app = data.apps.find((candidate) => candidate.id === id);
  if (!app) return;
  session.selectedApp = app.id;
  setStatus("selected", `${app.name} selected. Opening its reviewed Mainnet route…`);
  render();
  if (app.executionPage) window.location.assign(app.executionPage);
}

async function copyMessage() {
  if (!session.message) return;
  try {
    await navigator.clipboard.writeText(session.message);
    $("copy-message-status").textContent = "copied";
  } catch {
    $("copy-message-status").textContent = "Clipboard unavailable; select the message above.";
  }
}

$("connect").onclick = connect;
$("sign").onclick = sign;
$("reset").onclick = () => clearSession();
$("copy-message").onclick = copyMessage;
document.querySelectorAll("[data-launch-action]").forEach((button) => {
  button.onclick = () => selectApp(button.dataset.appId);
});

if (!session.provider) {
  setStatus("error", "No EOA wallet detected. The launcher is preview-only until one is connected.");
} else {
  try {
    const accounts = await readEoaAccounts(session.provider);
    if (accounts[0]) {
      session.account = accounts[0];
      session.message = canonicalWalletBindingMessage({ ...bindingContext, wallet: accounts[0] });
      setStatus("connected", "Wallet already connected. Read the message before signing.");
    } else {
      setStatus("idle", "EOA wallet detected. Connect it when you are ready.");
    }
  } catch {
    setStatus("idle", "EOA wallet detected. Connect it when you are ready.");
  }
  if (typeof session.provider.on === "function") {
    session.provider.on("accountsChanged", (accounts) => {
      const next = Array.isArray(accounts) && accounts[0];
      if (!next) {
        clearSession("Wallet disconnected from this launcher.");
        return;
      }
      try {
        const account = normalizeEoaAddress(next);
        if (account !== session.account) clearSession("Wallet changed. Review and sign the new binding message.");
        session.account = account;
        session.message = canonicalWalletBindingMessage({ ...bindingContext, wallet: account });
        setStatus("connected", "Wallet changed. Read the new message before signing.");
        render();
      } catch (error) {
        clearSession(error instanceof Error ? error.message : "The wallet account changed.");
      }
    });
  }
}

$("network").textContent = networkName;
$("pool").textContent = data.deployment.pool;
render();
