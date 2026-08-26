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
  $("bound-pill").textContent = bound ? "bound · key in memory" : "not bound";
  $("bound-pill").className = `pill ${bound ? "pill-good" : ""}`;
  $("reset").hidden = !connected;
  // Binding is only the identity boundary. Keep protocol actions disabled until the reviewed
  // derivation, note discovery, proving, and preflight path is wired to this page.
  document.querySelectorAll("[data-launch-action]").forEach((button) => {
    button.disabled = true;
  });
}

function clearSession(text = "Wallet disconnected from this launcher.") {
  session.account = null;
  session.message = null;
  session.signature = null;
  session.viewingKey = null;
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

$("connect").onclick = connect;
$("sign").onclick = sign;
$("reset").onclick = () => clearSession();

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
