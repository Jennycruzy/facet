import "./theme.js";
import { createGem } from "./gem.js";
import { applicationContext, contextLabel } from "./app-context.js";
import { mapKey, readMap, recordActivity, retain, retireBlockedReason, move } from "./facet-map.js";
import { createChain } from "./chain.js";
import { detectReadyX, errorText, formatUnits } from "./route-runtime.js";
import { loadPortfolio } from "./portfolio.js";

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
  try { localStorage.setItem("facet-launch-network", network); } catch { /* private mode */ }
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
const mainnetAnonymizer = data.networks.mainnet.anonymizer;
const chain = createChain(data.networks);

function normalizeStarknetAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return null;
  try { return `0x${BigInt(value).toString(16)}`; } catch { return null; }
}

const mark = createGem($("mark"), { segments: 6 });
mark.setFacets(data.facets);
mark.start();

// The connected Ready X account is held only for this page session. The local activity map stores
// app/version metadata and confirmed activity, never wallet signatures, commitments, private keys,
// viewing keys or recovery secrets. The portfolio reader below obtains live values independently.
const session = {
  provider: detectReadyX(),
  account: null,
  selectedApp: null,
  portfolio: null,
  state: "idle",
};

const key = (appId) => mapKey(session.account, appId);

function retainFacet(appId) {
  retain(session.account, appId);
  renderFacetMap();
  renderPortfolio();
}

function updateFacet(appId, action) {
  const records = readMap();
  const record = records[key(appId)];
  if (!record) return;
  if (action === "retire") {
    const blocked = retireBlockedReason(record);
    if (blocked) { setStatus("error", blocked); renderFacetMap(); renderPortfolio(); return; }
    move(session.account, appId, "retire");
  } else {
    // A new local version retires the old record, then retains the same app again.
    if (!retireBlockedReason(record)) move(session.account, appId, "retire");
    else { setStatus("error", retireBlockedReason(record)); renderFacetMap(); renderPortfolio(); return; }
    retain(session.account, appId);
  }
  renderFacetMap();
  renderPortfolio();
}

function amountText(value, symbol) {
  try { return `${formatUnits(BigInt(value), 18, 8)} ${symbol}`; }
  catch { return `— ${symbol}`; }
}

function appendKv(container, label, value, className = "") {
  const key = document.createElement("span");
  key.textContent = label;
  const content = document.createElement("strong");
  content.textContent = value;
  if (className) content.className = className;
  container.append(key, content);
}

function portfolioPositionText(entry, app) {
  const positions = entry.chain?.positions ?? [];
  if (positions.length) return positions.map((position) => amountText(position.amount, position.symbol)).join(", ");
  const cached = entry.cached?.chain?.positions ?? entry.cached?.positions ?? [];
  if (cached.length) return `${cached.map((position) => position.symbol ?? position.asset).join(", ")} (cached)`;
  if (entry.chain && !entry.chain.isDeployed) return "No public balance · account not deployed";
  if (entry.chain) return "No public position observed";
  if (app.id === "endur") return "xSTRK position not discovered";
  return "No direct facet account discovered";
}

function portfolioRecoveryText(entry) {
  const positions = entry.chain?.positions ?? entry.cached?.chain?.positions ?? entry.cached?.positions ?? [];
  const hasPersistent = positions.some((position) =>
    position.kind === "exit-required" || position.symbol === "xSTRK",
  );
  if (hasPersistent) return "Exit required · Ekubo exit route";
  if (entry.chain) return "Fungible balances can settle back to shielded notes";
  if (entry.capability?.status === "not-registered") return "Register the private identity before discovery";
  if (entry.capability?.status === "available") return "Direct account available; chain read needs refresh";
  return "Wallet-mediated route · direct account discovery unavailable";
}

function renderPortfolio() {
  const target = $("portfolio-list");
  const status = $("portfolio-status");
  if (!target || !status) return;
  if (!session.account) {
    status.textContent = "Connect Ready X to read the private portfolio.";
    target.innerHTML = '<span class="muted">No wallet-connected portfolio is loaded.</span>';
    return;
  }
  if (!session.portfolio) {
    status.textContent = "Waiting for the first chain-backed refresh…";
    target.innerHTML = '<span class="muted">The launcher will read private balances and app contexts after connection.</span>';
    return;
  }

  const portfolio = session.portfolio;
  const parts = [];
  const root = document.createElement("div");
  root.className = "portfolio-root";
  const rootHead = document.createElement("div");
  rootHead.className = "portfolio-root-head";
  const rootTitle = document.createElement("strong");
  rootTitle.textContent = "Private balance";
  const rootPill = document.createElement("span");
  rootPill.className = `pill ${portfolio.privateBalanceError ? "" : "pill-good"}`;
  rootPill.textContent = portfolio.privateBalanceError ? "read needs attention" : "live wallet read";
  rootHead.append(rootTitle, rootPill);
  root.append(rootHead);
  const balances = document.createElement("div");
  balances.className = "portfolio-balances";
  const nonZero = portfolio.assets.filter(({ token }) => BigInt(portfolio.privateBalances[token] ?? "0") > 0n);
  if (nonZero.length) {
    for (const asset of nonZero) {
      const item = document.createElement("span");
      item.textContent = amountText(portfolio.privateBalances[asset.token], asset.symbol);
      balances.append(item);
    }
  } else {
    const empty = document.createElement("span");
    empty.textContent = "No non-zero private balance returned";
    balances.append(empty);
  }
  root.append(balances);
  if (portfolio.privateBalanceError) {
    const warning = document.createElement("small");
    warning.className = "portfolio-warning";
    warning.textContent = portfolio.privateBalanceError;
    root.append(warning);
  }
  parts.push(root);

  for (const entry of portfolio.facets) {
    const app = data.apps.find((candidate) => candidate.id === entry.appId);
    if (!app) continue;
    const card = document.createElement("article");
    card.className = `portfolio-facet accent-${app.accent ?? "sapphire"}`;
    const head = document.createElement("div");
    head.className = "portfolio-facet-head";
    const title = document.createElement("strong");
    title.textContent = app.name;
    const state = document.createElement("span");
    state.className = "pill";
    state.textContent = entry.cached?.state ?? "not started";
    head.append(title, state);
    card.append(head);
    const details = document.createElement("div");
    details.className = "portfolio-kv";
    appendKv(details, "context", `${entry.context.dappName} · nonce ${entry.context.nonce}`);
    if (entry.chain) {
      appendKv(details, "account", entry.chain.address, entry.chain.isDeployed ? "portfolio-live" : "");
      appendKv(details, "public balances", portfolioPositionText(entry, app));
      appendKv(details, "observation", entry.chain.isDeployed ? "chain · deployed" : "chain · deterministic / undeployed");
    } else if (entry.cached?.chain?.address) {
      appendKv(details, "account", `${entry.cached.chain.address} · cached`, "portfolio-stale");
      appendKv(details, "public balances", portfolioPositionText(entry, app), "portfolio-stale");
      appendKv(details, "observation", "cached · refresh unavailable", "portfolio-stale");
    } else {
      appendKv(details, "account", entry.capability?.status === "available" ? "discovery available" : "wallet-managed route");
      appendKv(details, "public balances", portfolioPositionText(entry, app));
      appendKv(details, "observation", entry.capability?.reason ?? "No direct account observation");
    }
    appendKv(details, "recoverability", portfolioRecoveryText(entry));
    card.append(details);
    if (app.id === "endur") {
      const exit = document.createElement("a");
      exit.className = "portfolio-link";
      exit.href = "/ekubo-exit";
      exit.textContent = "Open exit route →";
      card.append(exit);
    }
    parts.push(card);
  }
  target.replaceChildren(...parts);
  const chainCount = portfolio.facets.filter((entry) => entry.chain).length;
  status.textContent = `${chainCount}/${portfolio.facets.length} app contexts reconciled from chain · refreshed ${new Date(portfolio.refreshedAt).toLocaleTimeString()}`;
}

const STATE_COPY = {
  launch: "launched · no Mainnet action yet",
  use: "in use · settled back to shielded notes",
  hold: "holding a position that needs an explicit exit",
  recover: "recovered · position exited into shielded notes",
  retire: "retired",
};

function renderFacetMap() {
  const target = $("facet-map");
  if (!session.account) {
    target.innerHTML = '<span class="muted">Connect a wallet to view this device\'s activity record.</span>';
    return;
  }
  const records = readMap();
  const rows = data.apps.map((app) => ({ app, record: records[key(app.id)] })).filter(({ record }) => record);
  target.replaceChildren();
  if (!rows.length) {
    target.innerHTML = '<span class="muted">Choose an app to create its local activity record.</span>';
    return;
  }
  for (const { app, record } of rows) {
    const row = document.createElement("div");
    row.className = "facet-map-row";
    const held = record.positions.map((position) => position.symbol ?? position.asset).join(", ");
    const hashes = record.transactions.slice(-3).map((entry) =>
      `<a href="https://voyager.online/tx/${encodeURIComponent(entry.hash)}" target="_blank" rel="noreferrer">${entry.action} ${entry.hash.slice(0, 10)}…</a>`,
    ).join(" ");
    row.innerHTML = `<strong>${app.name}</strong>`
      + `<span>version ${record.version} · <em>${record.state}</em> — ${STATE_COPY[record.state] ?? ""}</span>`
      + (held ? `<span class="muted">holds ${held}</span>` : "")
      + (hashes ? `<span class="muted">${hashes}</span>` : "");
    for (const action of ["rotate", "retire"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action === "rotate" ? "new local version" : "retire record";
      const blocked = retireBlockedReason(record);
      button.disabled = record.state === "retire" || Boolean(blocked);
      if (blocked) button.title = blocked;
      button.onclick = () => updateFacet(app.id, action);
      row.append(button);
    }
    target.append(row);
  }
}

async function refreshPortfolio() {
  if (!session.account || !session.provider) return;
  setStatus("signing", "Reading private balances and reconciling app contexts…");
  render();
  try {
    session.portfolio = await loadPortfolio({
      wallet: session.provider,
      chain,
      anonymizer: mainnetAnonymizer,
      apps: data.apps,
      strk: data.strk,
      account: session.account,
    });
    const chainCount = session.portfolio.facets.filter((entry) => entry.chain).length;
    const privateReadOk = !session.portfolio.privateBalanceError;
    setStatus(
      privateReadOk ? "bound" : "error",
      privateReadOk
        ? `Portfolio refreshed: ${chainCount} app context${chainCount === 1 ? "" : "s"} reconciled from Mainnet.`
        : "Portfolio refreshed, but the private balance read needs attention.",
    );
  } catch (error) {
    session.portfolio = null;
    setStatus("error", `Portfolio refresh failed: ${errorText(error)}`);
  }
  render();
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
    ? "Local activity ready. Choose an app to open its reviewed route."
    : "Connect Ready X to open your local activity record.";
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
    ? `${selected.name} selected. Local ${contextLabel(context)} is retained for this app; no transaction was prepared.`
    : bound
      ? "Choose an application route. Selection only previews the next step; no transaction is prepared."
      : "Choose an app to preview its route. Connect Ready X before approving an action.";
  renderFacetMap();
  renderPortfolio();
}

function clearSession(text = "Wallet disconnected from this launcher.") {
  session.account = null;
  session.selectedApp = null;
  session.portfolio = null;
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
    await refreshPortfolio();
  } catch (error) {
    setStatus("error", error instanceof Error ? error.message : "Wallet connection failed.");
  }
}

function selectApp(id) {
  const app = data.apps.find((candidate) => candidate.id === id);
  if (!app) return;
  session.selectedApp = app.id;
  if (session.account && session.state === "bound") retainFacet(app.id);
  setStatus("selected", `${app.name} selected. Opening its Mainnet route…`);
  render();
  if (app.executionPage) window.location.assign(app.executionPage);
}

$("connect").onclick = connect;
$("reset").onclick = () => clearSession();
if ($("refresh-portfolio")) $("refresh-portfolio").onclick = () => { void refreshPortfolio(); };
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
        session.portfolio = null;
        setStatus("bound", "Ready X connected on Starknet Mainnet. Choose an app.");
        render();
        void refreshPortfolio();
      } catch (error) {
        clearSession(error instanceof Error ? error.message : "The wallet account changed.");
      }
    });
  }
}

$("network").textContent = networkName;
$("pool").textContent = mainnetPool;
let storedNetwork = "mainnet";
try { storedNetwork = localStorage.getItem("facet-launch-network") === "testnet" ? "testnet" : "mainnet"; } catch { /* private mode */ }
selectNetwork(storedNetwork);
render();
if (session.account) await refreshPortfolio();
