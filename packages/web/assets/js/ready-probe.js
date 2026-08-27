const $ = (id) => document.getElementById(id);

const MAINNET_CHAIN_IDS = new Set(["SN_MAIN", "0X534E5F4D41494E"]);
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const MAINNET_POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const MAINNET_ANONYMIZER = "0x741fe9dcdf3729919e8c44422fbb963e76a0788f3abad20bb25a50445f363bc";

const state = {
  wallet: null,
  injection: null,
  account: null,
  chainId: null,
  apiVersions: [],
  balances: null,
  errors: [],
  connected: false,
};

function setStatus(kind, message) {
  $("ready-status").dataset.state = kind;
  $("ready-status-text").textContent = message;
}

function normalizeAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return null;
  try {
    // Starknet displays equivalent felts with or without leading zeroes. Canonicalize before
    // comparing the wallet's token/address strings with Facet's configured constants.
    return `0x${BigInt(value).toString(16)}`;
  } catch {
    return null;
  }
}

function short(value, start = 8, end = 6) {
  if (!value) return "—";
  return `${value.slice(0, start)}…${value.slice(-end)}`;
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

function errorText(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof error.message === "string") return error.message;
  return "The wallet returned an unknown error.";
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

async function readWallet(wallet, silent = false) {
  const errors = [];
  // Keep the connection request separate from the reads. Some injected wallets serialize their
  // approval UI; starting several requests at once can make the balance call race the connection.
  let accounts = [];
  try {
    accounts = await request(wallet, { type: "wallet_requestAccounts", params: { silent_mode: silent } });
  } catch (error) {
    errors.push(`Account request: ${errorText(error)}`);
  }

  const account = Array.isArray(accounts) ? normalizeAddress(accounts[0]) : null;
  // If the wallet connection was refused or malformed, do not continue probing other methods.
  // This avoids unnecessary wallet prompts and makes a failed connection an unambiguous stop.
  if (!account) return { account, chainId: null, versions: [], balances: null, errors };

  let chainId = null;
  try {
    chainId = await request(wallet, { type: "wallet_requestChainId" });
  } catch (error) {
    errors.push(`Chain request: ${errorText(error)}`);
  }

  let versionsResult = null;
  try {
    versionsResult = await request(wallet, { type: "wallet_supportedWalletApi" });
  } catch (error) {
    errors.push(`Wallet API versions: ${errorText(error)}`);
  }

  let balancesResult = null;
  try {
    balancesResult = await request(wallet, { type: "wallet_strk20Balances", params: { tokens: [STRK] } });
  } catch (error) {
    errors.push(`Shielded balance: ${errorText(error)}`);
  }

  const versions = Array.isArray(versionsResult)
    ? versionsResult.filter((version) => typeof version === "string")
    : [];
  const balances = Array.isArray(balancesResult) ? balancesResult : null;

  return { account, chainId, versions, balances, errors };
}

function versionAtLeast(version, major, minor, patch = 0) {
  const parts = String(version).split(".").map((part) => Number.parseInt(part, 10));
  if (parts.some(Number.isNaN)) return false;
  const [a = 0, b = 0, c = 0] = parts;
  return a > major || (a === major && (b > minor || (b === minor && c >= patch)));
}

function hasShadowSpec() {
  return state.apiVersions.some((version) => versionAtLeast(version, 0, 10, 4));
}

function renderBalance() {
  if (!Array.isArray(state.balances)) {
    $("balance-amount").textContent = "—";
    $("balance-pill").textContent = "unavailable";
    $("balance-pill").className = "pill";
    return;
  }
  const entry = state.balances.find((item) => normalizeAddress(item?.token) === STRK);
  if (!entry) {
    $("balance-amount").textContent = "0";
    $("balance-pill").textContent = "zero shielded";
    $("balance-pill").className = "pill";
    return;
  }
  const raw = String(entry.balance ?? "0");
  let formatted = raw;
  try {
    const value = BigInt(raw);
    const whole = value / 1000000000000000000n;
    const fraction = (value % 1000000000000000000n).toString().padStart(18, "0").replace(/0+$/, "");
    formatted = fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    // Keep the wallet's exact value visible if it is not a felt-shaped integer.
  }
  $("balance-amount").textContent = formatted;
  $("balance-pill").textContent = "read successfully";
  $("balance-pill").className = "pill pill-good";
}

function render() {
  const wallet = state.wallet;
  const connected = Boolean(state.connected && state.account);
  $("wallet-name").textContent = wallet ? (wallet.name || wallet.id || "injected wallet") : "—";
  $("wallet-address").textContent = state.account ? short(state.account, 10, 8) : "—";
  $("wallet-address").title = state.account ?? "";
  $("wallet-network").textContent = state.chainId ? chainLabel(state.chainId) : "—";
  $("wallet-injection").textContent = state.injection ?? "—";
  $("wallet-pill").textContent = connected ? "connected" : "not connected";
  $("wallet-pill").className = `pill ${connected ? "pill-good" : ""}`;
  $("connect").textContent = connected ? "Ready X connected" : "Connect Ready X";
  $("refresh").disabled = !connected;

  $("api-versions").textContent = state.apiVersions.length ? state.apiVersions.join(", ") : "—";
  const eligible = hasShadowSpec();
  $("shadow-support").textContent = state.apiVersions.length
    ? eligible ? "eligible by advertised version" : "not advertised"
    : "not checked";
  $("capability-pill").textContent = state.apiVersions.length ? (eligible ? "next test" : "blocked") : "not checked";
  $("capability-pill").className = `pill ${eligible ? "pill-good" : ""}`;
  $("capability-note").textContent = eligible
    ? "Ready advertises a wallet API version in the shadow-account spec range. The next step is a simulated Facet action; no proof or broadcast yet."
    : state.apiVersions.length
      ? "The wallet did not advertise the shadow-account spec range. Do not try to force the action through an older API."
      : "Connect first. This page will not infer support from a wallet name.";

  renderBalance();

  const lines = [];
  if (connected && !isMainnet(state.chainId)) lines.push("STOP: switch Ready X to Starknet Mainnet before any Facet action.");
  if (state.errors.length) lines.push(...state.errors);
  if (!lines.length && connected) {
    lines.push("Wallet state read successfully.");
    lines.push("No proof was generated and no transaction was requested.");
    lines.push(eligible ? "The wallet is eligible for the next no-spend shadow-action simulation." : "The wallet has not advertised the shadow-account action yet.");
  }
  $("result-panel").innerHTML = lines.length
    ? lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")
    : "<p>Connect Ready X on Starknet Mainnet. The next step is only enabled after the actual wallet response is visible here.</p>";
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
    network: chainLabel(state.chainId),
    wallet_api_versions: state.apiVersions,
    strk20_balance_entries: state.balances,
    facet_targets: { token: STRK, pool: MAINNET_POOL, anonymizer: MAINNET_ANONYMIZER },
    proof_generated: false,
    transaction_requested: false,
  }, null, 2);
}

async function connect() {
  const candidates = candidateWallets();
  if (!candidates.length) {
    state.errors = ["No injected Starknet wallet with the Wallet API was found in this tab."];
    setStatus("error", "Ready X was not detected. Open this page in the browser profile with the extension installed.");
    render();
    return;
  }

  const selected = candidates[0];
  state.wallet = selected.wallet;
  state.injection = selected.name;
  state.errors = [];
  state.connected = false;
  setStatus("signing", `Requesting read-only state from ${selected.wallet.name || selected.name}…`);
  render();

  try {
    const result = await readWallet(selected.wallet);
    state.account = result.account;
    state.chainId = result.chainId;
    state.apiVersions = result.versions;
    state.balances = result.balances;
    state.errors = result.errors;
    state.connected = Boolean(state.account);
    if (!state.account && !state.errors.length) state.errors.push("The wallet returned no account.");
    if (state.errors.length) {
      setStatus("error", "Ready responded, but one or more read-only checks failed.");
    } else if (!isMainnet(state.chainId)) {
      setStatus("error", `Connected to ${chainLabel(state.chainId)}. Switch to Starknet Mainnet.`);
    } else {
      setStatus("bound", "Ready X state read successfully. No transaction was requested.");
    }
  } catch (error) {
    state.errors = [errorText(error)];
    setStatus("error", "The read-only wallet check failed.");
  }
  render();
}

async function refresh() {
  if (!state.wallet || !state.account) return;
  state.errors = [];
  setStatus("signing", "Refreshing read-only wallet state…");
  render();
  try {
    const result = await readWallet(state.wallet, true);
    state.account = result.account ?? state.account;
    state.chainId = result.chainId;
    state.apiVersions = result.versions;
    state.balances = result.balances;
    state.errors = result.errors;
    setStatus(state.errors.length ? "error" : "bound", state.errors.length ? "Refresh returned errors." : "Read-only state refreshed.");
  } catch (error) {
    state.errors = [errorText(error)];
    setStatus("error", "The read-only refresh failed.");
  }
  render();
}

async function copyDiagnostics() {
  if (!state.account) return;
  try {
    await navigator.clipboard.writeText(safeDiagnostics());
    $("copy-status").textContent = "copied";
  } catch {
    $("copy-status").textContent = "Clipboard unavailable";
  }
}

$("connect").onclick = connect;
$("refresh").onclick = refresh;
$("copy-diagnostics").onclick = copyDiagnostics;

if (!candidateWallets().length) {
  setStatus("idle", "Ready X will be checked when you press Connect.");
} else {
  setStatus("connected", "Ready X detected. Press Connect to request read-only state.");
}
render();
