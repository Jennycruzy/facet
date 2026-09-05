import "./theme.js";
import { createGem } from "./gem.js";
import { applicationContext, contextLabel } from "./app-context.js";
import {
  beginRecovery,
  clearSessionActivity,
  configureExitRoutes,
  LIFECYCLE_STATE_UNAVAILABLE,
  mapKey,
  readMap,
  recoveryBlockedReason,
  retain,
  retireBlockedReason,
  move,
  savePersistentActivity,
  unlockPersistentActivity,
} from "./facet-map.js";
import { createChain } from "./chain.js";
import { detectReadyX, errorText, formatUnits } from "./route-runtime.js";
import { loadPortfolio } from "./portfolio.js";

const $ = (id) => document.getElementById(id);

const data = await fetch("data/facets.json").then((response) => {
  if (!response.ok) throw new Error(`Facet configuration unavailable (${response.status}).`);
  return response.json();
});

// Give the lifecycle helpers the real exit catalogue, so a blocked recovery can name the route
// that closes the position instead of only refusing.
configureExitRoutes(data.apps);

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

// The connected Ready X account is held only for this page session. The session activity context
// stores app/version metadata and confirmed activity, never wallet signatures, commitments, private
// keys, viewing keys or recovery secrets. It is not authoritative after the tab ends; the portfolio
// reader obtains live observations independently and lifecycle controls fail closed without a record.
const session = {
  provider: detectReadyX(),
  account: null,
  selectedApp: null,
  portfolio: null,
  state: "idle",
  recovery: { vault: null, busy: false },
};

const key = (appId) => mapKey(session.account, appId);

async function persistUnlockedActivity(account = session.account) {
  const vault = session.recovery.vault;
  if (!account || session.account !== account || !vault) return true;
  const canCommit = () => session.account === account && session.recovery.vault === vault;
  try {
    const result = await savePersistentActivity(account, vault, canCommit);
    if (!canCommit()) return false;
    if (!result.saved) throw new Error("The browser rejected the encrypted recovery write.");
    vault.records = result.records;
    return true;
  } catch (error) {
    if (session.account === account) {
      setStatus("error", `Encrypted recovery was not updated: ${errorText(error)}`);
    }
    return false;
  }
}

async function retainFacet(appId) {
  const account = session.account;
  retain(account, appId);
  if (session.account !== account) {
    throw new Error("The connected wallet changed before the activity record was retained.");
  }
  if (!readMap()[key(appId)]) {
    throw new Error("This tab cannot retain lifecycle state safely; the route was not opened.");
  }
  await persistUnlockedActivity(account);
  if (session.account !== account) {
    throw new Error("The connected wallet changed before the activity record was retained.");
  }
  renderFacetMap();
  renderPortfolio();
}

async function updateFacet(appId, action) {
  const account = session.account;
  const records = readMap();
  const record = records[key(appId)];
  if (!record) {
    setStatus("error", LIFECYCLE_STATE_UNAVAILABLE);
    renderFacetMap();
    renderPortfolio();
    return;
  }
  if (action === "recover") {
    const blocked = recoveryBlockedReason(record);
    if (blocked) { setStatus("error", blocked); renderFacetMap(); renderPortfolio(); return; }
    try { beginRecovery(account, appId, data.apps); }
    catch (error) {
      setStatus("error", errorText(error));
      renderFacetMap();
      renderPortfolio();
      return;
    }
    const persisted = await persistUnlockedActivity(account);
    if (session.account !== account) return;
    if (persisted) {
      setStatus("bound", `${data.apps.find((app) => app.id === appId)?.name ?? "Facet"} recovery recorded.`);
    }
    renderFacetMap();
    renderPortfolio();
    return;
  }
  if (action === "retire") {
    const blocked = retireBlockedReason(record);
    if (blocked) { setStatus("error", blocked); renderFacetMap(); renderPortfolio(); return; }
    move(account, appId, "retire", data.apps);
  } else {
    // A new local version retires the old record, then retains the same app again.
    if (!retireBlockedReason(record)) move(account, appId, "retire", data.apps);
    else { setStatus("error", retireBlockedReason(record)); renderFacetMap(); renderPortfolio(); return; }
    retain(account, appId);
  }
  await persistUnlockedActivity(account);
  if (session.account !== account) return;
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

function sameAsset(left, right) {
  try { return BigInt(left) === BigInt(right); }
  catch { return String(left).toLowerCase() === String(right).toLowerCase(); }
}

function hasUnresolvedObservedPosition(entry) {
  const observed = entry.chain?.positions;
  const local = entry.cached?.positions;
  if (!Array.isArray(observed) || !Array.isArray(local)) return false;
  return observed.some((position) => {
    const observedAsset = position?.asset ?? position?.token;
    if (observedAsset == null) return true;
    return !local.some((candidate) => sameAsset(observedAsset, candidate.asset));
  });
}

function portfolioRecoveryText(entry) {
  if (!entry.cached || !Array.isArray(entry.cached.positions)) {
    return session.recovery.vault
      ? "No lifecycle activity has been recorded for this app"
      : "Encrypted activity locked · unlock above to restore it";
  }
  if (!session.recovery.vault) {
    return "Tab activity only · unlock recovery to save it across sessions";
  }
  if (hasUnresolvedObservedPosition(entry)) {
    return "Chain position is not represented in lifecycle state · restore or unlock the private record";
  }
  const positions = entry.cached.positions;
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
    state.textContent = entry.cached?.state ?? (session.recovery.vault ? "not started" : "activity locked");
    if (!entry.cached) state.className = "pill portfolio-stale";
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
      appendKv(details, "account", entry.capability?.status === "available"
        ? "direct account discovery available"
        : "direct account not discoverable");
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
  const refreshed = new Date(portfolio.refreshedAt).toLocaleTimeString();
  const capabilityStates = new Set(portfolio.facets.map((entry) => entry.capability?.status));
  let directAccountStatus = `${chainCount}/${portfolio.facets.length} direct app accounts refreshed`;
  if (chainCount === portfolio.facets.length) {
    directAccountStatus = `${chainCount} direct app accounts refreshed`;
  } else if (capabilityStates.size === 1 && capabilityStates.has("unavailable")) {
    directAccountStatus = "optional direct app-account discovery is not exposed by Ready X";
  } else if (capabilityStates.size === 1 && capabilityStates.has("not-registered")) {
    directAccountStatus = "private app identities are not registered for direct discovery";
  } else if (capabilityStates.has("available")) {
    directAccountStatus = "direct app-account discovery needs attention";
  }
  status.textContent = `Private balances refreshed · ${directAccountStatus} · ${refreshed}`;
}

const STATE_COPY = {
  launch: "launched · no Mainnet action yet",
  use: "in use · settled back to shielded notes",
  hold: "holding a position that needs an explicit exit",
  recover: "recovery recorded · ready to retire",
  retire: "retired",
};

function renderFacetMap() {
  const target = $("facet-map");
  if (!session.account) {
    target.innerHTML = '<span class="muted">Connect a wallet to view this tab\'s activity context.</span>';
    return;
  }
  const records = readMap();
  const rows = data.apps
    .filter((app) => !app.lifecycle?.contextApp)
    .map((app) => ({ app, record: records[key(app.id)] ?? null }));
  target.replaceChildren();
  for (const { app, record } of rows) {
    const row = document.createElement("div");
    row.className = "facet-map-row";
    const summary = document.createElement("div");
    summary.className = "facet-map-summary";
    const title = document.createElement("strong");
    title.textContent = app.name;
    const state = document.createElement("span");
    state.className = "facet-map-state";
    summary.append(title, state);
    const details = document.createElement("div");
    details.className = "facet-map-details";
    if (!record) {
      state.textContent = session.recovery.vault ? "not started" : "encrypted activity locked";
      const explanation = document.createElement("span");
      explanation.textContent = session.recovery.vault
        ? "No lifecycle activity has been recorded for this app yet."
        : "Unlock recovery above to restore cross-session lifecycle activity.";
      details.append(explanation);
    } else {
      const held = record.positions.map((position) => position.symbol ?? position.asset).join(", ");
      state.textContent = `${record.state} · version ${record.version}`;
      const explanation = document.createElement("span");
      explanation.textContent = STATE_COPY[record.state] ?? "";
      details.append(explanation);
      if (held) {
        const positions = document.createElement("span");
        positions.textContent = `Holds ${held}`;
        details.append(positions);
      }
      if (record.transactions.length) {
        const transactions = document.createElement("span");
        transactions.className = "facet-map-transactions";
        for (const entry of record.transactions.slice(-3)) {
          const link = document.createElement("a");
          link.href = `https://voyager.online/tx/${encodeURIComponent(entry.hash)}`;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.textContent = `${entry.action} ${entry.hash.slice(0, 10)}…`;
          transactions.append(link);
        }
        details.append(transactions);
      }
    }
    row.append(summary, details);
    const actionGroup = document.createElement("div");
    actionGroup.className = "facet-map-actions";
    if (!session.recovery.vault) {
      const unlock = document.createElement("button");
      unlock.type = "button";
      unlock.textContent = "Unlock encrypted activity";
      unlock.onclick = () => {
        $("recovery-secret")?.focus();
        $("recovery-box")?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
      };
      actionGroup.append(unlock);
      row.append(actionGroup);
      target.append(row);
      continue;
    }
    if (!record) {
      const note = document.createElement("span");
      note.textContent = "Created automatically after your first confirmed app action.";
      actionGroup.append(note);
      row.append(actionGroup);
      target.append(row);
      continue;
    }
    const actions = [
      ...(record.state === "use" || record.state === "hold" ? ["recover"] : []),
      "rotate",
      "retire",
    ];
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action === "recover"
        ? "enter recovery"
        : action === "rotate" ? "new local version" : "retire record";
      const blocked = action === "recover" ? recoveryBlockedReason(record) : retireBlockedReason(record);
      button.disabled = record.state === "retire" || Boolean(blocked);
      if (blocked) button.title = blocked;
      button.onclick = () => updateFacet(app.id, action);
      actionGroup.append(button);
    }
    row.append(actionGroup);
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

function recoveryMessage() {
  if (session.recovery.busy) return "Opening the encrypted recovery envelope…";
  if (session.recovery.vault) {
    return session.recovery.vault.configured
      ? "Encrypted recovery is unlocked for this tab. The key is held only in memory."
      : "Recovery is ready, but no record has been sealed yet. Save it after a confirmed action.";
  }
  const passphraseLength = $("recovery-secret")?.value.trim().length ?? 0;
  return session.account
    ? passphraseLength > 0 && passphraseLength < 16
      ? `${16 - passphraseLength} more character${16 - passphraseLength === 1 ? "" : "s"} required.`
      : passphraseLength >= 16
        ? "Ready to unlock an existing record or create encrypted recovery on this device."
        : "Locked. Enter a passphrase of at least 16 characters to unlock or create recovery."
    : "Connect Ready X before unlocking encrypted recovery.";
}

function recoveryErrorText(error) {
  const detail = errorText(error);
  // WebCrypto reports a wrong AES-GCM key as a DOMException with no enumerable fields, which the
  // generic route formatter represents as "{}". Give the user a useful failure without revealing
  // whether the envelope exists or which part of the key derivation failed.
  return detail === "{}" ? "The passphrase did not open the encrypted recovery envelope." : detail;
}

function renderRecoveryControls() {
  const input = $("recovery-secret");
  const unlock = $("recovery-unlock");
  const lock = $("recovery-lock");
  const status = $("recovery-status");
  const requirement = $("recovery-requirement");
  if (!input || !unlock || !lock || !status) return;
  const unlocked = Boolean(session.recovery.vault);
  const passphraseLength = input.value.trim().length;
  input.disabled = !session.account || session.recovery.busy || unlocked;
  unlock.hidden = unlocked;
  unlock.disabled = !session.account || session.recovery.busy || passphraseLength < 16;
  lock.hidden = !unlocked;
  lock.disabled = session.recovery.busy;
  if (requirement) {
    requirement.textContent = unlocked ? "unlocked for this tab"
      : passphraseLength ? `${Math.min(passphraseLength, 16)} / 16 minimum` : "16 characters minimum";
  }
  status.textContent = recoveryMessage();
}

async function unlockRecovery() {
  if (!session.account || session.recovery.busy) return;
  const account = session.account;
  const input = $("recovery-secret");
  const passphrase = input?.value ?? "";
  if (passphrase.trim().length < 16) {
    setStatus("error", "Use a recovery passphrase of at least 16 characters.");
    renderRecoveryControls();
    return;
  }
  session.recovery.busy = true;
  setStatus("signing", "Deriving the recovery key locally; nothing is sent to Facet or Ready X…");
  renderRecoveryControls();
  try {
    const vault = await unlockPersistentActivity(account, passphrase,
      () => session.account === account);
    if (session.account !== account) return;
    session.recovery.vault = vault;
    const hasCurrentActivity = Object.values(readMap()).some((record) =>
      typeof record.wallet === "string" && record.wallet.toLowerCase() === account.toLowerCase());
    if (!vault.configured && hasCurrentActivity) {
      const saved = await savePersistentActivity(account, vault,
        () => session.account === account && session.recovery.vault === vault);
      if (session.account !== account) return;
      if (!saved.saved) throw new Error("Encrypted recovery could not be written in this browser.");
      vault.records = saved.records;
      vault.configured = true;
    }
    setStatus(
      "bound",
      vault.configured
        ? "Encrypted recovery unlocked. Restored lifecycle state is now available."
        : "Encrypted recovery prepared. No saved records exist for this passphrase yet.",
    );
    await refreshPortfolio();
  } catch (error) {
    if (session.account === account) {
      session.recovery.vault = null;
      setStatus("error", `Encrypted recovery stayed locked: ${recoveryErrorText(error)}`);
    }
  } finally {
    // Do not leave the passphrase in an input, autofill value, or page-visible DOM state.
    if (input) input.value = "";
    session.recovery.busy = false;
    render();
  }
}

function lockRecovery() {
  if (!session.account) return;
  clearSessionActivity(session.account);
  session.recovery.vault = null;
  session.recovery.busy = false;
  setStatus("bound", "Encrypted recovery locked. Lifecycle state is unavailable until it is unlocked again.");
  render();
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
    ? session.recovery.vault
      ? "Private portfolio ready. Encrypted recovery is unlocked for this tab; controls still fail closed on unresolved chain observations."
      : "Private portfolio ready. Activity is tab-only until you unlock encrypted recovery; lifecycle controls stay disabled until it is unlocked."
    : "Connect Ready X to open the tab activity context or unlock encrypted recovery.";
  $("copy-message").disabled = true;
  $("bound-pill").textContent = bound ? "session ready" : "not bound";
  $("bound-pill").className = `pill ${bound ? "pill-good" : ""}`;
  $("reset").hidden = !connected;
  renderRecoveryControls();
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
  if (session.account) clearSessionActivity(session.account);
  session.account = null;
  session.selectedApp = null;
  session.portfolio = null;
  session.recovery.vault = null;
  session.recovery.busy = false;
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

async function selectApp(id) {
  const app = data.apps.find((candidate) => candidate.id === id);
  if (!app) return;
  session.selectedApp = app.id;
  if (session.account && session.state === "bound") {
    try { await retainFacet(app.id); }
    catch (error) {
      setStatus("error", errorText(error));
      render();
      return;
    }
  }
  setStatus("selected", `${app.name} selected. Opening its Mainnet route…`);
  render();
  if (app.executionPage) window.location.assign(app.executionPage);
}

$("connect").onclick = connect;
$("reset").onclick = () => clearSession();
if ($("refresh-portfolio")) $("refresh-portfolio").onclick = () => { void refreshPortfolio(); };
if ($("recovery-secret")) $("recovery-secret").oninput = () => renderRecoveryControls();
if ($("recovery-form")) $("recovery-form").onsubmit = (event) => {
  event.preventDefault();
  if (!$("recovery-unlock")?.disabled) void unlockRecovery();
};
if ($("recovery-lock")) $("recovery-lock").onclick = () => lockRecovery();
document.querySelectorAll("[data-launch-action]").forEach((button) => {
  button.onclick = () => { void selectApp(button.dataset.appId); };
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
