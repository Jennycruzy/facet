import { createDecipheriv, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  Account,
  Contract,
  RpcProvider,
  Signer,
  TransactionType,
  constants,
  ec,
  hash,
  num,
  stark,
} from "starknet";
import { keccak_256 } from "@noble/hashes/sha3";
import { homedir } from "node:os";

// Gate C deliberately uses the generic shadow-account call path. No executor contract is
// required: the shadow account transfers STRK to Ekubo, swaps, clears the input remainder, and
// clears the ETH output. The private pool then settles both token balances into open notes.
const PRIVACY_SDK_ROOT = process.env.FACET_PRIVACY_SDK_ROOT
  ?? `${homedir()}/starknet-privacy/sdk`;
const { ContractDiscoveryProvider } = await import(
  pathToFileURL(`${PRIVACY_SDK_ROOT}/dist/testing/index.js`),
);
const {
  ProvingServiceProofProvider,
  ShadowAccountAnonymizerABI,
  createPrivateTransfers,
  createEmptyRegistry,
  Open,
} = await import(pathToFileURL(`${PRIVACY_SDK_ROOT}/dist/index.js`));

const NETWORK = process.env.FACET_NETWORK ?? "sepolia";
const IS_MAINNET = NETWORK === "mainnet";
if (!IS_MAINNET && NETWORK !== "sepolia") throw new Error("FACET_NETWORK must be mainnet or sepolia.");

const RPC_URL = process.env.FACET_RPC_URL ?? (IS_MAINNET
  ? "https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_10"
  : "https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10");
const CHAIN_ID = IS_MAINNET ? constants.StarknetChainId.SN_MAIN : constants.StarknetChainId.SN_SEPOLIA;
const PROVER_SSH_HOST = process.env.FACET_PROVER_SSH_HOST ?? "root@38.49.216.59";
const PROVER_SSH_KEY = process.env.FACET_PROVER_SSH_KEY ?? `${homedir()}/.ssh/devfun_jennycruzy`;
const PROVER_REMOTE_PORT = Number(process.env.FACET_PROVER_REMOTE_PORT ?? "3100");
// Keep detached SSH forwards for different VPS workers on different local ports. A
// prior run may have left a healthy tunnel open, but health alone does not identify
// which remote worker it targets.
const PROVER_LOCAL_PORT = process.env.FACET_PROVER_LOCAL_PORT
  ?? String(30_000 + PROVER_REMOTE_PORT);
const PROVER_URL = process.env.FACET_PROVER_URL ?? `http://127.0.0.1:${PROVER_LOCAL_PORT}`;
const PROVER_CONTAINER = process.env.FACET_PROVER_CONTAINER
  ?? (IS_MAINNET ? "facet-prover-gate-a-53f6" : "facet-prover-gate-a");

const SEPOLIA_GATE_DIR = `${homedir()}/.facet-secrets/starknet-gate-a-new`;
const MAINNET_GATE_DIR = `${homedir()}/.facet-secrets/starknet-gate2`;
const ACCOUNT_DIR = process.env.FACET_ACCOUNT_DIR ?? (IS_MAINNET ? MAINNET_GATE_DIR : SEPOLIA_GATE_DIR);
const ACCOUNT_FILE = `${ACCOUNT_DIR}/account.json`;
const KEYSTORE_FILE = `${ACCOUNT_DIR}/keystore.json`;

const OFFICIAL_SEPOLIA_POOL = "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const MAINNET_POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const SEPOLIA_ROUTER = "0x0045f933adf0607292468ad1c1dedaa74d5ad166392590e72676a34d01d7b763";
const MAINNET_ROUTER = "0x0199741822c2dc722f6f605204f35e56dbc23bceed54818168c4c49e4fb8737e";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const SEPOLIA_ANONYMIZER = "0x21c875a218b083af2bc7e48b8ee753cce3d77380053a659ebbe931ca056879b";
const MAINNET_ANONYMIZER = "0x741fe9dcdf3729919e8c44422fbb963e76a0788f3abad20bb25a50445f363bc";
const TEST_POOL_FILE = `${SEPOLIA_GATE_DIR}/test-pool.json`;
const SELFHOST_CLIENT_FILE = process.env.FACET_PAYMASTER_CLIENT_FILE
  ?? `${SEPOLIA_GATE_DIR}/selfhost-paymaster-client-v2.json`;
const SHADOW_ACCOUNT_CLASS_HASH =
  "0x346e143e3b353473a0d6f681c31ffcf2866537898008027fb3b57335bad7b5f";

const TOKEN0 = STRK;
const TOKEN1 = ETH;
const ROUTER = IS_MAINNET ? MAINNET_ROUTER : SEPOLIA_ROUTER;
const DEFAULT_POOL = IS_MAINNET ? MAINNET_POOL : OFFICIAL_SEPOLIA_POOL;
let pool = DEFAULT_POOL;
// These are pool-key parameters, not arbitrary slippage settings. The live Starknet
// mainnet STRK/ETH pool is the 0.05% / 1000-tick pool; the previous 0.01% / 200-tick
// key is deployed infrastructure but is not initialized for this pair and fails with
// NOT_INITIALIZED during quote_swap.
const MAINNET_ROUTE_FEE = 170141183460469235273462165868118016n; // 0.05%
const SEPOLIA_ROUTE_FEE = 170141183460469231731687303715884105n; // 0.05%
const ROUTE_FEE = IS_MAINNET ? MAINNET_ROUTE_FEE : SEPOLIA_ROUTE_FEE;
const TICK_SPACING = IS_MAINNET ? 1000n : 50n;
const SWAP_AMOUNT = BigInt(process.env.FACET_GATE_C_AMOUNT ?? "100000000000000000"); // 0.1 STRK
const DEPOSIT_AMOUNT = BigInt(
  process.env.FACET_GATE_C_DEPOSIT_AMOUNT ?? SWAP_AMOUNT.toString(),
);
const DAPP_NAME = process.env.FACET_DAPP_NAME ?? "facet-gate-c-ekubo-v1";
const NONCE = BigInt(process.env.FACET_GATE_C_NONCE ?? "0");
const SLIPPAGE_BPS = BigInt(process.env.FACET_GATE_C_SLIPPAGE_BPS ?? "1000");
const MAX_MAINNET_SPEND_STRK = BigInt(process.env.FACET_MAINNET_MAX_SPEND_STRK ?? "5");
const MAINNET_PREFLIGHT_ONLY = process.env.FACET_MAINNET_PREFLIGHT_ONLY === "1";
const MAINNET_PAYMASTER_URL = process.env.FACET_MAINNET_PAYMASTER_URL
  ?? "https://starknet.paymaster.avnu.fi";
const MAINNET_PAYMASTER_MODE = process.env.FACET_MAINNET_PAYMASTER_MODE ?? "default";
const MAX_MAINNET_SPEND = MAX_MAINNET_SPEND_STRK * 1_000_000_000_000_000_000n;
// Starknet Mainnet currently runs the 0.14.3 protocol constants. The node validates
// these facts before the privacy pool is called, so reject a worker from the legacy
// 0.14.2/PROOF0 generation path before handing a proof to the paymaster.
const MAINNET_PROOF_VERSION = "0x50524f4f4631"; // PROOF1
const MAINNET_VIRTUAL_OS_PROGRAM_HASH =
  "0x53f6c9fcfd31d27279ff7d7e422b44623550a732b59fe193354a7316a96daa1";
const MAINNET_SCREENING_READY = process.env.FACET_MAINNET_SCREENING_READY === "1";
let poolFeeWei = 0n;
if (SWAP_AMOUNT <= 0n) throw new Error("FACET_GATE_C_AMOUNT must be positive.");
if (DEPOSIT_AMOUNT < SWAP_AMOUNT) {
  throw new Error("FACET_GATE_C_DEPOSIT_AMOUNT must cover FACET_GATE_C_AMOUNT.");
}
if (IS_MAINNET && SWAP_AMOUNT >= MAX_MAINNET_SPEND) {
  throw new Error(`Gate C input must stay below the authorized ${MAX_MAINNET_SPEND_STRK} STRK ceiling.`);
}

function promptHidden(prompt) {
  if (!process.stdin.isTTY) throw new Error("Run this script directly in a terminal.");
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const restore = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (char) => {
      if (char === "\u0003") {
        process.stdin.off("data", onData);
        restore();
        reject(new Error("Cancelled"));
      } else if (char === "\r" || char === "\n") {
        process.stdin.off("data", onData);
        restore();
        resolve(value);
      } else if (char === "\u007f" || char === "\b") {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}

function decryptKeystore(keystore, password) {
  const crypto = keystore.crypto;
  const params = crypto.kdfparams;
  const derived = scryptSync(password, Buffer.from(params.salt, "hex"), params.dklen, {
    N: params.n,
    r: params.r,
    p: params.p,
    maxmem: 128 * params.n * params.r * 2,
  });
  const ciphertext = Buffer.from(crypto.ciphertext, "hex");
  const expectedMac = Buffer.from(crypto.mac, "hex");
  const actualMac = Buffer.from(keccak_256(Buffer.concat([derived.subarray(16, 32), ciphertext])));
  if (!timingSafeEqual(expectedMac, actualMac)) throw new Error("Incorrect keystore password.");
  const decipher = createDecipheriv(
    "aes-128-ctr",
    derived.subarray(0, 16),
    Buffer.from(crypto.cipherparams.iv, "hex"),
  );
  return `0x${Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("hex")}`;
}

const first = (values) => values[0];
const hex = (value) => `0x${BigInt(value).toString(16)}`;
const u256 = (value) => [hex(value & ((1n << 128n) - 1n)), hex(value >> 128n)];

function deriveViewingKey(privateKey, address) {
  const messageHash = hash.starknetKeccak(`${CHAIN_ID}:${pool}`);
  const signature = ec.starkCurve.sign(`0x${messageHash.toString(16)}`, privateKey);
  const order = ec.starkCurve.CURVE.n;
  const halfOrder = order >> 1n;
  let key = BigInt(hash.computePoseidonHashOnElements([signature.r, signature.s])) % order;
  if (key >= halfOrder) key = order - key;
  return key === 0n ? 1n : key;
}

function makePoolViews(provider) {
  const view = (entrypoint, calldata = []) => provider.callContract({
    contractAddress: pool,
    entrypoint,
    calldata,
  });
  const boolView = async (entrypoint, calldata) => BigInt(first(await view(entrypoint, calldata))) !== 0n;
  return {
    channel_exists: (marker) => boolView("channel_exists", [marker]),
    get_num_of_channels: async (address) => BigInt(first(await view("get_num_of_channels", [address]))),
    get_channel_info: async (address, index) => {
      const result = await view("get_channel_info", [address, index]);
      return { ephemeral_pubkey: result[0], enc_channel_key: result[1], enc_sender_addr: result[2] };
    },
    subchannel_exists: (marker) => boolView("subchannel_exists", [marker]),
    get_subchannel_info: async (id) => {
      const result = await view("get_subchannel_info", [id]);
      return { salt: result[0], enc_token: result[1] };
    },
    get_outgoing_channel_info: async (id) => {
      const result = await view("get_outgoing_channel_info", [id]);
      return { salt: result[0], enc_recipient_addr: result[1] };
    },
    get_note: async (id) => {
      const result = await view("get_note", [id]);
      return { packed_value: result[0], token: result[1] };
    },
    nullifier_exists: (nullifier) => boolView("nullifier_exists", [nullifier]),
    get_public_key: async (address) => BigInt(first(await view("get_public_key", [address]))),
  };
}

async function preflightInvocation(provider, invocation, label) {
  console.log(`Preflighting ${label} signature and actions on ${NETWORK}...`);
  const simulations = await provider.channel.simulateTransaction([{
    type: TransactionType.INVOKE,
    contractAddress: invocation.sender_address,
    calldata: invocation.calldata,
    signature: invocation.signature,
    nonce: invocation.nonce,
    version: invocation.version,
    resourceBounds: invocation.resource_bounds,
    tip: invocation.tip,
    paymasterData: invocation.paymaster_data,
    accountDeploymentData: invocation.account_deployment_data,
    nonceDataAvailabilityMode: invocation.nonce_data_availability_mode,
    feeDataAvailabilityMode: invocation.fee_data_availability_mode,
  }], { blockIdentifier: "latest", skipValidate: true, skipFeeCharge: true });
  const executeInvocation = simulations?.[0]?.transaction_trace?.execute_invocation
    ?? simulations?.[0]?.transactionTrace?.executeInvocation;
  const revertReason = executeInvocation?.revert_reason ?? executeInvocation?.revertReason;
  if (revertReason) throw new Error(`${label} preflight reverted: ${revertReason}`);
  console.log(`${label} preflight passed.`);
}

function callProverWithCurl(method, params, maxTimeSeconds = 1800) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params });
  return new Promise((resolve, reject) => {
    const child = spawn("curl", [
      "--silent", "--show-error", "--max-time", String(maxTimeSeconds),
      "--header", "Content-Type: application/json", "--data-binary", "@-", PROVER_URL,
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Prover curl exited ${code}: ${Buffer.concat(stderr).toString("utf8")}`));
        return;
      }
      try {
        const response = JSON.parse(Buffer.concat(stdout).toString("utf8"));
        if (response.error) {
          reject(new Error(`Prover RPC ${response.error.code}: ${response.error.message}${
            response.error.data ? `: ${response.error.data}` : ""
          }`));
          return;
        }
        resolve(response.result);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(body);
  });
}

let proverTunnel;

async function proverHealthCheck() {
  try {
    const version = await callProverWithCurl("starknet_specVersion", [], 10);
    return typeof version === "string" && version.length > 0;
  } catch {
    return false;
  }
}

async function ensureProverTunnel() {
  if (!PROVER_URL.startsWith("http://127.0.0.1:")) return;
  if (await proverHealthCheck()) return;

  if (!proverTunnel) {
    const localPort = new URL(PROVER_URL).port || "80";
    proverTunnel = spawn("ssh", [
      "-i", PROVER_SSH_KEY,
      "-o", "IdentitiesOnly=yes",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ServerAliveInterval=30",
      "-o", "ServerAliveCountMax=3",
      "-N",
      "-L", `${localPort}:127.0.0.1:${PROVER_REMOTE_PORT}`,
      PROVER_SSH_HOST,
    ], { stdio: "ignore", detached: true });
    proverTunnel.unref();
  }

  for (let attempt = 1; attempt <= 36; attempt += 1) {
    if (await proverHealthCheck()) {
      console.log(`Prover tunnel ready on ${PROVER_URL} -> VPS port ${PROVER_REMOTE_PORT}.`);
      return;
    }
    await delay(5_000);
  }
  throw new Error(`Prover tunnel did not become ready on ${PROVER_URL} within three minutes.`);
}

function runProcess(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(`${label} exited ${code}: ${Buffer.concat(stderr).toString("utf8")}`));
    });
  });
}

async function recycleLocalProver(nextProof) {
  if (!PROVER_URL.startsWith("http://127.0.0.1:")) return;
  await ensureProverTunnel();
  console.log(`Recycling the prover to release proof memory before ${nextProof}...`);
  await runProcess("ssh", [
    "-i", PROVER_SSH_KEY, "-o", "IdentitiesOnly=yes", PROVER_SSH_HOST,
    "docker", "restart", "--timeout", "30", PROVER_CONTAINER,
  ], "Prover restart");
  for (let attempt = 1; attempt <= 36; attempt += 1) {
    await delay(5_000);
    if (await proverHealthCheck()) {
      console.log("Prover restarted and ready.");
      return;
    }
  }
  throw new Error("Prover did not become ready within three minutes after restart.");
}

async function proveWithCurl(invocation) {
  const result = await callProverWithCurl("starknet_proveTransaction", {
    block_id: "latest",
    transaction: invocation,
  });
  const poolMessage = result.l2_to_l1_messages?.find(
    (message) => message.from_address?.toLowerCase() === String(invocation.sender_address).toLowerCase(),
  );
  const proofFacts = [...(result.proof_facts ?? [])];
  // Preserve the proof facts emitted by the prover. The proof-version marker
  // and virtual OS hash are a versioned pair; rewriting only the marker makes
  // the proof facts internally inconsistent. Validate the original pair against
  // the current Mainnet protocol instead of trying to make an incompatible
  // prover response look like an older format.
  if (IS_MAINNET) {
    const proofVersion = String(proofFacts[0] ?? "").toLowerCase();
    const virtualOsHash = String(proofFacts[2] ?? "").toLowerCase();
    if (proofVersion !== MAINNET_PROOF_VERSION || virtualOsHash !== MAINNET_VIRTUAL_OS_PROGRAM_HASH) {
      throw new Error(
        "Mainnet prover emitted an incompatible proof-facts pair: "
        + `version ${proofFacts[0] ?? "missing"}, virtual OS ${proofFacts[2] ?? "missing"}; `
        + `expected ${MAINNET_PROOF_VERSION} / ${MAINNET_VIRTUAL_OS_PROGRAM_HASH}. `
        + "Use the Mainnet 0.14.3-compatible prover worker.",
      );
    }
  }
  return {
    data: result.proof,
    output: poolMessage?.payload ?? [],
    proofFacts,
    additionalData: result.additional_data,
  };
}

function requireMainnetScreeningAttestation(proofResult, label) {
  if (!IS_MAINNET) return;
  const signature = proofResult?.callAndProof?.proof?.additionalData?.signature;
  if (
    !signature
    || signature.issued_at === undefined
    || signature.sig_r === undefined
    || signature.sig_s === undefined
  ) {
    throw new Error(
      `${label} proof completed without a Mainnet screening attestation. `
      + "The live privacy pool requires a fresh screener signature for the initial deposit. "
      + "Configure the prover with the official screening sidecar and set "
      + "FACET_MAINNET_SCREENING_READY=1 only after its /health and /metrics checks pass.",
    );
  }
}

function toPaymasterCall(call) {
  return {
    to: call.contractAddress,
    selector: hash.getSelectorFromName(call.entrypoint),
    calldata: (call.calldata ?? []).map((value) => num.toHex(value)),
  };
}

async function paymasterRpc(url, apiKey, method, params) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["x-paymaster-api-key"] = apiKey;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message} (${body.error.code})${
    body.error.data === undefined ? "" : `: ${JSON.stringify(body.error.data)}`
  }`);
  if (body.result === undefined) throw new Error(`${method}: malformed response`);
  return body.result;
}

function paymasterParameters(mode) {
  if (mode === "default") {
    return {
      version: "0x1",
      fee_mode: { mode, gas_token: STRK, tip: "normal" },
    };
  }
  return {
    version: "0x1",
    fee_mode: { mode, pool_fee_token: STRK, tip: "normal" },
  };
}

async function buildPaymasterTransaction(url, apiKey, parameters, transaction) {
  return paymasterRpc(url, apiKey, "paymaster_buildTransaction", {
    transaction,
    parameters,
  });
}

async function submitPaymasterProof(provider, url, apiKey, parameters, result, label, invoke) {
  if (IS_MAINNET && process.env.FACET_ALLOW_MAINNET_BROADCAST !== "1") {
    throw new Error(
      `${label} is ready but mainnet broadcast is disabled. ` +
      "Set FACET_ALLOW_MAINNET_BROADCAST=1 only after reviewing the displayed amount, recipient, and calldata.",
    );
  }
  const proofFacts = result.callAndProof.proof.proofFacts;
  if (!Array.isArray(proofFacts) || proofFacts.length === 0) {
    throw new Error(`${label} proof has no proof_facts; refusing to submit.`);
  }
  const applyAction = {
    apply_actions_call: toPaymasterCall(result.callAndProof.call),
    proof: result.callAndProof.proof.data,
    proof_facts: proofFacts,
  };
  const transaction = invoke
    ? { type: "invoke_and_apply_action", apply_action: applyAction, invoke }
    : { type: "apply_action", apply_action: applyAction };
  console.log(`Submitting ${label} through the privacy paymaster with ${proofFacts.length} proof facts...`);
  const submission = await paymasterRpc(url, apiKey, "paymaster_executeTransaction", {
    transaction,
    parameters,
  });
  if (!submission.transaction_hash) throw new Error(`${label}: paymaster returned no transaction hash.`);
  console.log(`${label} transaction submitted through paymaster: ${submission.transaction_hash}`);
  await waitForSuccess(provider, submission.transaction_hash, label);
  return submission.transaction_hash;
}

async function waitForSuccess(provider, transactionHash, label) {
  const receipt = await provider.waitForTransaction(transactionHash);
  if (!receipt.isSuccess()) {
    const detail = receipt.revert_reason
      ?? receipt.revertReason
      ?? receipt.execution_status
      ?? receipt.executionStatus
      ?? JSON.stringify(receipt);
    throw new Error(`${label} reverted (tx ${transactionHash}): ${detail}`);
  }
  const fee = "actual_fee" in receipt ? receipt.actual_fee : receipt.actualFee;
  console.log(`${label} receipt succeeded${fee ? `; fee ${fee.amount ?? fee}` : ""}.`);
  return receipt;
}

const accountInfo = JSON.parse(await readFile(ACCOUNT_FILE, "utf8"));
const keystore = JSON.parse(await readFile(KEYSTORE_FILE, "utf8"));
const password = await promptHidden(`Enter ${IS_MAINNET ? "mainnet" : "Gate A"} keystore password for Gate C: `);
const privateKey = decryptKeystore(keystore, password);
const address = accountInfo.deployment.address;
if (BigInt(ec.starkCurve.getStarkKey(privateKey)) !== BigInt(accountInfo.variant.public_key)) {
  throw new Error("Keystore key does not match the account descriptor.");
}

let anonymizer = IS_MAINNET ? MAINNET_ANONYMIZER : SEPOLIA_ANONYMIZER;
let paymasterUrl;
let paymasterApiKey;
let paymasterFeeParameters;
let usePaymaster = false;
if (IS_MAINNET) {
  if (!["default", "sponsored", "sponsored_private"].includes(MAINNET_PAYMASTER_MODE)) {
    throw new Error(
      "FACET_MAINNET_PAYMASTER_MODE must be default, sponsored, or sponsored_private.",
    );
  }
  paymasterUrl = MAINNET_PAYMASTER_URL;
  paymasterApiKey = process.env.FACET_MAINNET_PAYMASTER_API_KEY;
  paymasterFeeParameters = paymasterParameters(MAINNET_PAYMASTER_MODE);
  usePaymaster = true;
} else if (process.env.FACET_USE_SELFHOST !== "0") {
  if (!existsSync(SELFHOST_CLIENT_FILE) || !existsSync(TEST_POOL_FILE)) {
    throw new Error(`Self-hosted Sepolia paymaster files are missing: ${SELFHOST_CLIENT_FILE}`);
  }
  const client = JSON.parse(await readFile(SELFHOST_CLIENT_FILE, "utf8"));
  const testPool = JSON.parse(await readFile(TEST_POOL_FILE, "utf8"));
  pool = client.poolAddress;
  anonymizer = testPool.anonymizerAddress;
  paymasterUrl = client.localUrl;
  paymasterApiKey = client.apiKey;
  paymasterFeeParameters = paymasterParameters("sponsored_private");
  usePaymaster = true;
}
if (process.env.FACET_POOL_ADDRESS) pool = process.env.FACET_POOL_ADDRESS;
if (process.env.FACET_ANONYMIZER_ADDRESS) anonymizer = process.env.FACET_ANONYMIZER_ADDRESS;

// The paymaster owns network-fee estimation and submission for proof-bearing calls.
// The account is still used locally for typed-data signatures and read-only checks.
const provider = new RpcProvider({ nodeUrl: RPC_URL, resourceBoundsOverhead: false });
const chainId = await provider.getChainId();
if (BigInt(chainId) !== BigInt(CHAIN_ID)) throw new Error(`Wrong network: ${chainId}`);
const baseSigner = new Signer(privateKey);
// Proof facts are carried on the wire but are not included in the account's canonical V3
// signature hash on the privacy RPCs. This matches the successful Gate A signer shim.
const accountSigner = {
  getPubKey: (...args) => baseSigner.getPubKey(...args),
  signMessage: (...args) => baseSigner.signMessage(...args),
  signTransaction: (transactions, details) => {
    const { proofFacts: _proofFacts, proof: _proof, ...standardDetails } = details;
    return baseSigner.signTransaction(transactions, standardDetails);
  },
  signDeployAccountTransaction: (...args) => baseSigner.signDeployAccountTransaction(...args),
  signDeclareTransaction: (...args) => baseSigner.signDeclareTransaction(...args),
};
const account = new Account({ provider, address, signer: accountSigner, cairoVersion: "1" });

const balance = BigInt(first(await provider.callContract({
  contractAddress: STRK,
  entrypoint: "balance_of",
  calldata: [address],
})));
console.log(`Network: ${NETWORK}`);
console.log(`Account: ${address}`);
console.log(`Starting STRK balance: ${balance} wei (${Number(balance) / 1e18} STRK)`);
console.log(`Pool: ${pool}`);
console.log(`Anonymizer: ${anonymizer}`);
console.log(`Dapp name: ${DAPP_NAME}; nonce: ${NONCE}`);
console.log(`Ekubo Router: ${ROUTER}`);
console.log(`Swap input: ${SWAP_AMOUNT} wei STRK`);
if (usePaymaster) {
  console.log(`Privacy paymaster: ${paymasterUrl}; fee mode: ${paymasterFeeParameters.fee_mode.mode}`);
}

poolFeeWei = BigInt(first(await provider.callContract({
  contractAddress: pool,
  entrypoint: "get_fee_amount",
  calldata: [],
})));
console.log(`Pool fee: ${poolFeeWei} wei STRK (${Number(poolFeeWei) / 1e18} STRK per apply_actions).`);

const discovery = new ContractDiscoveryProvider(makePoolViews(provider));
const provingDetails = new ProvingServiceProofProvider(
  PROVER_URL,
  CHAIN_ID,
  { nodeUrl: RPC_URL, poolAddress: pool, requestTimeoutMs: 20 * 60 * 1000, retry: { maxRetries: 0 } },
);
const proving = {
  getDefaultDetails: () => provingDetails.getDefaultDetails(),
  invalidateNonceCache: () => provingDetails.invalidateNonceCache(),
  prove: proveWithCurl,
};
const viewingKey = deriveViewingKey(privateKey, address);
const transfers = createPrivateTransfers({
  account,
  viewingKeyProvider: { getViewingKey: async () => viewingKey },
  provingProvider: proving,
  discoveryProvider: discovery,
  poolContractAddress: pool,
  shadowAccountAnonymizerAddress: anonymizer,
});

// Quote the exact route on the deployed router. This is read-only and makes the slippage floor
// current at the proof's construction point instead of trusting a stale off-chain quote.
const quoteCalldata = [
  TOKEN0, TOKEN1, hex(ROUTE_FEE), hex(TICK_SPACING), "0x0", // PoolKey
  "0x0", "0x0", "0x0", // sqrt_ratio_limit u256 + skip_ahead
  TOKEN0, hex(SWAP_AMOUNT), "0x0", // TokenAmount: positive input
];
const quote = await provider.callContract({
  contractAddress: ROUTER,
  entrypoint: "quote_swap",
  calldata: quoteCalldata,
});
const quoteInput = BigInt(quote[0]);
const quoteInputSign = BigInt(quote[1]);
const quotedOutput = BigInt(quote[2]);
const quotedOutputSign = BigInt(quote[3]);
if (quoteInput !== SWAP_AMOUNT || quoteInputSign !== 0n || quotedOutputSign === 0n || quotedOutput === 0n) {
  throw new Error(`Unexpected Ekubo quote delta: ${quote.join(",")}`);
}
const minimumReceived = process.env.FACET_GATE_C_MINIMUM_OUT
  ? BigInt(process.env.FACET_GATE_C_MINIMUM_OUT)
  : quotedOutput * (10_000n - SLIPPAGE_BPS) / 10_000n;
if (minimumReceived <= 0n || minimumReceived >= quotedOutput) {
  throw new Error(`Invalid minimum output ${minimumReceived} for quote ${quotedOutput}.`);
}
console.log(`Ekubo quote: ${quotedOutput} wei ETH; minimum received: ${minimumReceived} wei ETH.`);

const routerCalls = [
  {
    contractAddress: STRK,
    entrypoint: "transfer",
    calldata: [ROUTER, ...u256(SWAP_AMOUNT)],
  },
  {
    contractAddress: ROUTER,
    entrypoint: "swap",
    calldata: [
      TOKEN0, TOKEN1, hex(ROUTE_FEE), hex(TICK_SPACING), "0x0",
      "0x0", "0x0", "0x0", // RouteNode: sqrt_ratio_limit=0, skip_ahead=0
      TOKEN0, hex(SWAP_AMOUNT), "0x0", // TokenAmount: positive STRK input
    ],
  },
  {
    contractAddress: ROUTER,
    entrypoint: "clear_minimum",
    calldata: [ETH, ...u256(minimumReceived)],
  },
];

const anonymizerContract = new Contract({
  abi: ShadowAccountAnonymizerABI,
  address: anonymizer,
  providerOrAccount: provider,
}).typedv2(ShadowAccountAnonymizerABI);

const discoveredNotes = await transfers.discoverNotes({ tokens: [BigInt(STRK), BigInt(ETH)] });
// discoverNotes returns only the notes view. The compiler also expects an initialized
// channels map because autoSetup/autoDiscover may resolve recipient channels during compile.
let discovered = {
  ...createEmptyRegistry(),
  ...discoveredNotes,
};
const discoveredChannels = await transfers.discoverChannels("all");
if (discoveredChannels.channels) discovered.channels = discoveredChannels.channels;
console.log(`Discovered ${discovered.channels.size} outgoing channel(s).`);
let notes = discovered.notes.get(BigInt(STRK)) ?? [];
// Prefer the smallest note that covers the swap. This avoids creating a large
// private change note, which materially increases the proving footprint.
let usable = notes.filter((note) => note.amount >= SWAP_AMOUNT)
  .sort((a, b) => Number(a.amount - b.amount));
console.log(`Discovered ${notes.length} unspent STRK note(s); usable note: ${usable[0] ? hex(usable[0].id) : "none"}.`);

// A proof-bearing Mainnet call must go through the privacy paymaster. The public
// starknet_addInvokeTransaction path accepts the JSON but drops proof_facts before
// execution, which makes the pool reject the call with EMPTY_PROOF_FACTS. A new
// account therefore uses AVNU's invoke_and_apply_action flow to combine the public
// approve with registration, channel setup, deposit, and the first private fee reserve.
const ownerPublicKey = BigInt(first(await provider.callContract({
  contractAddress: pool,
  entrypoint: "get_public_key",
  calldata: [address],
})));
if (IS_MAINNET && MAINNET_PREFLIGHT_ONLY) {
  console.log(`Mainnet preflight only: registration ${ownerPublicKey === 0n ? "required" : "present"}.`);
  console.log(`Mainnet preflight only: ${notes.length} unspent STRK note(s); usable note ${usable[0] ? hex(usable[0].id) : "none"}.`);
  console.log("Mainnet preflight passed without proving or broadcasting.");
  process.exit(0);
}
if (IS_MAINNET && !usePaymaster) {
  throw new Error("Mainnet proof actions require the AVNU privacy paymaster; direct RPC submission is disabled.");
}

let depositResult;
let depositTx;
let gateQuote;
if (usePaymaster) {
  if (IS_MAINNET) {
    const paymasterAvailable = await paymasterRpc(
      paymasterUrl,
      paymasterApiKey,
      "paymaster_isAvailable",
      {},
    );
    if (!paymasterAvailable) throw new Error(`Privacy paymaster is unavailable at ${paymasterUrl}.`);
  }
  gateQuote = await buildPaymasterTransaction(
    paymasterUrl,
    paymasterApiKey,
    paymasterFeeParameters,
    { type: "apply_action", apply_action: { pool_address: pool } },
  );
  if (!gateQuote.fee_action) throw new Error("Privacy paymaster returned an incomplete Gate C quote.");
  if (BigInt(gateQuote.fee_action.token) !== BigInt(STRK)) {
    throw new Error(`Gate C fee token is not STRK: ${gateQuote.fee_action.token}`);
  }
  console.log(
    `Privacy paymaster Gate C fee reserve: ${gateQuote.fee_action.amount} wei STRK ` +
    `(${Number(BigInt(gateQuote.fee_action.amount)) / 1e18} STRK).`,
  );
}

if (!usable[0]) {
  if (!usePaymaster) {
    throw new Error(
      `No private STRK note covers ${SWAP_AMOUNT} wei on ${NETWORK}. ` +
      "Gate C stopped before proving; a paymaster-backed deposit is required.",
    );
  }
  if (IS_MAINNET && !MAINNET_SCREENING_READY) {
    throw new Error(
      "Mainnet initial private deposit requires a screening attestation. "
      + "The current prover has no screening sidecar configured, so refusing to spend proof time. "
      + "Deploy the official screening sidecar backed by the authorized Mainnet screener, "
      + "verify its /health and /metrics endpoints, then set FACET_MAINNET_SCREENING_READY=1.",
    );
  }

  async function quoteDeposit(approvalAmount) {
    return buildPaymasterTransaction(
      paymasterUrl,
      paymasterApiKey,
      paymasterFeeParameters,
      {
        type: "invoke_and_apply_action",
        apply_action: { pool_address: pool },
        invoke: {
          user_address: address,
          calls: [{
            to: STRK,
            selector: hash.getSelectorFromName("approve"),
            calldata: [pool, ...u256(approvalAmount)],
          }],
        },
      },
    );
  }

  // The first private note must fund both the requested swap input and the
  // paymaster withdrawals for the deposit and the later Gate C action.
  let depositAmount = DEPOSIT_AMOUNT + BigInt(gateQuote.fee_action.amount);
  let depositQuote;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    depositQuote = await quoteDeposit(depositAmount + poolFeeWei);
    if (!depositQuote.fee_action || !depositQuote.typed_data) {
      throw new Error("Privacy paymaster returned an incomplete private-deposit quote.");
    }
    if (BigInt(depositQuote.fee_action.token) !== BigInt(STRK)) {
      throw new Error(`Private-deposit fee token is not STRK: ${depositQuote.fee_action.token}`);
    }
    const quotedAmount = DEPOSIT_AMOUNT
      + BigInt(gateQuote.fee_action.amount)
      + BigInt(depositQuote.fee_action.amount);
    if (quotedAmount === depositAmount) break;
    depositAmount = quotedAmount;
    depositQuote = undefined;
  }
  if (!depositQuote) throw new Error("Privacy paymaster private-deposit fee quote did not stabilize.");

  const transparentSpend = depositAmount + poolFeeWei;
  if (IS_MAINNET && transparentSpend >= MAX_MAINNET_SPEND) {
    throw new Error(
      `The initial Mainnet deposit plus its pool fee reaches the authorized ` +
      `${MAX_MAINNET_SPEND_STRK} STRK ceiling: ${transparentSpend} wei.`,
    );
  }
  if (balance < transparentSpend) {
    throw new Error(`Initial Mainnet deposit needs ${transparentSpend} wei STRK but only ${balance} wei is available.`);
  }
  console.log(`Initial private deposit (swap input + both paymaster fee reserves): ${depositAmount} wei STRK.`);
  console.log(`User-signed public approval amount: ${transparentSpend} wei STRK.`);

  const depositBuilder = transfers.build({
    autoRegister: ownerPublicKey === 0n,
    autoSetup: true,
    autoDiscover: { notes: "refresh", channels: "refresh" },
    registry: discovered,
    registryConst: true,
  });
  depositBuilder.with(STRK).deposit({ amount: depositAmount });
  const depositFeeAmount = BigInt(depositQuote.fee_action.amount);
  if (depositFeeAmount > 0n) {
    depositBuilder.with(depositQuote.fee_action.token).withdraw({
      recipient: depositQuote.fee_action.recipient,
      amount: depositFeeAmount,
    });
  }

  await recycleLocalProver(IS_MAINNET ? "Mainnet private deposit + registration" : "private deposit");
  const depositInvocation = await depositBuilder.createProofInvocation();
  await preflightInvocation(provider, depositInvocation.invocation, "Private deposit");
  const depositStarted = Date.now();
  depositResult = await transfers.executeWithInvocation(depositInvocation);
  console.log(`Private-deposit proof wall time: ${Math.round((Date.now() - depositStarted) / 1000)}s`);
  requireMainnetScreeningAttestation(
    depositResult,
    IS_MAINNET ? "Mainnet private deposit + registration" : "Private deposit",
  );
  const depositSignature = stark.signatureToHexArray(
    await baseSigner.signMessage(depositQuote.typed_data, address),
  );
  depositTx = await submitPaymasterProof(
    provider,
    paymasterUrl,
    paymasterApiKey,
    paymasterFeeParameters,
    depositResult,
    IS_MAINNET ? "Mainnet private deposit + registration" : "Private deposit",
    {
      user_address: address,
      typed_data: depositQuote.typed_data,
      signature: depositSignature,
    },
  );

  // The proof result contains the note registry created by the SDK. Refresh the
  // proof nonce before constructing the next proof, since the first apply_actions
  // has now been accepted by the pool.
  transfers.invalidateProofNonceCache();
  discovered = depositResult.registry;
  notes = discovered.notes.get(BigInt(STRK)) ?? [];
  usable = notes.filter((note) => note.amount >= SWAP_AMOUNT)
    .sort((a, b) => Number(a.amount - b.amount));
  console.log(`Private deposit note: ${usable[0] ? hex(usable[0].id) : "none"} (${usable[0]?.amount ?? 0} wei).`);
  if (!usable[0]) throw new Error("Private deposit returned no usable STRK note.");
}

const ownerChannel = discovered.channels.get(BigInt(address));
const ownerChannelReady = Boolean(
  ownerChannel?.key
  && ownerChannel.tokens?.has(BigInt(STRK))
  && ownerChannel.tokens?.has(BigInt(ETH)),
);
console.log(`Owner STRK/ETH channel setup already available: ${ownerChannelReady}.`);

const gateBuilder = transfers.build({
  autoRegister: !ownerChannelReady,
  autoSetup: !ownerChannelReady,
  autoDiscover: { notes: "refresh", channels: "missing" },
  registry: discovered,
  registryConst: true,
});
const partialCommitment = await gateBuilder.shadowAccounts(DAPP_NAME).partialCommitment();
const shadowAccounts = await anonymizerContract.get_shadow_accounts(partialCommitment, NONCE, NONCE + 1n, false);
const shadowAccount = shadowAccounts[0];
if (!shadowAccount) throw new Error("Anonymizer returned no shadow account for the selected dapp/nonce.");
console.log(`Predicted shadow account: ${shadowAccount.address}`);
console.log(`Shadow account deployed before Gate C: ${shadowAccount.is_deployed}`);

gateBuilder
  .with(STRK)
  .inputs(usable[0])
  .withdraw({ recipient: shadowAccount.address, amount: SWAP_AMOUNT })
  // Keep any unused input-note balance private instead of leaving a compiler surplus.
  .surplusTo(address, false);
gateBuilder.with(ETH).transfer({ recipient: address, amount: Open });
gateBuilder.shadowAccounts(DAPP_NAME).invoke(NONCE, {
  calls: routerCalls,
  collectPolicy: { type: "all" },
});
if (usePaymaster) {
  const gateFeeAmount = BigInt(gateQuote.fee_action.amount);
  if (gateFeeAmount > 0n) {
    gateBuilder.with(gateQuote.fee_action.token).withdraw({
      recipient: gateQuote.fee_action.recipient,
      amount: gateFeeAmount,
    });
  }
}

console.log("Gate C call sequence: private STRK note -> shadow account -> Ekubo swap -> private STRK/ETH notes.");
console.log(`Calls: STRK.transfer(${ROUTER}) -> Router.swap -> Router.clear_minimum(ETH).`);
await recycleLocalProver("Gate C");
const invocation = await gateBuilder.createProofInvocation();
await preflightInvocation(provider, invocation.invocation, "Gate C");

const started = Date.now();
const result = await transfers.executeWithInvocation(invocation);
const proofSeconds = Math.round((Date.now() - started) / 1000);
console.log(`Proof wall time: ${proofSeconds}s`);

let transactionHash;
if (usePaymaster) {
  transactionHash = await submitPaymasterProof(
    provider,
    paymasterUrl,
    paymasterApiKey,
    paymasterFeeParameters,
    result,
    "Gate C",
  );
} else {
  throw new Error("Gate C proof submission requires a privacy paymaster; refusing direct RPC broadcast.");
}

console.log(`Gate C transaction: ${transactionHash}`);
if (depositTx) console.log(`Private deposit transaction: ${depositTx}`);
console.log(`Gate C proof wall time: ${proofSeconds}s`);
console.log(`Gate C input: ${SWAP_AMOUNT} wei STRK`);
console.log(`Gate C minimum output: ${minimumReceived} wei ETH`);
