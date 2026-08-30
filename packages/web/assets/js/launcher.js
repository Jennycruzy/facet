import "./theme.js";
import { createGem } from "./gem.js";
import { applicationContext, contextLabel } from "./app-context.js";

const $ = (id) => document.getElementById(id);

const data = await fetch("data/facets.json").then((response) => {
  if (!response.ok) throw new Error(`Facet configuration unavailable (${response.status}).`);
  return response.json();
});

function selectNetwork(network) {
  document.querySelectorAll("[data-network-tab]").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.networkTab === network));
  });
  document.querySelectorAll("[data-network-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.networkPanel !== network;
  });
  localStorage.setItem("facet-launch-network", network);
}
document.querySelectorAll("[data-network-tab]").forEach((tab) => {
  tab.onclick = () => selectNetwork(tab.dataset.networkTab);
});

for (const facet of data.facets) {
  const card = document.createElement("article");
  card.className = "testnet-card";
  const explorer = data.networks[facet.network].explorer;
  card.innerHTML = `<span class="pill">Sepolia</span><h3>${facet.label}</h3>
    <p>Direct Facet identity for ${facet.context ?? facet.app ?? "a test strategy"}.</p>
    <a class="btn ghost" href="${explorer}/contract/${facet.address}" target="_blank" rel="noreferrer">View account ↗</a>`;
  $("testnet-facets").append(card);
}

const networkName = "SN_MAIN";
const mainnetPool = data.networks.mainnet.pool;

function normalizeStarknetAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return null;
  try { return `0x${BigInt(value).toString(16)}`; } catch { return null; }
}

function detectReadyX(scope = window) {
  const candidates = [scope.starknet_ready, scope.starknetReady, scope.starknet]
    .filter((wallet, index, values) => wallet && typeof wallet.request === "function" && values.indexOf(wallet) === index);
  return candidates.find((wallet) => /ready/i.test(`${wallet.id ?? ""} ${wallet.name ?? ""}`))
    ?? (scope.starknet_ready && typeof scope.starknet_ready.request === "function" ? scope.starknet_ready : null);
}

const mark = createGem($("mark"), { segments: 6 });
mark.setFacets(data.facets);
mark.start();

// The connected Ready X account is held only for this page session. The persistent map below stores
// app/version metadata, never wallet signatures, private keys, or recovery secrets.
const session = {
  provider: detectReadyX(),
  account: null,
  selectedApp: null,
  state: "idle",
};

const FACET_MAP_KEY = "facet-wallet-map-v1";
function readFacetMap() {
  try { return JSON.parse(localStorage.getItem(FACET_MAP_KEY) ?? "{}"); } catch { return {}; }
}
function mapKey(appId) { return `${session.account?.toLowerCase()}:${appId}:default`; }
function retainFacet(appId) {
  const records = readFacetMap();
  const key = mapKey(appId);
  if (!records[key] || records[key].state === "retired") {
    records[key] = { app: appId, strategy: "default", version: (records[key]?.version ?? 0) + 1,
      state: "active", updatedAt: new Date().toISOString() };
    localStorage.setItem(FACET_MAP_KEY, JSON.stringify(records));
  }
  renderFacetMap();
}
function updateFacet(appId, action) {
  const records = readFacetMap();
  const key = mapKey(appId);
  const current = records[key];
  if (!current) return;
  records[key] = action === "rotate"
    ? { ...current, version: current.version + 1, state: "active", updatedAt: new Date().toISOString() }
    : { ...current, state: "retired", updatedAt: new Date().toISOString() };
  localStorage.setItem(FACET_MAP_KEY, JSON.stringify(records));
  renderFacetMap();
}
function renderFacetMap() {
  const target = $("facet-map");
  if (!session.account) { target.innerHTML = '<span class="muted">Connect a wallet to view this device\'s map.</span>'; return; }
  const records = readFacetMap();
  const rows = data.apps.map((app) => ({ app, record: records[mapKey(app.id)] })).filter(({ record }) => record);
  target.replaceChildren();
  if (!rows.length) { target.innerHTML = '<span class="muted">Choose an app to create its retained identity.</span>'; return; }
  for (const { app, record } of rows) {
    const row = document.createElement("div");
    row.className = "facet-map-row";
    row.innerHTML = `<strong>${app.name}</strong><span>version ${record.version} · ${record.state}</span>`;
    for (const action of ["rotate", "retire"]) {
      const button = document.createElement("button");
      button.type = "button"; button.textContent = action; button.disabled = record.state === "retired";
      button.onclick = () => updateFacet(app.id, action); row.append(button);
    }
    target.append(row);
  }
}

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
  const bound = connected && session.state === "bound";
  const busy = session.state === "signing";
  $("wallet-address").textContent = connected ? short(session.account) : "not connected";
  $("wallet-address").title = connected ? session.account : "";
  $("connect").disabled = !session.provider || bound || busy;
  $("connect").textContent = connected ? "Ready X connected" : "Connect Ready X";
  $("sign").hidden = true;
  $("binding-message").textContent = bound
    ? "Identity map ready. Choose an app to retain or reopen its Facet identity."
    : "Connect Ready X to open your local identity map.";
  $("copy-message").disabled = true;
  $("bound-pill").textContent = bound ? "session ready" : "not bound";
  $("bound-pill").className = `pill ${bound ? "pill-good" : ""}`;
  $("reset").hidden = !connected;
  const selected = data.apps.find((app) => app.id === session.selectedApp) ?? null;
  const context = selected ? applicationContext(selected) : null;
  const activeLaunchStep = selected ? "review" : "context";
  document.querySelectorAll("[data-launch-step]").forEach((step) => {
    const active = step.dataset.launchStep === activeLaunchStep;
    step.classList.toggle("active", active);
    if (active) step.setAttribute("aria-current", "step");
    else step.removeAttribute("aria-current");
  });
  document.querySelectorAll("[data-launch-action]").forEach((button) => {
    const isSelected = selected?.id === button.dataset.appId;
    button.disabled = false;
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
      : "Choose an identity to preview its route. Connect Ready X before approving an action.";
  renderFacetMap();
}

function clearSession(text = "Wallet disconnected from this launcher.") {
  session.account = null;
  session.selectedApp = null;
  $("copy-message-status").textContent = "";
  setStatus("idle", text);
  render();
}

async function connect() {
  if (!session.provider) {
    setStatus("error", "Ready X was not detected. Install or enable Ready X, then reload this page.");
    return;
  }
  try {
    const accounts = await session.provider.request({ type: "wallet_requestAccounts" });
    const account = normalizeStarknetAddress(Array.isArray(accounts) ? accounts[0] : null);
    if (!account) throw new Error("Ready X did not return a Starknet account.");
    const chainId = await session.provider.request({ type: "wallet_requestChainId" });
    if (!["SN_MAIN", "0X534E5F4D41494E"].includes(String(chainId).toUpperCase())) {
      throw new Error("Switch Ready X to Starknet Mainnet, then connect again.");
    }
    session.account = account;
    setStatus("bound", "Ready X connected on Starknet Mainnet. Choose an app.");
    render();
  } catch (error) {
    setStatus("error", error instanceof Error ? error.message : "Wallet connection failed.");
  }
}

function selectApp(id) {
  const app = data.apps.find((candidate) => candidate.id === id);
  if (!app) return;
  session.selectedApp = app.id;
  if (session.account && session.state === "bound") retainFacet(app.id);
  setStatus("selected", `${app.name} identity selected. Opening its Mainnet route…`);
  render();
  if (app.executionPage) window.location.assign(app.executionPage);
}

$("connect").onclick = connect;
$("reset").onclick = () => clearSession();
document.querySelectorAll("[data-launch-action]").forEach((button) => {
  button.onclick = () => selectApp(button.dataset.appId);
});

if (!session.provider) {
  setStatus("error", "Ready X was not detected. Install or enable Ready X to use Mainnet routes.");
} else {
  try {
    const accounts = await session.provider.request({ type: "wallet_requestAccounts", params: { silent_mode: true } });
    const account = normalizeStarknetAddress(Array.isArray(accounts) ? accounts[0] : null);
    if (account) {
      const chainId = await session.provider.request({ type: "wallet_requestChainId" });
      if (["SN_MAIN", "0X534E5F4D41494E"].includes(String(chainId).toUpperCase())) {
        session.account = account;
        setStatus("bound", "Ready X connected on Starknet Mainnet. Choose an app.");
      } else setStatus("error", "Switch Ready X to Starknet Mainnet, then connect again.");
    } else {
      setStatus("idle", "Ready X found. Connect it when you are ready.");
    }
  } catch {
    setStatus("idle", "Ready X found. Connect it when you are ready.");
  }
  if (typeof session.provider.on === "function") {
    session.provider.on("accountsChanged", (accounts) => {
      const next = Array.isArray(accounts) && accounts[0];
      if (!next) {
        clearSession("Wallet disconnected from this launcher.");
        return;
      }
      try {
        const account = normalizeStarknetAddress(next);
        if (!account) throw new Error("Ready X returned an invalid Starknet account.");
        if (account !== session.account) clearSession("Ready X account changed. Connect again.");
        session.account = account;
        setStatus("bound", "Ready X connected on Starknet Mainnet. Choose an app.");
        render();
      } catch (error) {
        clearSession(error instanceof Error ? error.message : "The wallet account changed.");
      }
    });
  }
}

$("network").textContent = networkName;
$("pool").textContent = mainnetPool;
selectNetwork(localStorage.getItem("facet-launch-network") === "testnet" ? "testnet" : "mainnet");
render();
