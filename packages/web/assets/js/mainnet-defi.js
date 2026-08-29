const $ = (id) => document.getElementById(id);

const MAINNET_CHAIN_IDS = new Set(["SN_MAIN", "0X534E5F4D41494E"]);
const MAINNET_RPC = "https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_10";
const MAINNET_POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const AMOUNT = 100000000000000000n;
const ASSET_SELECTOR = "0x3d4060688a1800ae986e4840aebc924bb40b5bf44de4583df2257220b54b77c";
const PREVIEW_DEPOSIT_SELECTOR = "0x2152e6631b3dd14160be68ee388eeb94d1e2b02e5c1a4c6ce5da69272c5057e";
const MAX_DEPOSIT_SELECTOR = "0x2fd569757f93fe6ed633ee19eed3342f42bf8bf6cad11cc5d4e24c50e354ccd";

const data = await fetch("data/facets.json").then((response) => {
  if (!response.ok) throw new Error("Facet configuration unavailable (" + response.status + ").");
  return response.json();
});

const protocolId = new URLSearchParams(window.location.search).get("protocol")?.toLowerCase() ?? "vesu";
const app = data.apps.find((candidate) => candidate.id === protocolId);
if (!app || !["vesu", "endur"].includes(app.id)) {
  throw new Error("Choose a supported application: ?protocol=vesu or ?protocol=endur.");
}

const network = data.networks.mainnet;
const HELPER = app.helper;
const HELPER_CLASS_HASH = app.helperClassHash;
const OUTPUT_TOKEN = app.outputToken;
const OUTPUT_SYMBOL = app.outputSymbol;

const state = {
  wallet: null,
  injection: null,
  account: null,
  chainId: null,
  apiVersions: [],
  balanceWei: null,
  helperDeployed: null,
  protocolDeployed: null,
  quote: null,
  errors: [],
  connected: false,
  executing: false,
  transactionHash: null,
};

function setStatus(kind, message) {
  $("ready-status").dataset.state = kind;
  $("ready-status-text").textContent = message;
}

function normalizeAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return null;
  try { return "0x" + BigInt(value).toString(16); } catch { return null; }
}

function sameAddress(left, right) {
  const a = normalizeAddress(left);
  const b = normalizeAddress(right);
  return Boolean(a && b && a === b);
}

function short(value, start = 10, end = 8) {
  if (!value) return "—";
  return value.slice(0, start) + "…" + value.slice(-end);
}

function hex(value) {
  return "0x" + BigInt(value).toString(16);
}

function felt(value) {
  return hex(value);
}

function u256(value) {
  return [hex(value & ((1n << 128n) - 1n)), hex(value >> 128n)];
}

function u256FromResult(result) {
  if (!Array.isArray(result) || result.length < 2) throw new Error("Protocol returned an incomplete u256.");
  return BigInt(result[0]) + (BigInt(result[1]) << 128n);
}

function formatUnits(value, decimals = 18, maxFraction = 8) {
  if (value === null || value === undefined) return "—";
  try {
    const raw = BigInt(value);
    const base = 10n ** BigInt(decimals);
    const whole = raw / base;
    let fraction = (raw % base).toString().padStart(decimals, "0").slice(0, maxFraction);
    fraction = fraction.replace(/0+$/, "");
    return fraction ? whole.toString() + "." + fraction : whole.toString();
  } catch { return String(value); }
}

function chainLabel(value) {
  if (typeof value !== "string") return "unknown";
  const upper = value.toUpperCase();
  if (MAINNET_CHAIN_IDS.has(upper)) return "Starknet Mainnet";
  if (upper === "SN_SEPOLIA" || upper === "0X534E5F5345504F4C4941") return "Starknet Sepolia";
  return value;
}

function isMainnet(value) {
  return MAINNET_CHAIN_IDS.has(typeof value === "string" ? value.toUpperCase() : "");
}

function errorDetail(value, depth = 0, seen = new Set()) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    return value.length > 3000 ? value.slice(0, 3000) + "… [truncated]" : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (depth > 4 || typeof value !== "object") return "[nested error truncated]";
  if (seen.has(value)) return "[circular error]";
  seen.add(value);
  const keys = ["code", "message", "reason", "details", "data", "error", "execution_error", "cause"];
  const entries = keys
    .filter((key) => key in value && value[key] !== undefined && value[key] !== null)
    .map((key) => `${key}=${errorDetail(value[key], depth + 1, seen)}`);
  seen.delete(value);
  return entries.length ? `{ ${entries.join("; ")} }` : "";
}

function errorText(error) {
  const detail = errorDetail(error);
  return detail || "The wallet or RPC returned an unknown error.";
}

function candidateWallets() {
  const names = ["starknet_ready", "starknet_argentX", "starknet", "starknet_braavos"];
  const seen = new Set();
  const found = [];
  for (const name of names) {
    const wallet = window[name];
    if (!wallet || typeof wallet.request !== "function" || seen.has(wallet)) continue;
    seen.add(wallet);
    found.push({ name, wallet });
  }
  return found.sort((left, right) => {
    const score = (candidate) => /ready/i.test(
      candidate.name + " " + (candidate.wallet.name ?? "") + " " + (candidate.wallet.id ?? ""),
    ) ? 0 : 1;
    return score(left) - score(right);
  });
}

async function request(wallet, message) {
  return wallet.request(message);
}

async function rpc(method, params) {
  const response = await fetch(MAINNET_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (!response.ok) throw new Error(method + ": HTTP " + response.status);
  const body = await response.json();
  if (body.error) throw new Error(method + ": " + (body.error.message ?? JSON.stringify(body.error)));
  return body.result;
}

async function readProtocolState() {
  const classHash = await rpc("starknet_getClassHashAt", ["latest", app.contract]);
  const asset = await rpc("starknet_call", [{
    contract_address: app.contract,
    entry_point_selector: ASSET_SELECTOR,
    calldata: [],
  }, "latest"]);
  if (!Array.isArray(asset) || !sameAddress(asset[0], STRK)) {
    throw new Error(app.contractLabel + " is not configured with STRK as its underlying asset.");
  }
  const preview = await rpc("starknet_call", [{
    contract_address: app.contract,
    entry_point_selector: PREVIEW_DEPOSIT_SELECTOR,
    calldata: u256(AMOUNT),
  }, "latest"]);
  const shares = u256FromResult(preview);
  if (shares <= 0n) throw new Error(app.contractLabel + " returned zero shares for a 0.1 STRK preview.");
  const maxDeposit = u256FromResult(await rpc("starknet_call", [{
    contract_address: app.contract,
    entry_point_selector: MAX_DEPOSIT_SELECTOR,
    calldata: [HELPER],
  }, "latest"]));
  if (maxDeposit < AMOUNT) {
    throw new Error(app.contractLabel + " currently accepts less than the reviewed 0.1 STRK deposit.");
  }
  state.protocolDeployed = Boolean(classHash && !sameAddress(classHash, "0x0"));
  state.quote = { shares, maxDeposit, checkedAt: Date.now(), classHash };
  return state.quote;
}

async function readWalletState(wallet, silent = false) {
  const errors = [];
  let accounts = [];
  try {
    accounts = await request(wallet, { type: "wallet_requestAccounts", params: { silent_mode: silent } });
  } catch (error) {
    errors.push("Account request: " + errorText(error));
  }
  const account = Array.isArray(accounts) ? normalizeAddress(accounts[0]) : null;
  if (!account) return { account, chainId: null, versions: [], balanceWei: null, errors };

  let chainId = null;
  try { chainId = await request(wallet, { type: "wallet_requestChainId" }); }
  catch (error) { errors.push("Chain request: " + errorText(error)); }

  let versionsResult = null;
  try { versionsResult = await request(wallet, { type: "wallet_supportedWalletApi" }); }
  catch (error) { errors.push("Wallet API versions: " + errorText(error)); }

  let balancesResult = null;
  try {
    balancesResult = await request(wallet, {
      type: "wallet_strk20Balances",
      params: { tokens: [STRK] },
    });
  } catch (error) {
    errors.push("Shielded balance: " + errorText(error));
  }

  const entry = Array.isArray(balancesResult)
    ? balancesResult.find((item) => sameAddress(item?.token, STRK))
    : null;
  let balanceWei = null;
  if (entry) {
    try { balanceWei = BigInt(entry.balance ?? "0"); }
    catch { errors.push("Shielded balance was not an integer."); }
  } else if (Array.isArray(balancesResult)) {
    balanceWei = 0n;
  }

  return {
    account,
    chainId,
    versions: Array.isArray(versionsResult)
      ? versionsResult.filter((version) => typeof version === "string")
      : [],
    balanceWei,
    errors,
  };
}

async function checkHelper() {
  try {
    const classHash = await rpc("starknet_getClassHashAt", ["latest", HELPER]);
    state.helperDeployed = sameAddress(classHash, HELPER_CLASS_HASH);
    if (!state.helperDeployed) {
      state.errors.push("Helper address has class " + classHash + ", not the expected Facet allowlisted helper class.");
    }
  } catch {
    state.helperDeployed = false;
  }
}

function versionAtLeast(version, major, minor, patch = 0) {
  const parts = String(version).split(".").map((part) => Number.parseInt(part, 10));
  if (parts.some(Number.isNaN)) return false;
  const [a = 0, b = 0, c = 0] = parts;
  return a > major || (a === major && (b > minor || (b === minor && c >= patch)));
}

function hasNativeStrk20() {
  return state.apiVersions.some((version) => versionAtLeast(version, 0, 10, 3));
}

function canExecute() {
  return Boolean(
    state.connected
      && state.account
      && isMainnet(state.chainId)
      && hasNativeStrk20()
      && state.helperDeployed
      && state.protocolDeployed
      && state.balanceWei !== null
      && state.balanceWei >= AMOUNT
      && state.quote
      && $("confirm").checked
      && !state.executing,
  );
}

function render() {
  const connected = Boolean(state.connected && state.account);
  $("wallet-name").textContent = state.wallet
    ? (state.wallet.name || state.wallet.id || "injected wallet")
    : "—";
  $("wallet-address").textContent = state.account ? short(state.account) : "—";
  $("wallet-address").title = state.account ?? "";
  $("wallet-network").textContent = state.chainId ? chainLabel(state.chainId) : "—";
  $("wallet-pill").textContent = connected ? "connected" : "not connected";
  $("wallet-pill").className = "pill " + (connected ? "pill-good" : "");
  $("connect").textContent = connected ? "Ready X connected" : "Connect Ready X";
  $("api-versions").textContent = state.apiVersions.length ? state.apiVersions.join(", ") : "—";
  $("output-symbol").textContent = OUTPUT_SYMBOL;

  if (state.balanceWei === null) {
    $("balance-amount").textContent = "—";
    $("balance-pill").textContent = "not checked";
    $("balance-pill").className = "pill";
  } else {
    $("balance-amount").textContent = formatUnits(state.balanceWei);
    const enough = state.balanceWei >= AMOUNT;
    $("balance-pill").textContent = enough ? "enough for input" : "too small";
    $("balance-pill").className = "pill " + (enough ? "pill-good" : "");
  }

  $("helper-address").textContent = short(HELPER);
  $("helper-address").title = HELPER;
  $("helper-class").textContent = short(HELPER_CLASS_HASH, 8, 6);
  $("helper-class").title = HELPER_CLASS_HASH;
  $("pool-address").textContent = short(MAINNET_POOL);
  $("pool-address").title = MAINNET_POOL;
  $("helper-pill").textContent = state.helperDeployed === null
    ? "checking"
    : state.helperDeployed ? "deployed" : "deploy first";
  $("helper-pill").className = "pill " + (state.helperDeployed ? "pill-good" : "");

  $("protocol-label").textContent = app.contractLabel;
  $("quoted-output").textContent = state.quote
    ? formatUnits(state.quote.shares) + " " + OUTPUT_SYMBOL + " (" + state.quote.shares + " wei)"
    : "—";
  $("output-recipient").textContent = state.account ? short(state.account) : "—";
  $("output-recipient").title = state.account ?? "";

  const reviewLines = [];
  if (connected && !isMainnet(state.chainId)) reviewLines.push("STOP: switch Ready X to Starknet Mainnet.");
  if (connected && !hasNativeStrk20()) {
    reviewLines.push("STOP: this wallet does not advertise Wallet API 0.10.3 or newer.");
  }
  if (state.protocolDeployed === false) {
    reviewLines.push("The " + app.contractLabel + " contract is not available at its configured address.");
  }
  if (state.helperDeployed === false) {
    reviewLines.push("The reviewed helper address is reserved but not deployed yet.");
  }
  if (state.balanceWei !== null && state.balanceWei < AMOUNT) {
    reviewLines.push("The shielded STRK balance is below the 0.1 STRK input.");
  }
  if (state.errors.length) reviewLines.push(...state.errors);
  if (!reviewLines.length && connected) {
    reviewLines.push(
      state.quote
        ? "Mainnet, helper, balance, and live protocol checks passed."
        : "Mainnet and helper checks passed; fetching a live " + app.name + " quote…",
    );
    reviewLines.push(
      "The action will withdraw STRK to the Facet helper, call " + app.contractLabel
        + ", and settle " + OUTPUT_SYMBOL + " to an open note in this wallet.",
    );
  }
  $("review-panel").innerHTML = reviewLines.length
    ? reviewLines.map((line) => "<p>" + escapeHtml(line) + "</p>").join("")
    : "<p>Connect Ready X to begin.</p>";

  const reviewReady = connected && state.helperDeployed && state.protocolDeployed && state.quote;
  $("confirm").disabled = !reviewReady || state.executing;
  $("execute").disabled = !canExecute();
  $("refresh").disabled = !connected || state.executing;
  $("copy-diagnostics").disabled = !connected;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function actionsForProtocol() {
  return [
    { type: "withdraw", token: STRK, amount: hex(AMOUNT), recipient: HELPER },
    { type: "transfer", token: OUTPUT_TOKEN, amount: "OPEN", recipient: state.account },
    {
      type: "invoke",
      contract: HELPER,
      calldata: [
        "0x0",
        felt(STRK),
        felt(OUTPUT_TOKEN),
        ...u256(AMOUNT),
        "$" + "{openNoteIds[0]}",
      ],
    },
  ];
}

async function connect() {
  const candidates = candidateWallets();
  if (!candidates.length) {
    state.errors = ["No injected Starknet wallet with the Wallet API was found in this tab."];
    setStatus("error", "Ready X was not detected in this browser profile.");
    render();
    return;
  }
  const selected = candidates[0];
  state.wallet = selected.wallet;
  state.injection = selected.name;
  state.errors = [];
  state.connected = false;
  setStatus("signing", "Reading Mainnet state for " + app.name + " from "
    + (selected.wallet.name || selected.name) + "…");
  render();
  try {
    const result = await readWalletState(selected.wallet);
    state.account = result.account;
    state.chainId = result.chainId;
    state.apiVersions = result.versions;
    state.balanceWei = result.balanceWei;
    state.errors = result.errors;
    state.connected = Boolean(state.account);
    if (state.connected) {
      await checkHelper();
      if (isMainnet(state.chainId)) {
        try { await readProtocolState(); } catch (error) {
          state.protocolDeployed = false;
          state.errors.push(app.name + " quote: " + errorText(error));
        }
      }
    }
    if (state.errors.length) setStatus("error", "Ready responded, but a review check needs attention.");
    else if (!isMainnet(state.chainId)) setStatus("error", "Connected to " + chainLabel(state.chainId) + ". Switch to Mainnet.");
    else if (!state.helperDeployed) setStatus("error", "The reserved Facet helper is not deployed yet.");
    else setStatus("bound", "Mainnet review ready. No transaction was requested.");
  } catch (error) {
    state.errors = [errorText(error)];
    setStatus("error", "The Mainnet wallet check failed.");
  }
  render();
}

async function refresh() {
  if (!state.wallet || !state.account) return;
  state.errors = [];
  state.quote = null;
  setStatus("signing", "Refreshing wallet, helper, and " + app.name + " state…");
  render();
  try {
    const result = await readWalletState(state.wallet, true);
    state.account = result.account ?? state.account;
    state.chainId = result.chainId;
    state.apiVersions = result.versions;
    state.balanceWei = result.balanceWei;
    state.errors = result.errors;
    await checkHelper();
    if (isMainnet(state.chainId)) {
      try { await readProtocolState(); } catch (error) {
        state.protocolDeployed = false;
        state.errors.push(app.name + " quote: " + errorText(error));
      }
    }
    setStatus(
      state.errors.length ? "error" : "bound",
      state.errors.length
        ? "Refresh returned errors."
        : "Review state refreshed; no transaction was requested.",
    );
  } catch (error) {
    state.errors = [errorText(error)];
    setStatus("error", "The refresh failed.");
  }
  render();
}

async function waitForReceipt(transactionHash) {
  for (let attempt = 0; attempt < 72; attempt += 1) {
    try {
      const receipt = await rpc("starknet_getTransactionReceipt", [transactionHash]);
      const execution = String(receipt.execution_status ?? "").toUpperCase();
      const finality = String(receipt.finality_status ?? receipt.status ?? "").toUpperCase();
      if (execution.includes("REVERT") || finality.includes("REVERT")) {
        throw new Error("Mainnet transaction reverted: " + transactionHash);
      }
      if (execution.includes("SUCC") || finality.includes("ACCEPTED")) {
        setStatus("bound", "Mainnet transaction accepted.");
        $("result-panel").innerHTML = "<p>Success: <a href=\""
          + network.explorer + "/tx/" + encodeURIComponent(transactionHash)
          + "\" target=\"_blank\" rel=\"noreferrer\">" + escapeHtml(transactionHash) + "</a></p>";
        return;
      }
    } catch (error) {
      if (String(errorText(error)).includes("reverted")) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  setStatus("submitted", "Transaction submitted; confirmation is still pending.");
}

async function execute() {
  if (!state.wallet || !canExecute()) return;
  state.executing = true;
  state.transactionHash = null;
  setStatus("signing", "Refreshing the " + app.name + " quote, then asking Ready X to prove and screen the action…");
  render();
  try {
    await readProtocolState();
    if (!state.connected || !state.account || !isMainnet(state.chainId) || !hasNativeStrk20()
      || !state.helperDeployed || !state.protocolDeployed || state.balanceWei === null
      || state.balanceWei < AMOUNT || !state.quote || !$("confirm").checked) {
      throw new Error("The review changed while refreshing the protocol quote. Review it again.");
    }
    const result = await request(state.wallet, {
      type: "wallet_strk20InvokeTransaction",
      params: { actions: actionsForProtocol() },
    });
    const transactionHash = result?.transaction_hash;
    if (typeof transactionHash !== "string" || !transactionHash) {
      throw new Error("Ready returned no transaction hash.");
    }
    state.transactionHash = transactionHash;
    setStatus("submitted", "Ready returned a transaction hash; waiting for Mainnet acceptance…");
    $("result-panel").innerHTML = "<p>Submitted: <a href=\""
      + network.explorer + "/tx/" + encodeURIComponent(transactionHash)
      + "\" target=\"_blank\" rel=\"noreferrer\">" + escapeHtml(transactionHash) + "</a></p>";
    await waitForReceipt(transactionHash);
  } catch (error) {
    state.errors = [errorText(error)];
    setStatus("error", "Ready did not complete the reviewed " + app.name + " action.");
    $("result-panel").innerHTML = "<p>" + escapeHtml(errorText(error)) + "</p>";
  } finally {
    state.executing = false;
    render();
  }
}

async function copyDiagnostics() {
  try {
    await navigator.clipboard.writeText(JSON.stringify({
      wallet: state.wallet
        ? { id: state.wallet.id, name: state.wallet.name, version: state.wallet.version }
        : null,
      injection: state.injection,
      application: app.id,
      account: state.account,
      chain_id: state.chainId,
      wallet_api_versions: state.apiVersions,
      shielded_strk_balance_wei: state.balanceWei?.toString() ?? null,
      facet_targets: {
        pool: MAINNET_POOL,
        helper: HELPER,
        helper_class_hash: HELPER_CLASS_HASH,
        protocol: app.contract,
      },
      quote: state.quote
        ? {
          shares_wei: state.quote.shares.toString(),
          max_deposit_wei: state.quote.maxDeposit.toString(),
          checked_at: state.quote.checkedAt,
        }
        : null,
      last_error: state.errors.at(-1) ?? null,
      transaction_hash: state.transactionHash,
      proof_generated_by_page: false,
    }, null, 2));
    $("copy-status").textContent = "copied";
  } catch {
    $("copy-status").textContent = "Clipboard unavailable";
  }
}

function configurePage() {
  document.title = "Facet · Mainnet " + app.name;
  $("protocol-eyebrow").textContent = "Facet Mainnet path · wallet-mediated " + app.name;
  $("hero-title").textContent = "Use the live " + app.name + " route.";
  $("hero-lede").textContent = "Ready X is the signing and proving wallet for this supported route. Facet supplies the "
    + app.name + " helper, the allowlisted call path, and the exact deposit parameters below.";
  $("output-symbol").textContent = OUTPUT_SYMBOL;
  $("protocol-label").textContent = app.contractLabel;
  $("protocol-note").textContent = "Ready X proves and screens the private action. The receipt must touch the Mainnet STRK20 pool, the Facet "
    + app.name + " helper, and " + app.contractLabel + " before it is counted as integration evidence. The "
    + OUTPUT_SYMBOL + " position remains protocol state until an explicit redeem action.";
}

configurePage();
$("connect").onclick = connect;
$("refresh").onclick = refresh;
$("execute").onclick = execute;
$("confirm").onchange = render;
$("copy-diagnostics").onclick = copyDiagnostics;

if (!candidateWallets().length) setStatus("idle", "Ready X will be checked when you press Connect.");
else setStatus("connected", "Ready X detected. Press Connect to review the Mainnet action.");
render();
