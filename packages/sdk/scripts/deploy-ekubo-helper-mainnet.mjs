import { readFile } from "node:fs/promises";
import { createDecipheriv, scryptSync, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import {
  Account,
  CallData,
  RpcProvider,
  Signer,
  constants,
  ec,
  hash,
} from "starknet";
import { keccak_256 } from "@noble/hashes/sha3";

// This is the official stateless Ekubo privacy helper from
// starkware-libs/starknet-privacy. The class is already declared on Mainnet;
// this script only deploys one instance and never declares or upgrades code.
const HELPER_CLASS_HASH =
  "0x2a4ac595283d4d64b9952f5ef5c0da1775bfdb7c9d92237524a21dd8d19ebd7";
const HELPER_SALT = "0x46414345545f454b55424f5f7631";
const RPC_URL = process.env.FACET_MAINNET_RPC_URL ?? "https://rpc.starknet.lava.build";
const ACCOUNT_DIR = process.env.FACET_MAINNET_ACCOUNT_DIR
  ?? "/Users/user/.facet-secrets/starknet-gate2";
const ACCOUNT_FILE = resolve(ACCOUNT_DIR, "account.json");
const KEYSTORE_FILE = resolve(ACCOUNT_DIR, "keystore.json");

function promptHidden(prompt) {
  if (!process.stdin.isTTY) throw new Error("Run this script directly in a terminal.");
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolvePrompt, reject) => {
    let value = "";
    const restore = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (character) => {
      if (character === "\u0003") {
        process.stdin.off("data", onData);
        restore();
        reject(new Error("Cancelled"));
      } else if (character === "\r" || character === "\n") {
        process.stdin.off("data", onData);
        restore();
        resolvePrompt(value);
      } else if (character === "\u007f" || character === "\b") {
        value = value.slice(0, -1);
      } else {
        value += character;
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
  const actualMac = Buffer.from(
    keccak_256(Buffer.concat([derived.subarray(16, 32), ciphertext])),
  );
  if (!timingSafeEqual(Buffer.from(crypto.mac, "hex"), actualMac)) {
    throw new Error("Incorrect keystore password.");
  }
  const decipher = createDecipheriv(
    "aes-128-ctr",
    derived.subarray(0, 16),
    Buffer.from(crypto.cipherparams.iv, "hex"),
  );
  return `0x${Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("hex")}`;
}

function predictedAddress(owner) {
  const deploySalt = ec.starkCurve.pedersen(owner, HELPER_SALT);
  return hash.calculateContractAddressFromHash(
    deploySalt,
    HELPER_CLASS_HASH,
    CallData.compile([]),
    constants.UDC.ADDRESS,
  );
}

const accountInfo = JSON.parse(await readFile(ACCOUNT_FILE, "utf8"));
const owner = accountInfo.deployment.address;
const address = predictedAddress(owner);
const provider = new RpcProvider({ nodeUrl: RPC_URL });

if (await provider.getChainId() !== constants.StarknetChainId.SN_MAIN) {
  throw new Error("The configured RPC is not Starknet Mainnet.");
}
try {
  await provider.getClassByHash(HELPER_CLASS_HASH);
} catch {
  throw new Error(`Helper class is not declared on Mainnet: ${HELPER_CLASS_HASH}`);
}

let deployedClassHash = null;
try {
  deployedClassHash = await provider.getClassHashAt(address);
} catch {
  // The predicted address is unused and ready for the deployment below.
}

console.log(`Mainnet owner: ${owner}`);
console.log(`Ekubo helper class: ${HELPER_CLASS_HASH}`);
console.log(`Predicted helper address: ${address}`);

if (deployedClassHash !== null) {
  if (BigInt(deployedClassHash) !== BigInt(HELPER_CLASS_HASH)) {
    throw new Error(`Predicted helper address is occupied by class ${deployedClassHash}.`);
  }
  console.log("Ekubo helper already deployed; no transaction needed.");
  process.exit(0);
}

if (process.argv.includes("--check")) {
  console.log("Check complete: class declared, address unused, no transaction submitted.");
  process.exit(0);
}

const keystore = JSON.parse(await readFile(KEYSTORE_FILE, "utf8"));
const password = await promptHidden("Enter mainnet deployment keystore password: ");
const privateKey = decryptKeystore(keystore, password);
if (BigInt(ec.starkCurve.getStarkKey(privateKey)) !== BigInt(accountInfo.variant.public_key)) {
  throw new Error("Keystore key does not match the mainnet account descriptor.");
}

const account = new Account({
  provider,
  address: owner,
  signer: new Signer(privateKey),
  cairoVersion: "1",
});
console.log("Submitting the stateless helper deployment through the Mainnet UDC…");
const deployment = await account.deploy({
  classHash: HELPER_CLASS_HASH,
  constructorCalldata: [],
  salt: HELPER_SALT,
  unique: true,
});
if (BigInt(deployment.contract_address[0]) !== BigInt(address)) {
  throw new Error(`UDC returned ${deployment.contract_address[0]}, expected ${address}.`);
}
console.log(`Deployment transaction: ${deployment.transaction_hash}`);
const receipt = await provider.waitForTransaction(deployment.transaction_hash);
if (!receipt.isSuccess()) throw new Error("Ekubo helper deployment reverted.");
const deployedHash = await provider.getClassHashAt(address);
if (BigInt(deployedHash) !== BigInt(HELPER_CLASS_HASH)) {
  throw new Error(`Deployment class verification failed: ${deployedHash}`);
}
console.log(JSON.stringify({
  network: "SN_MAIN",
  address,
  classHash: HELPER_CLASS_HASH,
  deploymentTransaction: deployment.transaction_hash,
}, null, 2));
