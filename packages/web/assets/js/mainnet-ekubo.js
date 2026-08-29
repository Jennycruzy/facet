const $ = (id) => document.getElementById(id);

const MAINNET_CHAIN_IDS = new Set(["SN_MAIN", "0X534E5F4D41494E"]);
const MAINNET_RPC = "https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_10";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const ROUTER = "0x0199741822c2dc722f6f605204f35e56dbc23bceed54818168c4c49e4fb8737e";
const HELPER = "0x2bd92991a0c90757caeb5d0908892637d4288ff4e2013877e0a2707a3788537";
const HELPER_CLASS_HASH = "0x2a4ac595283d4d64b9952f5ef5c0da1775bfdb7c9d92237524a21dd8d19ebd7";
const ROUTE_FEE = 170141183460469235273462165868118016n;
const TICK_SPACING = 1000n;
const SWAP_AMOUNT = 100000000000000000n;
const SLIPPAGE_BPS = 1000n;
const QUOTE_SWAP_SELECTOR = "0x2904b7c28f3fd4556d8aa4f93483ea2077dd95e61c54db86c2ea5fc1f3ffd54";

const state = {
  wallet: null,
  injection: null,
  account: null,
  chainId: null,
  apiVersions: [],
  balanceWei: null,
  helperDeployed: null,
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
  try { return `0x${BigInt(value).toString(16)}`; } catch { return null; }
}

function sameAddress(left, right) {
  return normalizeAddress(left) === normalizeAddress(right);
}

function short(value, start = 10, end = 8) {
  if (!value) return "—";
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

function hex(value) {
  return `0x${BigInt(value).toString(16)}`;
}

// STRK20 calldata items are FELTs. Ready's FELT validator rejects a padded
// 64-digit address such as 0x0471..., while the typed address fields accept
// and normalize that representation. Always send calldata in canonical felt
// form (without leading zeroes).
function felt(value) {
  return hex(value);
}

function u256(value) {
  return [hex(value & ((1n << 128n) - 1n)), hex(value >> 128n)];
}

function formatUnits(value, decimals = 18, maxFraction = 8) {
  if (value === null || value === undefined) return "—";
  try {
    const raw = BigInt(value);
    const base = 10n ** BigInt(decimals);
    const whole = raw / base;
    let fraction = (raw % base).toString().padStart(decimals, "0").slice(0, maxFraction);
    fraction = fraction.replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
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
    const score = (candidate) => /ready/i.test(`${candidate.name} ${candidate.wallet.name ?? ""} ${candidate.wallet.id ?? ""}`) ? 0 : 1;
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
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

function routeCalldata() {
  return [
    STRK, ETH, hex(ROUTE_FEE), hex(TICK_SPACING), "0x0",
    "0x0", "0x0", "0x0",
    STRK, hex(SWAP_AMOUNT), "0x0",
  ];
}

async function readQuote() {
  const result = await rpc("starknet_call", [{
    contract_address: ROUTER,
    entry_point_selector: QUOTE_SWAP_SELECTOR,
    calldata: routeCalldata(),
  }, "latest"]);
  if (!Array.isArray(result) || result.length < 4) throw new Error("Ekubo returned an incomplete quote.");
  const input = BigInt(result[0]);
  const inputSign = BigInt(result[1]);
  const output = BigInt(result[2]);
  const outputSign = BigInt(result[3]);
  if (input !== SWAP_AMOUNT || inputSign !== 0n || outputSign === 0n || output <= 0n) {
    throw new Error(`Unexpected Ekubo quote delta: ${result.join(",")}`);
  }
  const minimum = output * (10000n - SLIPPAGE_BPS) / 10000n;
  state.quote = { quotedWei: output, minimumWei: minimum, checkedAt: Date.now() };
  return state.quote;
}

async function readWalletState(wallet, silent = false) {
  const errors = [];
  let accounts = [];
  try {
    accounts = await request(wallet, { type: "wallet_requestAccounts", params: { silent_mode: silent } });
  } catch (error) {
    errors.push(`Account request: ${errorText(error)}`);
  }
  const account = Array.isArray(accounts) ? normalizeAddress(accounts[0]) : null;
  if (!account) return { account, chainId: null, versions: [], balanceWei: null, errors };

  let chainId = null;
  try { chainId = await request(wallet, { type: "wallet_requestChainId" }); }
  catch (error) { errors.push(`Chain request: ${errorText(error)}`); }

  let versionsResult = null;
  try { versionsResult = await request(wallet, { type: "wallet_supportedWalletApi" }); }
  catch (error) { errors.push(`Wallet API versions: ${errorText(error)}`); }

  let balancesResult = null;
  try { balancesResult = await request(wallet, { type: "wallet_strk20Balances", params: { tokens: [STRK] } }); }
  catch (error) { errors.push(`Shielded balance: ${errorText(error)}`); }

  const entry = Array.isArray(balancesResult)
    ? balancesResult.find((item) => sameAddress(item?.token, STRK))
    : null;
  let balanceWei = null;
  if (entry) {
    try { balanceWei = BigInt(entry.balance ?? "0"); } catch { errors.push("Shielded balance was not an integer."); }
  } else if (Array.isArray(balancesResult)) {
    balanceWei = 0n;
  }

  return {
    account,
    chainId,
    versions: Array.isArray(versionsResult) ? versionsResult.filter((version) => typeof version === "string") : [],
    balanceWei,
    errors,
  };
}

async function checkHelper() {
  try {
    const classHash = await rpc("starknet_getClassHashAt", ["latest", HELPER]);
    state.helperDeployed = sameAddress(classHash, HELPER_CLASS_HASH);
    if (!state.helperDeployed) state.errors.push(`Helper address has class ${classHash}, not the expected class.`);
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
      && state.balanceWei !== null
      && state.balanceWei >= SWAP_AMOUNT
      && state.quote
      && $("confirm").checked
      && !state.executing,
  );
}

function render() {
  const connected = Boolean(state.connected && state.account);
  $("wallet-name").textContent = state.wallet ? (state.wallet.name || state.wallet.id || "injected wallet") : "—";
  $("wallet-address").textContent = state.account ? short(state.account) : "—";
  $("wallet-address").title = state.account ?? "";
  $("wallet-network").textContent = state.chainId ? chainLabel(state.chainId) : "—";
  $("wallet-pill").textContent = connected ? "connected" : "not connected";
  $("wallet-pill").className = `pill ${connected ? "pill-good" : ""}`;
  $("connect").textContent = connected ? "Ready X connected" : "Connect Ready X";
  $("api-versions").textContent = state.apiVersions.length ? state.apiVersions.join(", ") : "—";

  if (state.balanceWei === null) {
    $("balance-amount").textContent = "—";
    $("balance-pill").textContent = "not checked";
    $("balance-pill").className = "pill";
  } else {
    $("balance-amount").textContent = formatUnits(state.balanceWei);
    const enough = state.balanceWei >= SWAP_AMOUNT;
    $("balance-pill").textContent = enough ? "enough for input" : "too small";
    $("balance-pill").className = `pill ${enough ? "pill-good" : ""}`;
  }

  $("helper-address").textContent = short(HELPER);
  $("helper-address").title = HELPER;
  $("helper-class").textContent = short(HELPER_CLASS_HASH, 8, 6);
  $("helper-class").title = HELPER_CLASS_HASH;
  $("pool-address").textContent = short(POOL);
  $("pool-address").title = POOL;
  $("helper-pill").textContent = state.helperDeployed === null ? "checking" : state.helperDeployed ? "deployed" : "deploy first";
  $("helper-pill").className = `pill ${state.helperDeployed ? "pill-good" : ""}`;

  $("quoted-output").textContent = state.quote ? `${formatUnits(state.quote.quotedWei)} ETH (${state.quote.quotedWei} wei)` : "—";
  $("minimum-output").textContent = state.quote ? `${formatUnits(state.quote.minimumWei)} ETH (${state.quote.minimumWei} wei)` : "—";
  $("output-recipient").textContent = state.account ? short(state.account) : "—";
  $("output-recipient").title = state.account ?? "";

  const reviewLines = [];
  if (connected && !isMainnet(state.chainId)) reviewLines.push("STOP: switch Ready X to Starknet Mainnet.");
  if (connected && !hasNativeStrk20()) reviewLines.push("STOP: this wallet does not advertise Wallet API 0.10.3 or newer.");
  if (state.helperDeployed === false) reviewLines.push("The official helper class is declared, but its reserved Mainnet address is not deployed yet.");
  if (state.balanceWei !== null && state.balanceWei < SWAP_AMOUNT) reviewLines.push("The shielded STRK balance is below the 0.1 STRK input.");
  if (state.errors.length) reviewLines.push(...state.errors);
  if (!reviewLines.length && connected) {
    reviewLines.push(state.quote ? "Mainnet, helper, balance, and live quote checks passed." : "Mainnet checks passed; fetching a live Ekubo quote…");
    reviewLines.push("The action will withdraw STRK to the helper, swap on Ekubo, and settle ETH to an open note in this wallet.");
  }
  $("review-panel").innerHTML = reviewLines.length
    ? reviewLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")
    : "<p>Connect Ready X to begin.</p>";

  $("confirm").disabled = !connected || !state.helperDeployed || !state.quote || state.executing;
  $("execute").disabled = !canExecute();
  $("refresh").disabled = !connected || state.executing;
  $("copy-diagnostics").disabled = !connected;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function safeDiagnostics() {
  return JSON.stringify({
    wallet: state.wallet ? { id: state.wallet.id, name: state.wallet.name, version: state.wallet.version } : null,
    injection: state.injection,
    account: state.account,
    chain_id: state.chainId,
    wallet_api_versions: state.apiVersions,
    shielded_strk_balance_wei: state.balanceWei?.toString() ?? null,
    facet_targets: { pool: POOL, router: ROUTER, helper: HELPER, helper_class_hash: HELPER_CLASS_HASH },
    quote: state.quote ? { quoted_wei: state.quote.quotedWei.toString(), minimum_wei: state.quote.minimumWei.toString() } : null,
    last_error: state.errors.at(-1) ?? null,
    transaction_hash: state.transactionHash,
    proof_generated_by_page: false,
  }, null, 2);
}

function actionsForQuote(quote) {
  return [
    { type: "withdraw", token: STRK, amount: hex(SWAP_AMOUNT), recipient: HELPER },
    { type: "transfer", token: ETH, amount: "OPEN", recipient: state.account },
    {
      type: "invoke",
      contract: HELPER,
      calldata: [
        felt(ROUTER),
        felt(STRK), hex(SWAP_AMOUNT), "0x0",
        felt(STRK), felt(ETH), hex(ROUTE_FEE), hex(TICK_SPACING), "0x0",
        ...u256(quote.minimumWei),
        "0x0",
        "${openNoteIds[0]}",
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
  setStatus("signing", `Reading Mainnet state from ${selected.wallet.name || selected.name}…`);
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
      if (isMainnet(state.chainId) && state.helperDeployed) {
        try { await readQuote(); } catch (error) { state.errors.push(`Ekubo quote: ${errorText(error)}`); }
      }
    }
    if (state.errors.length) setStatus("error", "Ready responded, but a review check needs attention.");
    else if (!isMainnet(state.chainId)) setStatus("error", `Connected to ${chainLabel(state.chainId)}. Switch to Mainnet.`);
    else if (!state.helperDeployed) setStatus("error", "The reserved helper address is not deployed yet.");
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
  setStatus("signing", "Refreshing wallet, helper, and Ekubo quote…");
  render();
  try {
    const result = await readWalletState(state.wallet, true);
    state.account = result.account ?? state.account;
    state.chainId = result.chainId;
    state.apiVersions = result.versions;
    state.balanceWei = result.balanceWei;
    state.errors = result.errors;
    await checkHelper();
    if (isMainnet(state.chainId) && state.helperDeployed) {
      try { await readQuote(); } catch (error) { state.errors.push(`Ekubo quote: ${errorText(error)}`); }
    }
    setStatus(state.errors.length ? "error" : "bound", state.errors.length ? "Refresh returned errors." : "Review state refreshed; no transaction was requested.");
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
        throw new Error(`Mainnet transaction reverted: ${transactionHash}`);
      }
      if (execution.includes("SUCC") || finality.includes("ACCEPTED")) {
        setStatus("bound", "Mainnet transaction accepted.");
        $("result-panel").innerHTML = `<p>Success: <a href="https://voyager.online/tx/${encodeURIComponent(transactionHash)}" target="_blank" rel="noreferrer">${escapeHtml(transactionHash)}</a></p>`;
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
  setStatus("signing", "Refreshing the quote, then asking Ready X to prove and screen the swap…");
  render();
  try {
    const quote = await readQuote();
    if (!state.connected || !state.account || !isMainnet(state.chainId) || !hasNativeStrk20()
      || !state.helperDeployed || state.balanceWei === null || state.balanceWei < SWAP_AMOUNT
      || !state.quote || !$("confirm").checked) {
      throw new Error("The review changed while refreshing the quote. Review it again.");
    }
    const result = await request(state.wallet, {
      type: "wallet_strk20InvokeTransaction",
      // Match starknet.js' native WalletAccountV6 request shape. Ready selects the
      // highest API version it advertises; including an explicit version here makes
      // the current Ready implementation reject an otherwise valid action payload.
      params: { actions: actionsForQuote(quote) },
    });
    const transactionHash = result?.transaction_hash;
    if (typeof transactionHash !== "string" || !transactionHash) throw new Error("Ready returned no transaction hash.");
    state.transactionHash = transactionHash;
    setStatus("submitted", "Ready returned a transaction hash; waiting for Mainnet acceptance…");
    $("result-panel").innerHTML = `<p>Submitted: <a href="https://voyager.online/tx/${encodeURIComponent(transactionHash)}" target="_blank" rel="noreferrer">${escapeHtml(transactionHash)}</a></p>`;
    await waitForReceipt(transactionHash);
  } catch (error) {
    state.errors = [errorText(error)];
    setStatus("error", "Ready did not complete the reviewed Mainnet action.");
    $("result-panel").innerHTML = `<p>${escapeHtml(errorText(error))}</p>`;
  } finally {
    state.executing = false;
    render();
  }
}

async function copyDiagnostics() {
  try {
    await navigator.clipboard.writeText(safeDiagnostics());
    $("copy-status").textContent = "copied";
  } catch { $("copy-status").textContent = "Clipboard unavailable"; }
}

$("connect").onclick = connect;
$("refresh").onclick = refresh;
$("execute").onclick = execute;
$("confirm").onchange = render;
$("copy-diagnostics").onclick = copyDiagnostics;

if (!candidateWallets().length) setStatus("idle", "Ready X will be checked when you press Connect.");
else setStatus("connected", "Ready X detected. Press Connect to review the Mainnet action.");
render();
