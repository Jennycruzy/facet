import "./theme.js";
import { recordActivity } from "./facet-map.js";
import { parseTokenAmount } from "./amount.js";
import {
  $, candidateWallets, chainLabel, checkHelper, copyToClipboard, createRpc, errorText, escapeHtml,
  felt, formatUnits, hasNativeStrk20, hex, isMainnet, readWalletState, request, sameAddress,
  setStatus, short, u256, u256FromResult, waitForReceipt,
} from "./route-runtime.js";
import { erc4626HelperBinding, submitPlan } from "./executor.js";

const DEFAULT_AMOUNT = 100000000000000000n;
const ASSET_SELECTOR = "0x3d4060688a1800ae986e4840aebc924bb40b5bf44de4583df2257220b54b77c";
const PREVIEW_DEPOSIT_SELECTOR = "0x2152e6631b3dd14160be68ee388eeb94d1e2b02e5c1a4c6ce5da69272c5057e";
const MAX_DEPOSIT_SELECTOR = "0x2fd569757f93fe6ed633ee19eed3342f42bf8bf6cad11cc5d4e24c50e354ccd";

const data = await fetch("data/facets.json").then((response) => {
  if (!response.ok) throw new Error("Facet configuration unavailable (" + response.status + ").");
  return response.json();
});

const MAINNET_CHAIN_IDS = new Set(["SN_MAIN", "0X534E5F4D41494E"]);
const MAINNET_RPC = data.networks.mainnet.rpc;
const MAINNET_POOL = data.networks.mainnet.pool;
const STRK = data.strk;

const app = data.apps.find((candidate) => candidate.id === "endur");
if (!app) throw new Error("Endur route is missing from Facet configuration.");

const network = data.networks.mainnet;
const HELPER = app.helper;
const HELPER_CLASS_HASH = app.helperClassHash;
const OUTPUT_TOKEN = app.outputToken;
const OUTPUT_SYMBOL = app.outputSymbol;
const EXECUTION_ENABLED = app.executionEnabled !== false;
const BLOCK_REASON = app.blockReason ?? "This protocol route is paused.";
const TOKEN_IN = STRK;
const TOKEN_OUT = OUTPUT_TOKEN;
const rpc = createRpc(MAINNET_RPC);
const POLICY = {
  supportedAssets: app.policy.supportedAssets,
  amountBounds: app.policy.amountBounds,
  assetKinds: Object.fromEntries(
    Object.entries(app.policy.assetKinds).map(([token, kind]) => [felt(token), kind]),
  ),
};
const BINDING = erc4626HelperBinding({ helper: HELPER, operation: "deposit" });

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
  amountWei: DEFAULT_AMOUNT,
  amountError: "",
};

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
    calldata: u256(state.amountWei),
  }, "latest"]);
  const shares = u256FromResult(preview);
  if (shares <= 0n) throw new Error(app.contractLabel + " returned zero shares for the selected input.");
  const maxDeposit = u256FromResult(await rpc("starknet_call", [{
    contract_address: app.contract,
    entry_point_selector: MAX_DEPOSIT_SELECTOR,
    calldata: [HELPER],
  }, "latest"]));
  if (maxDeposit < state.amountWei) {
    throw new Error(app.contractLabel + " currently accepts less than the selected deposit.");
  }
  state.protocolDeployed = Boolean(classHash && !sameAddress(classHash, "0x0"));
  state.quote = { shares, maxDeposit, checkedAt: Date.now(), classHash };
  return state.quote;
}

function canExecute() {
  return Boolean(
    state.connected
      && state.account
      && isMainnet(state.chainId)
      && hasNativeStrk20(state.apiVersions)
      && state.helperDeployed
      && state.protocolDeployed
      && state.balanceWei !== null
      && !state.amountError
      && state.balanceWei >= state.amountWei
      && state.quote
      && $("confirm").checked
      && EXECUTION_ENABLED
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
    const enough = !state.amountError && state.balanceWei >= state.amountWei;
    $("balance-pill").textContent = enough ? "enough for input" : "too small";
    $("balance-pill").className = "pill " + (enough ? "pill-good" : "");
  }
  const selectedAmount = formatUnits(state.amountWei, 18, 18) + " STRK";
  $("input-summary").textContent = selectedAmount;
  $("deposit-summary").textContent = selectedAmount;
  $("amount-error").textContent = state.amountError;
  $("confirm-copy").textContent = "I reviewed the route. It will use " + selectedAmount
    + " from my private balance and show the final approval in my wallet.";

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
  if (!EXECUTION_ENABLED) reviewLines.push("PAUSED: " + BLOCK_REASON);
  if (connected && !isMainnet(state.chainId)) reviewLines.push("STOP: switch Ready X to Starknet Mainnet.");
  if (connected && !hasNativeStrk20(state.apiVersions)) {
    reviewLines.push("STOP: this wallet does not support the private action required by this route.");
  }
  if (state.protocolDeployed === false) {
    reviewLines.push("The " + app.contractLabel + " contract is not available at its configured address.");
  }
  if (state.helperDeployed === false) {
    reviewLines.push("The reviewed helper address is reserved but not deployed yet.");
  }
  if (state.amountError) reviewLines.push(state.amountError);
  if (state.balanceWei !== null && !state.amountError && state.balanceWei < state.amountWei) {
    reviewLines.push("The shielded STRK balance is below the selected input.");
  }
  if (state.errors.length) reviewLines.push(...state.errors);
  if (!reviewLines.length && connected) {
    reviewLines.push(
      state.quote
        ? "Mainnet, route, balance, and live app checks passed."
        : "Mainnet and route checks passed; fetching a live " + app.name + " rate…",
    );
    reviewLines.push(
      "The action will use " + selectedAmount + " from your private balance, call " + app.contractLabel
        + ", and return " + OUTPUT_SYMBOL + " to that private balance.",
    );
  }
  $("review-panel").innerHTML = reviewLines.length
    ? reviewLines.map((line) => "<p>" + escapeHtml(line) + "</p>").join("")
    : "<p>Connect Ready X to begin.</p>";

  const reviewReady = EXECUTION_ENABLED
    && connected && isMainnet(state.chainId) && hasNativeStrk20(state.apiVersions)
    && state.helperDeployed && state.protocolDeployed && state.quote
    && !state.amountError && state.balanceWei !== null && state.balanceWei >= state.amountWei;
  $("confirm").disabled = !reviewReady || state.executing;
  $("execute").textContent = EXECUTION_ENABLED ? "Request reviewed action" : "Route paused";
  $("execute").disabled = !canExecute();
  $("refresh").disabled = !connected || state.executing;
  $("copy-diagnostics").disabled = !connected;
}

// Same executor, same policy gate, different helper binding. The action list is not written here.
function planForProtocol() {
  return {
    protocol: app.id,
    calls: [{ contractAddress: OUTPUT_TOKEN, entrypoint: "deposit", calldata: [] }],
    // The helper receives the vault shares and settles them into an OPEN shielded note.
    publicRecipients: [],
    input: { token: TOKEN_IN, amount: hex(state.amountWei) },
    settlements: [{
      token: TOKEN_OUT,
      policy: { type: "diff" },
      reason: `Settle only the ${OUTPUT_SYMBOL} this interaction produced.`,
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
  setStatus("signing", "Reading Mainnet state for " + app.name + " from "
    + (selected.wallet.name || selected.name) + "…");
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
      if (isMainnet(state.chainId)) {
        try { await readProtocolState(); } catch (error) {
          state.protocolDeployed = false;
          state.errors.push(app.name + " quote: " + errorText(error));
        }
      }
    }
    if (state.errors.length) setStatus("error", "Ready responded, but a review check needs attention.");
    else if (!isMainnet(state.chainId)) setStatus("error", "Connected to " + chainLabel(state.chainId) + ". Switch to Mainnet.");
    else if (!EXECUTION_ENABLED) setStatus("error", app.name + " route is paused; no transaction was requested.");
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
    const result = await readWalletState(state.wallet, TOKEN_IN, true);
    state.account = result.account ?? state.account;
    state.chainId = result.chainId;
    state.apiVersions = result.versions;
    state.balanceWei = result.balanceWei;
    state.errors = result.errors;
    const helperState = await checkHelper(rpc, HELPER, HELPER_CLASS_HASH);
      state.helperDeployed = helperState.deployed;
      if (helperState.error) state.errors.push(helperState.error);
    if (isMainnet(state.chainId)) {
      try { await readProtocolState(); } catch (error) {
        state.protocolDeployed = false;
        state.errors.push(app.name + " quote: " + errorText(error));
      }
    }
    setStatus(
      state.errors.length || !EXECUTION_ENABLED ? "error" : "bound",
      state.errors.length
        ? "Refresh returned errors."
        : !EXECUTION_ENABLED
        ? app.name + " route is paused; no transaction was requested."
        : "Review state refreshed; no transaction was requested.",
    );
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
  setStatus("signing", "Refreshing the " + app.name + " rate, then asking your wallet to complete the private action…");
  render();
  try {
    await readProtocolState();
    if (!state.connected || !state.account || !isMainnet(state.chainId) || !hasNativeStrk20(state.apiVersions)
      || !state.helperDeployed || !state.protocolDeployed || state.balanceWei === null
      || state.balanceWei < state.amountWei || !state.quote || !$("confirm").checked) {
      throw new Error("The review changed while refreshing the protocol quote. Review it again.");
    }
    const transactionHash = await submitPlan(state.wallet, planForProtocol(), {
      owner: state.account, linkedAddresses: [state.account], binding: BINDING, policy: POLICY,
    });
    state.transactionHash = transactionHash;
    setStatus("submitted", "Your wallet returned a transaction hash; waiting for Mainnet acceptance…");
    $("result-panel").innerHTML = "<p>Submitted: <a href=\""
      + network.explorer + "/tx/" + encodeURIComponent(transactionHash)
      + "\" target=\"_blank\" rel=\"noreferrer\">" + escapeHtml(transactionHash) + "</a></p>";
    const receipt = await waitForReceipt(rpc, transactionHash);
    if (receipt) {
      // Local activity record only: this notes what this browser did, and controls nothing on chain.
      recordActivity(state.account, app.id, {
        hash: transactionHash, asset: felt(TOKEN_OUT), symbol: OUTPUT_SYMBOL,
        kind: POLICY.assetKinds[felt(TOKEN_OUT)] ?? "fungible", action: "stake",
      });
    }
  } catch (error) {
    state.errors = [errorText(error)];
    setStatus("error", "Ready did not complete the reviewed " + app.name + " action.");
    $("result-panel").innerHTML = "<p>" + escapeHtml(errorText(error)) + "</p>";
  } finally {
    state.executing = false;
    render();
  }
}

function safeDiagnostics() {
  return JSON.stringify({
      wallet: state.wallet
        ? { id: state.wallet.id, name: state.wallet.name, version: state.wallet.version }
        : null,
      injection: state.injection,
      application: app.id,
      account: state.account,
      chain_id: state.chainId,
      wallet_api_versions: state.apiVersions,
      shielded_strk_balance_wei: state.balanceWei?.toString() ?? null,
      selected_input_wei: state.amountWei.toString(),
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
    }, null, 2);
}

function configurePage() {
  document.title = "Facet · Mainnet " + app.name;
  $("protocol-eyebrow").textContent = "Facet Mainnet · " + app.name;
  $("hero-title").textContent = EXECUTION_ENABLED ? "Use the live " + app.name + " route." : app.name + " route paused.";
  $("hero-lede").textContent = EXECUTION_ENABLED
    ? "Your private balance supplies " + app.name + ". Facet provides the fixed route, and your wallet "
      + "shows the final approval."
    : BLOCK_REASON + " This page remains available for read-only inspection; no wallet transaction can be requested.";
  $("output-symbol").textContent = OUTPUT_SYMBOL;
  $("protocol-label").textContent = app.contractLabel;
  $("protocol-note").textContent = EXECUTION_ENABLED
    ? "Your wallet completes the private steps. The receipt must show the private balance, the Facet route, "
      + "and " + app.contractLabel + " before it is counted as verified integration evidence. The "
      + OUTPUT_SYMBOL + " position remains in " + app.name + " until you explicitly redeem it."
    : "This route is paused after a live protocol execution failure. No new transaction is requested or counted.";
}

configurePage();
$("connect").onclick = connect;
$("refresh").onclick = refresh;
$("execute").onclick = execute;
$("confirm").onchange = render;
$("copy-diagnostics").onclick = () => copyToClipboard(safeDiagnostics());
$("amount-input").oninput = () => {
  try {
    state.amountWei = parseTokenAmount($("amount-input").value, 18, "STRK");
    state.amountError = "";
  } catch (error) {
    state.amountError = error instanceof Error ? error.message : "Enter a valid STRK amount.";
  }
  state.quote = null;
  $("confirm").checked = false;
  render();
};
$("amount-input").onchange = async () => {
  if (!state.amountError && state.connected && isMainnet(state.chainId) && state.helperDeployed) {
    state.errors = state.errors.filter((error) => !error.startsWith(`${app.name} quote:`));
    try { await readProtocolState(); } catch (error) { state.errors = [`${app.name} quote: ${errorText(error)}`]; }
    render();
  }
};

if (!candidateWallets().length) setStatus("idle", "Ready X will be checked when you press Connect.");
else setStatus("connected", "Ready X detected. Press Connect to review the Mainnet action.");
render();
