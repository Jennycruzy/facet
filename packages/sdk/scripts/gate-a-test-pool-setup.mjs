import { createDecipheriv, scryptSync, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Account, RpcProvider, Signer, ec } from "starknet";
import { keccak_256 } from "@noble/hashes/sha3";
const PRIVACY_SDK_ROOT = process.env.FACET_PRIVACY_SDK_ROOT
  ?? "/Users/user/starknet-privacy/sdk";
const { SCREENING_SIGNER_PUBLIC_KEY } = await import(
  pathToFileURL(`${PRIVACY_SDK_ROOT}/dist/testing/index.js`)
);

const RPC_URL = process.env.FACET_RPC_URL
  ?? "https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10";
const ACCOUNT_DIR = "/Users/user/.facet-secrets/starknet-gate-a-new";
const ACCOUNT_FILE = `${ACCOUNT_DIR}/account.json`;
const KEYSTORE_FILE = `${ACCOUNT_DIR}/keystore.json`;
const OUTPUT_FILE = `${ACCOUNT_DIR}/test-pool.json`;
const POOL_CLASS_HASH = "0x052107fadffab71bdcbb6b2ccb68ba3e1b5558d94036538053e159d3076ad633";
const ANONYMIZER_CLASS_HASH = "0x7ffaf4f427c8de0ca35d32d44d97a31da3c24641e32b72f340660d5b9e7f5e6";
const SHADOW_ACCOUNT_CLASS_HASH = "0x346e143e3b353473a0d6f681c31ffcf2866537898008027fb3b57335bad7b5f";
const PROOF_VALIDITY_BLOCKS = 450;

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

try {
  const existing = JSON.parse(await readFile(OUTPUT_FILE, "utf8"));
  if (existing.poolAddress && existing.anonymizerAddress) {
    console.log(`Existing test pool: ${existing.poolAddress}`);
    console.log(`Existing test anonymizer: ${existing.anonymizerAddress}`);
    console.log("Run: FACET_USE_TEST_POOL=1 node scripts/gate-a-sepolia.mjs");
    process.exit(0);
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const accountInfo = JSON.parse(await readFile(ACCOUNT_FILE, "utf8"));
const keystore = JSON.parse(await readFile(KEYSTORE_FILE, "utf8"));
const password = await promptHidden("Enter Gate A keystore password: ");
const privateKey = decryptKeystore(keystore, password);
const address = accountInfo.deployment.address;
if (BigInt(ec.starkCurve.getStarkKey(privateKey)) !== BigInt(accountInfo.variant.public_key)) {
  throw new Error("Keystore key does not match the account descriptor.");
}

const provider = new RpcProvider({ nodeUrl: RPC_URL });
const account = new Account({ provider, address, signer: new Signer(privateKey), cairoVersion: "1" });
const screenerPublicKey = `0x${SCREENING_SIGNER_PUBLIC_KEY.toString(16)}`;

console.log("Deploying isolated Sepolia privacy pool...");
const poolDeployment = await account.deploy([{
  classHash: POOL_CLASS_HASH,
  constructorCalldata: [address, screenerPublicKey, screenerPublicKey, PROOF_VALIDITY_BLOCKS],
}], { tip: 0n });
const poolReceipt = await provider.waitForTransaction(poolDeployment.transaction_hash);
if (!poolReceipt.isSuccess()) throw new Error(`Pool deployment reverted: ${poolDeployment.transaction_hash}`);
const poolAddress = poolDeployment.contract_address[0];
console.log(`Pool deployment: ${poolDeployment.transaction_hash}`);
console.log(`Test pool: ${poolAddress}`);

console.log("Deploying anonymizer bound to the test pool...");
const anonymizerDeployment = await account.deploy([{
  classHash: ANONYMIZER_CLASS_HASH,
  constructorCalldata: [poolAddress, SHADOW_ACCOUNT_CLASS_HASH, address],
}], { tip: 0n });
const anonymizerReceipt = await provider.waitForTransaction(anonymizerDeployment.transaction_hash);
if (!anonymizerReceipt.isSuccess()) {
  throw new Error(`Anonymizer deployment reverted: ${anonymizerDeployment.transaction_hash}`);
}
const anonymizerAddress = anonymizerDeployment.contract_address[0];
console.log(`Anonymizer deployment: ${anonymizerDeployment.transaction_hash}`);
console.log(`Test anonymizer: ${anonymizerAddress}`);

await writeFile(OUTPUT_FILE, `${JSON.stringify({
  poolAddress,
  anonymizerAddress,
  poolDeploymentTx: poolDeployment.transaction_hash,
  anonymizerDeploymentTx: anonymizerDeployment.transaction_hash,
  screenerPublicKey,
}, null, 2)}\n`, { mode: 0o600 });
console.log(`Saved: ${OUTPUT_FILE}`);
console.log("Next: FACET_USE_TEST_POOL=1 node scripts/gate-a-sepolia.mjs");
