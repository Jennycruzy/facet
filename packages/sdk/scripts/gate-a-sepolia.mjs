import { createDecipheriv, scryptSync, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
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
const PRIVACY_SDK_ROOT = process.env.FACET_PRIVACY_SDK_ROOT
  ?? "/Users/user/starknet-privacy/sdk";
const {
  ContractDiscoveryProvider,
  SCREENING_SIGNER_PRIVATE_KEY,
  signScreeningAttestation,
} = await import(pathToFileURL(`${PRIVACY_SDK_ROOT}/dist/testing/index.js`));
const {
  createPrivateTransfers,
  Open,
  ProvingServiceProofProvider,
  ShadowAccountAnonymizerABI,
} = await import(pathToFileURL(`${PRIVACY_SDK_ROOT}/dist/index.js`));

const RPC_URL = process.env.FACET_RPC_URL ??
  "https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10";
const PROVER_URL = process.env.FACET_PROVER_URL ?? "http://127.0.0.1:3017";
const PAYMASTER_URL = process.env.FACET_PAYMASTER_URL ?? "https://sepolia.paymaster.avnu.fi";
const PAYMASTER_API_KEY = process.env.FACET_PAYMASTER_API_KEY;
const PROVER_SSH_HOST = process.env.FACET_PROVER_SSH_HOST ?? "root@38.49.216.59";
const PROVER_SSH_KEY = process.env.FACET_PROVER_SSH_KEY
  ?? "/Users/user/.ssh/devfun_jennycruzy";
let POOL = process.env.FACET_POOL_ADDRESS
  ?? "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ANONYMIZER_CLASS_HASH = "0x7ffaf4f427c8de0ca35d32d44d97a31da3c24641e32b72f340660d5b9e7f5e6";
const SHADOW_ACCOUNT_CLASS_HASH = "0x346e143e3b353473a0d6f681c31ffcf2866537898008027fb3b57335bad7b5f";
// Reuse the deployment that succeeded before the prover rejected the unregistered sender.
const EXISTING_ANONYMIZER = "0x21c875a218b083af2bc7e48b8ee753cce3d77380053a659ebbe931ca056879b";
const ACCOUNT_DIR = "/Users/user/.facet-secrets/starknet-gate-a-new";
const ACCOUNT_FILE = `${ACCOUNT_DIR}/account.json`;
const KEYSTORE_FILE = `${ACCOUNT_DIR}/keystore.json`;
const TEST_POOL_FILE = `${ACCOUNT_DIR}/test-pool.json`;
const DAPP_NAME = "facet";
const NONCE = 0n;
const AMOUNT = 500_000_000_000_000_000n; // 0.5 STRK

if (!PAYMASTER_API_KEY) {
  throw new Error(
    "Set FACET_PAYMASTER_API_KEY locally. Gate A requires AVNU's proof-aware Sepolia paymaster.",
  );
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

async function paymasterRpc(method, params) {
  const response = await fetch(PAYMASTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-paymaster-api-key": PAYMASTER_API_KEY,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json();
  if (body.error) {
    const detail = body.error.data === undefined ? "" : `: ${JSON.stringify(body.error.data)}`;
    throw new Error(`${method}: ${body.error.message} (${body.error.code})${detail}`);
  }
  if (body.result === undefined) throw new Error(`${method}: malformed response`);
  return body.result;
}

const paymasterParameters = {
  version: "0x1",
  fee_mode: { mode: "sponsored_private", pool_fee_token: STRK, tip: "normal" },
};

function toPaymasterCall(call) {
  return {
    to: call.contractAddress,
    selector: hash.getSelectorFromName(call.entrypoint),
    calldata: (call.calldata ?? []).map((value) => num.toHex(value)),
  };
}

async function buildPaymasterTransaction(transaction) {
  return paymasterRpc("paymaster_buildTransaction", {
    transaction,
    parameters: paymasterParameters,
  });
}

async function submitPaymasterProof(provider, result, label, invoke) {
  const applyAction = {
    apply_actions_call: toPaymasterCall(result.callAndProof.call),
    proof: result.callAndProof.proof.data,
    proof_facts: result.callAndProof.proof.proofFacts,
  };
  const transaction = invoke
    ? { type: "invoke_and_apply_action", apply_action: applyAction, invoke }
    : { type: "apply_action", apply_action: applyAction };
  console.log(`Submitting ${label} through AVNU with proof facts...`);
  const submission = await paymasterRpc("paymaster_executeTransaction", {
    transaction,
    parameters: paymasterParameters,
  });
  if (!submission.transaction_hash) throw new Error(`${label}: paymaster returned no transaction hash.`);
  const receipt = await provider.waitForTransaction(submission.transaction_hash);
  if (!receipt.isSuccess()) throw new Error(`${label} reverted.`);
  console.log(`${label} transaction: ${submission.transaction_hash}`);
  return submission.transaction_hash;
}

function deriveViewingKey(privateKey, address) {
  const messageHash = hash.starknetKeccak(`${constants.StarknetChainId.SN_SEPOLIA}:${POOL}`);
  const signature = ec.starkCurve.sign(`0x${messageHash.toString(16)}`, privateKey);
  const order = ec.starkCurve.CURVE.n;
  const halfOrder = order >> 1n;
  let key = BigInt(hash.computePoseidonHashOnElements([signature.r, signature.s])) % order;
  if (key >= halfOrder) key = order - key;
  return key === 0n ? 1n : key;
}

function makePoolViews(provider) {
  const view = (entrypoint, calldata = []) => provider.callContract({
    contractAddress: POOL,
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
    // RpcProvider returns felts as hex strings. Normalize zero so autoRegister does not
    // mistake the unregistered sentinel "0x0" for a real public key.
    get_public_key: async (address) => BigInt(first(await view("get_public_key", [address]))),
  };
}

async function preflightInvocation(provider, invocation, label) {
  console.log(`Preflighting ${label} signature and actions on Sepolia...`);
  await provider.channel.simulateTransaction(
    [{
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
    }],
    { blockIdentifier: "latest", skipValidate: true, skipFeeCharge: true },
  );
  console.log(`${label} preflight passed.`);
}

function callProverWithCurl(method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params });
  return new Promise((resolve, reject) => {
    // Node 20's built-in fetch has a five-minute headers timeout that is shorter than a proof.
    // curl keeps this single HTTP request open for up to 30 minutes without spawning retries.
    const child = spawn("curl", [
      "--silent",
      "--show-error",
      "--max-time",
      "1800",
      "--header",
      "Content-Type: application/json",
      "--data-binary",
      "@-",
      PROVER_URL,
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
    "-i", PROVER_SSH_KEY,
    "-o", "IdentitiesOnly=yes",
    PROVER_SSH_HOST,
    "docker", "restart", "--timeout", "30", "facet-prover-gate-a",
  ], "Prover restart");
  // Precomputes take about 20 seconds to reload. Probe through the existing tunnel.
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    await delay(5_000);
    try {
      await callProverWithCurl("rpc.discover", {});
    } catch (error) {
      // A JSON-RPC Method not found response proves the HTTP server is ready.
      if (String(error).includes("Method not found")) {
        console.log("Prover restarted and ready.");
        return;
      }
    }
  }
  throw new Error("Prover did not become ready within two minutes after restart.");
}

async function proveWithCurl(invocation, blockIdentifier = "latest") {
  const blockId = typeof blockIdentifier === "number" || typeof blockIdentifier === "bigint"
    ? { block_number: Number(blockIdentifier) }
    : blockIdentifier;
  const result = await callProverWithCurl("starknet_proveTransaction", {
    block_id: blockId,
    transaction: invocation,
  });
  const poolMessage = result.l2_to_l1_messages?.find(
    (message) => message.from_address?.toLowerCase() === String(invocation.sender_address).toLowerCase(),
  );
  const additionalData = attachTestScreening
    ? {
        signature: signScreeningAttestation(
          SCREENING_SIGNER_PRIVATE_KEY,
          BigInt(constants.StarknetChainId.SN_SEPOLIA),
          BigInt(address),
          Math.floor(Date.now() / 1000),
        ),
      }
    : result.additional_data;
  return {
    data: result.proof,
    output: poolMessage?.payload ?? [],
    proofFacts: result.proof_facts ?? [],
    additionalData,
  };
}

const accountInfo = JSON.parse(await readFile(ACCOUNT_FILE, "utf8"));
const keystore = JSON.parse(await readFile(KEYSTORE_FILE, "utf8"));
const password = await promptHidden("Enter new Gate A keystore password: ");
const privateKey = decryptKeystore(keystore, password);
const address = accountInfo.deployment.address;
let testPool;
if (process.env.FACET_USE_TEST_POOL === "1") {
  testPool = JSON.parse(await readFile(TEST_POOL_FILE, "utf8"));
  POOL = testPool.poolAddress;
}
const expectedPublicKey = BigInt(accountInfo.variant.public_key);
if (address.toLowerCase() !== "0x7a00bfa75ea68c2baa0d6ef2a10f42905d17f9868bfe2d4424072d06139b135") {
  throw new Error(`Unexpected Gate A account in descriptor: ${address}`);
}
if (BigInt(ec.starkCurve.getStarkKey(privateKey)) !== expectedPublicKey) {
  throw new Error("Keystore key does not match the account descriptor.");
}

const provider = new RpcProvider({ nodeUrl: RPC_URL });
const baseSigner = new Signer(privateKey);
// Sepolia currently exposes proof_facts on the RPC transaction without including
// them in the account's canonical V3 signature hash. starknet.js 10.5 includes
// proofFacts in that hash by default, producing "Account: invalid signature".
// Keep proofFacts on the wire while signing the standard V3 transaction hash.
const accountSigner = {
  getPubKey: (...args) => baseSigner.getPubKey(...args),
  signMessage: (...args) => baseSigner.signMessage(...args),
  signTransaction: (transactions, details) => {
    const { proofFacts: _proofFacts, ...standardDetails } = details;
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
console.log(`Account: ${address}`);
console.log(`Starting STRK balance: ${balance} wei`);
console.log(`Prover: ${PROVER_URL}`);

let anonymizer = process.env.FACET_ANONYMIZER_ADDRESS ?? testPool?.anonymizerAddress;
if (!anonymizer && process.env.FACET_DEPLOY_ANONYMIZER !== "1") {
  anonymizer = EXISTING_ANONYMIZER;
}
if (!anonymizer) {
  console.log("Deploying a Sepolia anonymizer authorized for the privacy pool...");
  const deployment = await account.deploy([{
    classHash: ANONYMIZER_CLASS_HASH,
    // Upstream constructor: privacy_contract, shadow_account_class_hash, governance_admin.
    constructorCalldata: [POOL, SHADOW_ACCOUNT_CLASS_HASH, address],
  }], { tip: 0n });
  const receipt = await provider.waitForTransaction(deployment.transaction_hash);
  if (!receipt.isSuccess()) throw new Error("Anonymizer deployment reverted.");
  anonymizer = deployment.contract_address[0];
  console.log(`Anonymizer deployment: ${deployment.transaction_hash}`);
  console.log(`Anonymizer address: ${anonymizer}`);
} else {
  console.log(`Using anonymizer: ${anonymizer}`);
}

const discovery = new ContractDiscoveryProvider(makePoolViews(provider));
const provingDetails = new ProvingServiceProofProvider(
  PROVER_URL,
  constants.StarknetChainId.SN_SEPOLIA,
  {
    nodeUrl: RPC_URL,
    poolAddress: POOL,
    // This host takes about eight minutes per proof. Keep one request alive instead of
    // timing out every 30 seconds and queuing duplicate proofs through automatic retries.
    requestTimeoutMs: 20 * 60 * 1000,
    retry: { maxRetries: 0 },
  },
);
const proving = {
  getDefaultDetails: () => provingDetails.getDefaultDetails(),
  invalidateNonceCache: () => provingDetails.invalidateNonceCache(),
  prove: proveWithCurl,
};
let attachTestScreening = false;
const viewingKey = deriveViewingKey(privateKey, address);
const transfers = createPrivateTransfers({
  account,
  viewingKeyProvider: { getViewingKey: async () => viewingKey },
  provingProvider: proving,
  discoveryProvider: discovery,
  poolContractAddress: POOL,
  shadowAccountAnonymizerAddress: anonymizer,
});

const poolFee = BigInt(first(await provider.callContract({
  contractAddress: POOL,
  entrypoint: "get_fee_amount",
  calldata: [],
})));
console.log(`Pool fee: ${poolFee} wei`);
const gateQuote = await buildPaymasterTransaction({
  type: "apply_action",
  apply_action: { pool_address: POOL },
});
if (!gateQuote.fee_action) throw new Error("AVNU returned an incomplete Gate A quote.");
if (BigInt(gateQuote.fee_action.token) !== BigInt(STRK)) {
  throw new Error(`Gate A fee token is not STRK: ${gateQuote.fee_action.token}`);
}

async function quoteDeposit(approvalAmount) {
  const value = {
    low: approvalAmount & ((1n << 128n) - 1n),
    high: approvalAmount >> 128n,
  };
  return buildPaymasterTransaction({
    type: "invoke_and_apply_action",
    apply_action: { pool_address: POOL },
    invoke: {
      user_address: address,
      calls: [{
        to: STRK,
        selector: hash.getSelectorFromName("approve"),
        calldata: [POOL, num.toHex(value.low), num.toHex(value.high)],
      }],
    },
  });
}

let depositAmount = AMOUNT + BigInt(gateQuote.fee_action.amount);
let depositQuote;
for (let attempt = 0; attempt < 3; attempt += 1) {
  depositQuote = await quoteDeposit(depositAmount + poolFee);
  if (!depositQuote.fee_action || !depositQuote.typed_data) {
    throw new Error("AVNU returned an incomplete deposit quote.");
  }
  if (BigInt(depositQuote.fee_action.token) !== BigInt(STRK)) {
    throw new Error(`Deposit fee token is not STRK: ${depositQuote.fee_action.token}`);
  }
  const quotedAmount = AMOUNT
    + BigInt(gateQuote.fee_action.amount)
    + BigInt(depositQuote.fee_action.amount);
  if (quotedAmount === depositAmount) break;
  depositAmount = quotedAmount;
  depositQuote = undefined;
}
if (!depositQuote) throw new Error("AVNU deposit fee quote did not stabilize.");
console.log(`Deposit amount including both private paymaster fees: ${depositAmount} wei`);

console.log("Building and proving the funded Gate A note (autoRegister + autoSetup)...");
await recycleLocalProver("Deposit");
const depositBuilder = transfers.build({
  autoRegister: true,
  autoSetup: true,
  autoDiscover: { notes: "refresh", channels: "refresh" },
});
depositBuilder.with(STRK).deposit({ amount: depositAmount });
depositBuilder.with(depositQuote.fee_action.token).withdraw({
  recipient: depositQuote.fee_action.recipient,
  amount: BigInt(depositQuote.fee_action.amount),
});
const depositInvocation = await depositBuilder.createProofInvocation();
await preflightInvocation(provider, depositInvocation.invocation, "Deposit");
attachTestScreening = process.env.FACET_USE_TEST_POOL === "1";
const depositResult = await transfers.executeWithInvocation(depositInvocation);
attachTestScreening = false;
const depositSignature = stark.signatureToHexArray(
  await baseSigner.signMessage(depositQuote.typed_data, address),
);
const depositTx = await submitPaymasterProof(provider, depositResult, "Deposit", {
  user_address: address,
  typed_data: depositQuote.typed_data,
  signature: depositSignature,
});
transfers.invalidateProofNonceCache();
await recycleLocalProver("Gate A");
const depositedNotes = depositResult.registry.notes.get(BigInt(STRK)) ?? [];
const depositedNote = depositedNotes.at(-1);
if (!depositedNote) throw new Error("Deposit proof returned no note in its registry.");
console.log(`Note id: ${hex(depositedNote.id)}`);
console.log(`Note amount: ${depositedNote.amount}`);

const gateBuilder = transfers.build({
  autoRegister: true,
  autoSetup: true,
  autoSelectNotes: "naive",
  autoDiscover: { notes: "refresh", channels: "refresh" },
  registry: depositResult.registry,
});
const anonymizerContract = new Contract({
  abi: ShadowAccountAnonymizerABI,
  address: anonymizer,
  providerOrAccount: provider,
}).typedv2(ShadowAccountAnonymizerABI);
const partialCommitment = await gateBuilder.shadowAccounts(DAPP_NAME).partialCommitment();
const shadowAccounts = await anonymizerContract.get_shadow_accounts(partialCommitment, 0, 1, false);
const shadowAccount = shadowAccounts[0];
if (!shadowAccount) throw new Error("Anonymizer returned no nonce-0 shadow account.");
console.log(`Predicted shadow account: ${shadowAccount.address}`);
console.log(`Shadow account deployed before Gate A: ${shadowAccount.is_deployed}`);

gateBuilder
  .with(STRK)
  .withdraw({ recipient: shadowAccount.address, amount: AMOUNT })
  .transfer({ recipient: address, amount: Open });
gateBuilder.shadowAccounts(DAPP_NAME).invoke(NONCE, {
  calls: [{ contractAddress: STRK, entrypoint: "balance_of", calldata: [address] }],
  collectPolicy: { type: "all" },
});

console.log("Building and proving Gate A: UseNote -> Withdraw -> ComputeAndInvoke...");
gateBuilder.with(gateQuote.fee_action.token).withdraw({
  recipient: gateQuote.fee_action.recipient,
  amount: BigInt(gateQuote.fee_action.amount),
});
const gateInvocation = await gateBuilder.createProofInvocation();
await preflightInvocation(provider, gateInvocation.invocation, "Gate A");
const started = Date.now();
const gateResult = await transfers.executeWithInvocation(gateInvocation);
console.log(`Proof wall time: ${Math.round((Date.now() - started) / 1000)}s`);
const gateTx = await submitPaymasterProof(provider, gateResult, "Gate A");
console.log(`Gate A transaction: ${gateTx}`);
console.log(`Deposit transaction: ${depositTx}`);
