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
} from "starknet";
import { keccak_256 } from "@noble/hashes/sha3";

// Gate C deliberately uses the generic shadow-account call path. No executor contract is
// required: the shadow account transfers STRK to Ekubo, swaps, clears the input remainder, and
// clears the ETH output. The private pool then settles both token balances into open notes.
const PRIVACY_SDK_ROOT = process.env.FACET_PRIVACY_SDK_ROOT
  ?? "/Users/user/starknet-privacy/sdk";
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
const PROVER_URL = process.env.FACET_PROVER_URL ?? "http://127.0.0.1:3017";
const PROVER_SSH_HOST = process.env.FACET_PROVER_SSH_HOST ?? "root@38.49.216.59";
const PROVER_SSH_KEY = process.env.FACET_PROVER_SSH_KEY ?? "/Users/user/.ssh/devfun_jennycruzy";

const SEPOLIA_GATE_DIR = "/Users/user/.facet-secrets/starknet-gate-a-new";
const MAINNET_GATE_DIR = "/Users/user/.facet-secrets/starknet-gate2";
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
const MAINNET_ROUTE_FEE = 34028236692093847977029636859101184n; // 0.01%
const SEPOLIA_ROUTE_FEE = 170141183460469231731687303715884105n; // 0.05%
const ROUTE_FEE = IS_MAINNET ? MAINNET_ROUTE_FEE : SEPOLIA_ROUTE_FEE;
const TICK_SPACING = IS_MAINNET ? 200n : 50n;
const SWAP_AMOUNT = BigInt(process.env.FACET_GATE_C_AMOUNT ?? "100000000000000000"); // 0.1 STRK
const DEPOSIT_AMOUNT = BigInt(
  process.env.FACET_GATE_C_DEPOSIT_AMOUNT ?? SWAP_AMOUNT.toString(),
);
const DAPP_NAME = process.env.FACET_DAPP_NAME ?? "facet-gate-c-ekubo-v1";
const NONCE = BigInt(process.env.FACET_GATE_C_NONCE ?? "0");
const SLIPPAGE_BPS = BigInt(process.env.FACET_GATE_C_SLIPPAGE_BPS ?? "1000");
const MAX_MAINNET_SPEND_STRK = BigInt(process.env.FACET_MAINNET_MAX_SPEND_STRK ?? "5");
const MAX_MAINNET_SPEND = MAX_MAINNET_SPEND_STRK * 1_000_000_000_000_000_000n;
const PROOF_VERSION_V0 = "0x50524f4f4630";
const PROOF_VERSION_V1 = "0x50524f4f4631";
const MAINNET_FEE_SAFETY_PERCENT = 20n;
let mainnetPriorFeesWei = 0n;
let mainnetPrincipalWei = SWAP_AMOUNT;
let mainnetGateEstimate;
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

function padResourceBounds(resourceBounds, percent = MAINNET_FEE_SAFETY_PERCENT) {
  const pad = (value) => {
    const amount = BigInt(value);
    return amount + amount * percent / 100n;
  };
  return {
    l1_gas: {
      max_amount: pad(resourceBounds.l1_gas.max_amount),
      max_price_per_unit: pad(resourceBounds.l1_gas.max_price_per_unit),
    },
    l1_data_gas: {
      max_amount: pad(resourceBounds.l1_data_gas.max_amount),
      max_price_per_unit: pad(resourceBounds.l1_data_gas.max_price_per_unit),
    },
    l2_gas: {
      max_amount: pad(resourceBounds.l2_gas.max_amount),
      max_price_per_unit: pad(resourceBounds.l2_gas.max_price_per_unit),
    },
  };
}

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

function callProverWithCurl(method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params });
  return new Promise((resolve, reject) => {
    const child = spawn("curl", [
      "--silent", "--show-error", "--max-time", "1800",
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
  console.log(`Recycling the prover to release proof memory before ${nextProof}...`);
  await runProcess("ssh", [
    "-i", PROVER_SSH_KEY, "-o", "IdentitiesOnly=yes", PROVER_SSH_HOST,
    "docker", "restart", "--timeout", "30", "facet-prover-gate-a",
  ], "Prover restart");
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    await delay(5_000);
    try {
      await callProverWithCurl("rpc.discover", {});
    } catch (error) {
      if (String(error).includes("Method not found")) {
        console.log("Prover restarted and ready.");
        return;
      }
    }
  }
  throw new Error("Prover did not become ready within two minutes after restart.");
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
  // The deployed mainnet privacy pool predates the Starknet proof-version
  // transition and accepts PROOF0. The V0/V1 proof-facts payload layout is
  // identical; only the marker changed. Normalize the marker before the
  // transaction is signed so the node and pool can parse the facts.
  if (IS_MAINNET && proofFacts.length > 0 && String(proofFacts[0]).toLowerCase() === PROOF_VERSION_V1) {
    proofFacts[0] = PROOF_VERSION_V0;
    console.log("Normalized mainnet proof facts from PROOF1 to the deployed pool's PROOF0 format.");
  }
  return {
    data: result.proof,
    output: poolMessage?.payload ?? [],
    proofFacts,
    additionalData: result.additional_data,
  };
}

function toPaymasterCall(call) {
  return {
    to: call.contractAddress,
    selector: hash.getSelectorFromName(call.entrypoint),
    calldata: (call.calldata ?? []).map((value) => num.toHex(value)),
  };
}

async function paymasterRpc(url, apiKey, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-paymaster-api-key": apiKey },
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

async function simulateDirectInvoke(account, callAndProof, label) {
  // Cartridge currently rejects proof-aware starknet_estimateFee requests by
  // dropping proof_facts before executing the pool call. The simulation RPC
  // preserves them and returns the resource bounds needed for the real V3
  // submission, so use it for fee estimation on mainnet.
  const simulation = await account.simulateTransaction([{
    type: TransactionType.INVOKE,
    payload: [callAndProof.call],
  }], {
    proofFacts: callAndProof.proof.proofFacts,
    tip: 1n,
    skipValidate: true,
  });
  const result = simulation.simulated_transactions?.[0];
  if (!result?.resourceBounds) throw new Error(`${label} returned no resource bounds.`);
  const overallFee = BigInt(result.overall_fee ?? result.overallFee ?? 0);
  console.log(
    `${label} fee estimate: ${overallFee} wei STRK ` +
    `(${Number(overallFee) / 1e18} STRK).`,
  );
  return {
    overallFee,
    budgetFee: overallFee * (100n + MAINNET_FEE_SAFETY_PERCENT) / 100n,
    resourceBounds: padResourceBounds(result.resourceBounds),
  };
}

async function buildSignedProofTransaction(account, callAndProof, details, label) {
  const signed = await account.getSignedTransaction(callAndProof.call, {
    ...details,
    proofFacts: callAndProof.proof.proofFacts,
    proof: callAndProof.proof.data,
  });
  const proofFacts = signed.proof_facts ?? signed.proofFacts;
  if (!Array.isArray(proofFacts) || proofFacts.length === 0) {
    throw new Error(`${label} signed transaction has no proof_facts; refusing to broadcast.`);
  }
  console.log(`${label} signed transaction contains ${proofFacts.length} proof facts.`);
  return signed;
}

async function preflightProofActions(account, callAndProof, details, label) {
  console.log(`Preflighting ${label} proof facts and apply_actions...`);
  const signed = await buildSignedProofTransaction(account, callAndProof, details, label);
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "starknet_simulateTransactions",
      // Starknet JSON-RPC v0.10 uses an object (not a one-element params
      // array) for this method, matching starknet.js's channel request.
      params: {
        block_id: "latest",
        transactions: [signed],
        simulation_flags: ["SKIP_VALIDATE", "SKIP_FEE_CHARGE"],
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json();
  if (body.error) {
    throw new Error(`${label} proof-aware preflight failed: ${JSON.stringify(body.error)}`);
  }
  const trace = body.result?.[0];
  const executeInvocation = trace?.transaction_trace?.execute_invocation
    ?? trace?.transactionTrace?.executeInvocation;
  const revertReason = executeInvocation?.revert_reason ?? executeInvocation?.revertReason;
  if (revertReason) throw new Error(`${label} proof-aware preflight reverted: ${revertReason}`);
  if (trace?.execution_status === "REVERTED" || trace?.executionStatus === "REVERTED") {
    throw new Error(`${label} proof-aware preflight reverted: ${JSON.stringify(trace)}`);
  }
  console.log(`${label} proof-aware preflight passed.`);
  return signed;
}

async function submitSignedProofTransaction(provider, signed, label) {
  const proofFacts = signed.proof_facts ?? signed.proofFacts;
  if (!Array.isArray(proofFacts) || proofFacts.length === 0) {
    throw new Error(`${label} signed transaction has no proof_facts; refusing to broadcast.`);
  }
  const sent = await provider.invokeSignedTx(signed);
  console.log(`${label} transaction submitted: ${sent.transaction_hash}`);
  return sent;
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
let usePaymaster = false;
if (!IS_MAINNET && process.env.FACET_USE_SELFHOST !== "0") {
  if (!existsSync(SELFHOST_CLIENT_FILE) || !existsSync(TEST_POOL_FILE)) {
    throw new Error(`Self-hosted Sepolia paymaster files are missing: ${SELFHOST_CLIENT_FILE}`);
  }
  const client = JSON.parse(await readFile(SELFHOST_CLIENT_FILE, "utf8"));
  const testPool = JSON.parse(await readFile(TEST_POOL_FILE, "utf8"));
  pool = client.poolAddress;
  anonymizer = testPool.anonymizerAddress;
  paymasterUrl = client.localUrl;
  paymasterApiKey = client.apiKey;
  usePaymaster = true;
}
if (process.env.FACET_POOL_ADDRESS) pool = process.env.FACET_POOL_ADDRESS;
if (process.env.FACET_ANONYMIZER_ADDRESS) anonymizer = process.env.FACET_ANONYMIZER_ADDRESS;

// Starknet.js defaults to +50% on both resource amounts and prices. That is
// useful for generic wallet sends but overstates this proof transaction enough
// to trip the user's configured mainnet authorization. Use raw simulation values and the
// smaller explicit margin applied by simulateDirectInvoke.
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

// Registration writes are emitted as deferred pool actions. The pool's compiler
// cannot read that write while compiling a later OpenChannel in the same virtual
// transaction, so a brand-new mainnet account must register first and only then
// open its self-channel/deposit. This is deliberately a separate proof and
// transaction; combining the two produces SENDER_NOT_REGISTERED before proving.
const ownerPublicKey = BigInt(first(await provider.callContract({
  contractAddress: pool,
  entrypoint: "get_public_key",
  calldata: [address],
})));
if (IS_MAINNET && ownerPublicKey === 0n) {
  console.log("Mainnet account is not registered in the privacy pool; registering it in a separate transaction first...");
  // Keep the read-only simulation from mutating the registry that will be used
  // to build the real registration proof. The simulator adds a synthetic
  // self-channel for SetViewingKey; reusing that object would make the second
  // compilation think the account was already registered.
  const registrationBuilder = transfers.build({
    registry: discovered,
    registryConst: true,
  }).register();
  const registrationSimulation = await registrationBuilder.simulate({
    node: provider,
    validateSignature: false,
  });
  const registrationEstimate = await simulateDirectInvoke(
    account,
    registrationSimulation.callAndProof,
    "Read-only mainnet registration",
  );
  if (mainnetPrincipalWei + mainnetPriorFeesWei + registrationEstimate.budgetFee >= MAX_MAINNET_SPEND) {
    throw new Error(
      `Registration fee estimate reaches the ${MAX_MAINNET_SPEND_STRK} STRK cap: ` +
      `${mainnetPrincipalWei + mainnetPriorFeesWei + registrationEstimate.budgetFee} wei.`,
    );
  }

  await recycleLocalProver("mainnet registration");
  const registrationInvocation = await registrationBuilder.createProofInvocation();
  await preflightInvocation(provider, registrationInvocation.invocation, "Mainnet registration");
  const registrationStarted = Date.now();
  const registrationResult = await transfers.executeWithInvocation(registrationInvocation);
  const registrationProofSeconds = Math.round((Date.now() - registrationStarted) / 1000);
  console.log(`Mainnet registration proof wall time: ${registrationProofSeconds}s`);
  const registrationDetails = {
    tip: 1n,
    resourceBounds: registrationEstimate.resourceBounds,
  };
  const registrationSigned = await preflightProofActions(
    account,
    registrationResult.callAndProof,
    registrationDetails,
    "Mainnet registration",
  );
  const registrationSent = await submitSignedProofTransaction(
    provider,
    registrationSigned,
    "Mainnet registration",
  );
  const registrationReceipt = await waitForSuccess(
    provider,
    registrationSent.transaction_hash,
    "Mainnet registration",
  );
  const registrationActualFee = "actual_fee" in registrationReceipt
    ? registrationReceipt.actual_fee
    : registrationReceipt.actualFee;
  const registrationFeeWei = registrationActualFee
    ? BigInt(registrationActualFee.amount ?? registrationActualFee)
    : registrationEstimate.overallFee;
  const registeredPublicKey = BigInt(first(await provider.callContract({
    contractAddress: pool,
    entrypoint: "get_public_key",
    calldata: [address],
  })));
  if (registeredPublicKey === 0n) {
    throw new Error("Mainnet registration receipt succeeded, but the privacy pool still has no public key for the account.");
  }
  mainnetPriorFeesWei += registrationFeeWei;
  transfers.invalidateProofNonceCache();
  console.log(`Mainnet registration transaction: ${registrationSent.transaction_hash}`);
  console.log(`Mainnet registration fee: ${registrationFeeWei} wei STRK`);
}

if (!usable[0]) {
  if (!IS_MAINNET) {
    throw new Error(
      `No private STRK note covers ${SWAP_AMOUNT} wei on ${NETWORK}. ` +
      "Gate C stopped before proving; a separate private deposit is required.",
    );
  }

  // Mainnet has no sponsored/private-deposit helper. If the selected mainnet
  // account has no input note, create the exact private input here, then reuse
  // the resulting registry for Gate C. This keeps the user's one-command flow
  // while ensuring the configured authorization is checked before Gate C submits.
  console.log(`No mainnet input note; creating a ${DEPOSIT_AMOUNT} wei private STRK deposit first...`);
  const depositBuilder = transfers.build({
    // Registration, when needed, was submitted above. Keep this transaction
    // focused on channel setup plus the deposit.
    autoRegister: false,
    autoSetup: true,
    autoDiscover: { notes: "refresh", channels: "refresh" },
    registry: discovered,
    registryConst: true,
  });
  depositBuilder.with(STRK).deposit({ amount: DEPOSIT_AMOUNT });
  const depositSimulation = await depositBuilder.simulate({ node: provider, validateSignature: false });
  const depositEstimate = await simulateDirectInvoke(
    account,
    depositSimulation.callAndProof,
    "Read-only mainnet private-deposit",
  );
  const depositFeeEstimate = depositEstimate.overallFee;
  if (DEPOSIT_AMOUNT + mainnetPriorFeesWei + depositEstimate.budgetFee >= MAX_MAINNET_SPEND) {
    throw new Error(
      `Private deposit estimate plus safety margin reaches the ${MAX_MAINNET_SPEND_STRK} STRK cap: ` +
      `${DEPOSIT_AMOUNT + mainnetPriorFeesWei + depositEstimate.budgetFee} wei.`,
    );
  }

  await recycleLocalProver("mainnet private deposit");
  const depositInvocation = await depositBuilder.createProofInvocation();
  await preflightInvocation(provider, depositInvocation.invocation, "Mainnet private deposit");
  const depositStarted = Date.now();
  const depositResult = await transfers.executeWithInvocation(depositInvocation);
  const depositProofSeconds = Math.round((Date.now() - depositStarted) / 1000);
  console.log(`Mainnet private-deposit proof wall time: ${depositProofSeconds}s`);
  const depositDetails = {
    tip: 1n,
    resourceBounds: depositEstimate.resourceBounds,
  };
  const depositFee = depositFeeEstimate;
  if (DEPOSIT_AMOUNT + mainnetPriorFeesWei + depositFee >= MAX_MAINNET_SPEND) {
    throw new Error(
      `Private deposit final fee reaches the ${MAX_MAINNET_SPEND_STRK} STRK cap: ` +
      `${DEPOSIT_AMOUNT + mainnetPriorFeesWei + depositFee} wei.`,
    );
  }
  const depositSigned = await preflightProofActions(
    account,
    depositResult.callAndProof,
    depositDetails,
    "Mainnet private deposit",
  );
  const depositSent = await submitSignedProofTransaction(
    provider,
    depositSigned,
    "Mainnet private deposit",
  );
  const depositReceipt = await waitForSuccess(provider, depositSent.transaction_hash, "Mainnet private deposit");
  const actualDepositFee = "actual_fee" in depositReceipt
    ? depositReceipt.actual_fee
    : depositReceipt.actualFee;
  const actualDepositFeeWei = actualDepositFee
    ? BigInt(actualDepositFee.amount ?? actualDepositFee)
    : depositFee;
  console.log(`Mainnet private deposit transaction: ${depositSent.transaction_hash}`);

  // The deposit proof result contains the note registry created by the SDK.
  // Invalidate the proof nonce cache before constructing the second proof.
  transfers.invalidateProofNonceCache();
  discovered = depositResult.registry;
  notes = discovered.notes.get(BigInt(STRK)) ?? [];
  usable = notes.filter((note) => note.amount >= SWAP_AMOUNT)
    .sort((a, b) => Number(a.amount - b.amount));
  console.log(`Private deposit note: ${usable[0] ? hex(usable[0].id) : "none"} (${usable[0]?.amount ?? 0} wei).`);
  if (!usable[0]) throw new Error("Mainnet private deposit returned no usable STRK note.");

  // The deposit amount is the source of the later swap input, so it must not
  // be counted twice in the authorization check.
  mainnetPriorFeesWei += actualDepositFeeWei;
  mainnetPrincipalWei = DEPOSIT_AMOUNT;
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

console.log("Gate C call sequence: private STRK note -> shadow account -> Ekubo swap -> private STRK/ETH notes.");
console.log(`Calls: STRK.transfer(${ROUTER}) -> Router.swap -> Router.clear_minimum(ETH).`);
await recycleLocalProver("Gate C");
const invocation = await gateBuilder.createProofInvocation();
await preflightInvocation(provider, invocation.invocation, "Gate C");

// On mainnet, estimate the real apply_actions transaction with mock proof facts before spending
// minutes proving. Sepolia uses the already configured proof-aware paymaster path instead.
if (IS_MAINNET) {
  const simulated = await gateBuilder.simulate({ node: provider, validateSignature: false });
  mainnetGateEstimate = await simulateDirectInvoke(
    account,
    simulated.callAndProof,
    "Read-only mainnet apply_actions",
  );
  if (mainnetPrincipalWei + mainnetPriorFeesWei + mainnetGateEstimate.budgetFee >= MAX_MAINNET_SPEND) {
    throw new Error(
      `Fee estimates plus the private input reach the ${MAX_MAINNET_SPEND_STRK} STRK cap: ` +
      `${mainnetPrincipalWei + mainnetPriorFeesWei + mainnetGateEstimate.budgetFee} wei.`,
    );
  }
}

const started = Date.now();
const result = await transfers.executeWithInvocation(invocation);
const proofSeconds = Math.round((Date.now() - started) / 1000);
console.log(`Proof wall time: ${proofSeconds}s`);

let transactionHash;
let feeWei = null;
if (usePaymaster) {
  const paymasterParameters = {
    version: "0x1",
    fee_mode: { mode: "sponsored_private", pool_fee_token: STRK, tip: "normal" },
  };
  const applyAction = {
    apply_actions_call: toPaymasterCall(result.callAndProof.call),
    proof: result.callAndProof.proof.data,
    proof_facts: result.callAndProof.proof.proofFacts,
  };
  const submission = await paymasterRpc(paymasterUrl, paymasterApiKey, "paymaster_executeTransaction", {
    transaction: { type: "apply_action", apply_action: applyAction },
    parameters: paymasterParameters,
  });
  transactionHash = submission.transaction_hash;
  await waitForSuccess(provider, transactionHash, "Gate C");
} else {
  const details = {
    tip: 1n,
    resourceBounds: mainnetGateEstimate.resourceBounds,
  };
  feeWei = mainnetGateEstimate.overallFee;
  if (mainnetPrincipalWei + mainnetPriorFeesWei + mainnetGateEstimate.budgetFee >= MAX_MAINNET_SPEND) {
    throw new Error(
      `Final fee estimate plus the private input reaches the ${MAX_MAINNET_SPEND_STRK} STRK cap: ` +
      `${mainnetPrincipalWei + mainnetPriorFeesWei + mainnetGateEstimate.budgetFee} wei.`,
    );
  }
  const signed = await preflightProofActions(account, result.callAndProof, details, "Gate C");
  const sent = await submitSignedProofTransaction(provider, signed, "Gate C");
  transactionHash = sent.transaction_hash;
  const receipt = await waitForSuccess(provider, transactionHash, "Gate C");
  const actualFee = "actual_fee" in receipt ? receipt.actual_fee : receipt.actualFee;
  feeWei = actualFee ? BigInt(actualFee.amount ?? actualFee) : feeWei;
}

console.log(`Gate C transaction: ${transactionHash}`);
console.log(`Gate C proof wall time: ${proofSeconds}s`);
console.log(`Gate C input: ${SWAP_AMOUNT} wei STRK`);
console.log(`Gate C minimum output: ${minimumReceived} wei ETH`);
if (feeWei !== null) console.log(`Gate C fee: ${feeWei} wei STRK`);
