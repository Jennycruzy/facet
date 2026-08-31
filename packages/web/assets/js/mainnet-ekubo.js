import "./theme.js";
import { recordActivity } from "./facet-map.js";
import { parseTokenAmount } from "./amount.js";
import {
  $, candidateWallets, chainLabel, checkHelper, copyToClipboard, createRpc, errorText, escapeHtml,
  felt, formatUnits, hasNativeStrk20, hex, isMainnet, readWalletState, request, sameAddress,
  setStatus, short, u256, u256FromResult, waitForReceipt,
} from "./route-runtime.js";
import { ekuboHelperBinding, submitPlan } from "./executor.js";

const QUOTE_SWAP_SELECTOR = "0x2904b7c28f3fd4556d8aa4f93483ea2077dd95e61c54db86c2ea5fc1f3ffd54";

const data = await fetch("data/facets.json").then((response) => {
  if (!response.ok) throw new Error("Facet configuration unavailable (" + response.status + ").");
  return response.json();
});
const mainnet = data.networks.mainnet;
// One page script serves every Ekubo-shaped route. The page names which one it is; the route's
// tokens, pool key and default size come from facets.json so a second route cannot drift from
// the first by being copied.
const ROUTE_ID = document.body.dataset.route || "ekubo";
const ekubo = data.apps.find((app) => app.id === ROUTE_ID);
if (!ekubo) throw new Error(`Ekubo route "${ROUTE_ID}" is missing from Facet configuration.`);
const route = ekubo.route;
if (!route) throw new Error(`Ekubo route "${ROUTE_ID}" has no route parameters.`);
const MAINNET_CHAIN_IDS = new Set(["SN_MAIN", "0X534E5F4D41494E"]);
const MAINNET_RPC = mainnet.rpc;
const POOL = mainnet.pool;
const rpc = createRpc(MAINNET_RPC);
const TOKEN0 = route.token0;
const TOKEN1 = route.token1;
const TOKEN_IN = route.tokenIn;
const TOKEN_OUT = route.tokenOut;
const IN_SYMBOL = route.tokenInSymbol;
const OUT_SYMBOL = route.tokenOutSymbol;
const ROUTE_FEE = BigInt(route.fee);
const TICK_SPACING = BigInt(route.tickSpacing);
const DEFAULT_SWAP_AMOUNT = BigInt(route.defaultAmount);
const SLIPPAGE_BPS = BigInt(route.slippageBps ?? 1000);

const POLICY = {
  supportedAssets: ekubo.policy.supportedAssets,
  amountBounds: ekubo.policy.amountBounds,
  assetKinds: Object.fromEntries(
    Object.entries(ekubo.policy.assetKinds).map(([token, kind]) => [felt(token), kind]),
  ),
};
const BINDING = ekuboHelperBinding({
  helper: ekubo.helper, router: ekubo.router,
  token0: TOKEN0, token1: TOKEN1, fee: ROUTE_FEE, tickSpacing: TICK_SPACING,
});
const ROUTER = ekubo.router;
const HELPER = ekubo.helper;
const HELPER_CLASS_HASH = ekubo.helperClassHash;

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
  amountWei: DEFAULT_SWAP_AMOUNT,
  amountError: "",
};

// STRK20 calldata items are FELTs. Ready's FELT validator rejects a padded
// 64-digit address such as 0x0471..., while the typed address fields accept
// and normalize that representation. Always send calldata in canonical felt
// form (without leading zeroes).
function routeCalldata() {
  return [
    TOKEN0, TOKEN1, hex(ROUTE_FEE), hex(TICK_SPACING), "0x0",
    "0x0", "0x0", "0x0",
    TOKEN_IN, hex(state.amountWei), "0x0",
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
  if (input !== state.amountWei || inputSign !== 0n || outputSign === 0n || output <= 0n) {
    throw new Error(`Unexpected Ekubo quote delta: ${result.join(",")}`);
  }
  const minimum = output * (10000n - SLIPPAGE_BPS) / 10000n;
  state.quote = { quotedWei: output, minimumWei: minimum, checkedAt: Date.now() };
  return state.quote;
}

function canExecute() {
  return Boolean(
    state.connected
      && state.account
      && isMainnet(state.chainId)
      && hasNativeStrk20(state.apiVersions)
      && state.helperDeployed
      && state.balanceWei !== null
      && !state.amountError
      && state.balanceWei >= state.amountWei
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
    const enough = !state.amountError && state.balanceWei >= state.amountWei;
    $("balance-pill").textContent = enough ? "enough for input" : "too small";
    $("balance-pill").className = `pill ${enough ? "pill-good" : ""}`;
  }
  $("input-summary").textContent = `${formatUnits(state.amountWei, 18, 18)} ${IN_SYMBOL}`;
  $("amount-error").textContent = state.amountError;
  $("confirm-copy").textContent = `I reviewed the route. It will use ${formatUnits(state.amountWei, 18, 18)} ${IN_SYMBOL} from my private balance and show the final approval in my wallet.`;

  $("helper-address").textContent = short(HELPER);
  $("helper-address").title = HELPER;
  $("helper-class").textContent = short(HELPER_CLASS_HASH, 8, 6);
  $("helper-class").title = HELPER_CLASS_HASH;
  $("pool-address").textContent = short(POOL);
  $("pool-address").title = POOL;
  $("helper-pill").textContent = state.helperDeployed === null ? "checking" : state.helperDeployed ? "deployed" : "deploy first";
  $("helper-pill").className = `pill ${state.helperDeployed ? "pill-good" : ""}`;

  $("quoted-output").textContent = state.quote ? `${formatUnits(state.quote.quotedWei)} ${OUT_SYMBOL} (${state.quote.quotedWei} wei)` : "—";
  $("minimum-output").textContent = state.quote ? `${formatUnits(state.quote.minimumWei)} ${OUT_SYMBOL} (${state.quote.minimumWei} wei)` : "—";
  $("output-recipient").textContent = state.account ? short(state.account) : "—";
  $("output-recipient").title = state.account ?? "";

  const reviewLines = [];
  if (connected && !isMainnet(state.chainId)) reviewLines.push("STOP: switch Ready X to Starknet Mainnet.");
  if (connected && !hasNativeStrk20(state.apiVersions)) reviewLines.push("STOP: this wallet does not support the private action required by this route.");
  if (state.helperDeployed === false) reviewLines.push("The official helper class is declared, but its reserved Mainnet address is not deployed yet.");
  if (state.amountError) reviewLines.push(state.amountError);
  if (state.balanceWei !== null && !state.amountError && state.balanceWei < state.amountWei) reviewLines.push(`The shielded ${IN_SYMBOL} balance is below the selected input.`);
  if (state.errors.length) reviewLines.push(...state.errors);
  if (!reviewLines.length && connected) {
    reviewLines.push(state.quote ? "Mainnet, route, balance, and live price checks passed." : "Mainnet checks passed; fetching a live Ekubo price…");
    reviewLines.push(`The action will use ${formatUnits(state.amountWei, 18, 18)} ${IN_SYMBOL} from your private balance, swap on Ekubo, and return ${OUT_SYMBOL} to that private balance.`);
  }
  $("review-panel").innerHTML = reviewLines.length
    ? reviewLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")
    : "<p>Connect Ready X to begin.</p>";

  $("confirm").disabled = !connected
    || !isMainnet(state.chainId)
    || !hasNativeStrk20(state.apiVersions)
    || !state.helperDeployed
    || state.balanceWei === null
    || Boolean(state.amountError)
    || state.balanceWei < state.amountWei
    || !state.quote
    || state.executing;
  $("execute").disabled = !canExecute();
  $("refresh").disabled = !connected || state.executing;
  $("copy-diagnostics").disabled = !connected;
}

function safeDiagnostics() {
  return JSON.stringify({
    wallet: state.wallet ? { id: state.wallet.id, name: state.wallet.name, version: state.wallet.version } : null,
    injection: state.injection,
    account: state.account,
    chain_id: state.chainId,
    wallet_api_versions: state.apiVersions,
    shielded_strk_balance_wei: state.balanceWei?.toString() ?? null,
    selected_input_wei: state.amountWei.toString(),
    facet_targets: { pool: POOL, router: ROUTER, helper: HELPER, helper_class_hash: HELPER_CLASS_HASH },
    quote: state.quote ? { quoted_wei: state.quote.quotedWei.toString(), minimum_wei: state.quote.minimumWei.toString() } : null,
    last_error: state.errors.at(-1) ?? null,
    transaction_hash: state.transactionHash,
    proof_generated_by_page: false,
  }, null, 2);
}

// The page describes what it wants; executor.js decides what that becomes and whether the route's
// policy permits it. Nothing here hand-assembles a Ready X action.
function planForQuote(quote) {
  return {
    protocol: ROUTE_ID,
    calls: [{
      contractAddress: ROUTER,
      entrypoint: "swap",
      calldata: [TOKEN_IN, hex(state.amountWei), "0x0", ...u256(quote.minimumWei)],
    }],
    // This helper route returns into an OPEN shielded note and exposes no user-selected recipient.
    publicRecipients: [],
    input: { token: TOKEN_IN, amount: hex(state.amountWei) },
    settlements: [{
      token: TOKEN_OUT,
      policy: { type: "diff" },
      reason: `Settle only the ${OUT_SYMBOL} this swap produced.`,
    }],
  };
}


async function connect() {
  const candidates = candidateWallets();
  if (!candidates.length) {
    state.errors = ["Ready X was not found in this tab."];
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
    const result = await readWalletState(selected.wallet, TOKEN_IN);
    state.account = result.account;
    state.chainId = result.chainId;
    state.apiVersions = result.versions;
    state.balanceWei = result.balanceWei;
    state.errors = result.errors;
    state.connected = Boolean(state.account);
    if (state.connected) {
      const helperState = await checkHelper(rpc, HELPER, HELPER_CLASS_HASH);
      state.helperDeployed = helperState.deployed;
      if (helperState.error) state.errors.push(helperState.error);
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
    const result = await readWalletState(state.wallet, TOKEN_IN, true);
    state.account = result.account ?? state.account;
    state.chainId = result.chainId;
    state.apiVersions = result.versions;
    state.balanceWei = result.balanceWei;
    state.errors = result.errors;
    const helperState = await checkHelper(rpc, HELPER, HELPER_CLASS_HASH);
      state.helperDeployed = helperState.deployed;
      if (helperState.error) state.errors.push(helperState.error);
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

async function execute() {
  if (!state.wallet || !canExecute()) return;
  state.executing = true;
  state.transactionHash = null;
  setStatus("signing", "Refreshing the price, then asking your wallet to complete the private swap…");
  render();
  try {
    const quote = await readQuote();
    if (!state.connected || !state.account || !isMainnet(state.chainId) || !hasNativeStrk20(state.apiVersions)
      || !state.helperDeployed || state.balanceWei === null || state.balanceWei < state.amountWei
      || !state.quote || !$("confirm").checked) {
      throw new Error("The review changed while refreshing the quote. Review it again.");
    }
    const transactionHash = await submitPlan(state.wallet, planForQuote(quote), {
      owner: state.account, linkedAddresses: [state.account], binding: BINDING, policy: POLICY,
    });
    state.transactionHash = transactionHash;
    setStatus("submitted", "Your wallet returned a transaction hash; waiting for Mainnet acceptance…");
    $("result-panel").innerHTML = `<p>Submitted: <a href="https://voyager.online/tx/${encodeURIComponent(transactionHash)}" target="_blank" rel="noreferrer">${escapeHtml(transactionHash)}</a></p>`;
    const receipt = await waitForReceipt(rpc, transactionHash);
    if (receipt) {
      // Local activity record only: this notes what this browser did, and controls nothing on chain.
      const lifecycle = ekubo.lifecycle ?? {};
      recordActivity(state.account, lifecycle.contextApp ?? ROUTE_ID, {
        hash: transactionHash, asset: felt(TOKEN_OUT), symbol: OUT_SYMBOL,
        kind: POLICY.assetKinds[felt(TOKEN_OUT)] ?? "fungible", action: ROUTE_ID === "ekubo-exit" ? "exit" : "swap",
        removeAssets: lifecycle.closesAssets ?? [],
      });
    }
  } catch (error) {
    state.errors = [errorText(error)];
    setStatus("error", "Ready did not complete the reviewed Mainnet action.");
    $("result-panel").innerHTML = `<p>${escapeHtml(errorText(error))}</p>`;
  } finally {
    state.executing = false;
    render();
  }
}

$("connect").onclick = connect;
$("refresh").onclick = refresh;
$("execute").onclick = execute;
$("confirm").onchange = render;
$("copy-diagnostics").onclick = () => copyToClipboard(safeDiagnostics());
$("amount-input").oninput = () => {
  try {
    state.amountWei = parseTokenAmount($("amount-input").value, 18, IN_SYMBOL);
    state.amountError = "";
  } catch (error) {
    state.amountError = error instanceof Error ? error.message : `Enter a valid ${IN_SYMBOL} amount.`;
  }
  state.quote = null;
  $("confirm").checked = false;
  render();
};
$("amount-input").onchange = async () => {
  if (!state.amountError && state.connected && isMainnet(state.chainId) && state.helperDeployed) {
    state.errors = state.errors.filter((error) => !error.startsWith("Ekubo quote:"));
    try { await readQuote(); } catch (error) { state.errors = [`Ekubo quote: ${errorText(error)}`]; }
    render();
  }
};

if (!candidateWallets().length) setStatus("idle", "Ready X will be checked when you press Connect.");
else setStatus("connected", "Ready X detected. Press Connect to review the Mainnet action.");
render();
