import { createDecipheriv, scryptSync, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Account, RpcProvider, Signer, ec } from "starknet";
import { keccak_256 } from "@noble/hashes/sha3";

const RPC_URL = process.env.FACET_RPC_URL
  ?? "https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10";
const ACCOUNT_DIR = "/Users/user/.facet-secrets/starknet-gate-a-new";
const ACCOUNT_FILE = `${ACCOUNT_DIR}/account.json`;
const KEYSTORE_FILE = `${ACCOUNT_DIR}/keystore.json`;
const POOL = "0x073f3c4bc1ef39490f09587b11f6ea7f2cc66854d5df3306cda4736234693546";
const OLD_CLASS_HASH = "0x052107fadffab71bdcbb6b2ccb68ba3e1b5558d94036538053e159d3076ad633";
// Already declared on Sepolia by the official privacy deployment. Its ABI includes
// ComputeAndInvoke and it is compatible with the deployed RC.0 pool storage.
const NEW_CLASS_HASH = "0x56ab118a8a6e38efc93ad758cefe909fee421fa931ce3cf72df624d345623b2";

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
  const actualMac = Buffer.from(keccak_256(Buffer.concat([derived.subarray(16, 32), ciphertext])));
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

const [accountInfo, keystore] = await Promise.all([
  readFile(ACCOUNT_FILE, "utf8").then(JSON.parse),
  readFile(KEYSTORE_FILE, "utf8").then(JSON.parse),
]);

const provider = new RpcProvider({ nodeUrl: RPC_URL });
const currentClassHash = await provider.getClassHashAt(POOL);
if (BigInt(currentClassHash) === BigInt(NEW_CLASS_HASH)) {
  console.log(`Pool already upgraded: ${NEW_CLASS_HASH}`);
  process.exit(0);
}
if (BigInt(currentClassHash) !== BigInt(OLD_CLASS_HASH)) {
  throw new Error(`Refusing to upgrade unexpected pool class: ${currentClassHash}`);
}

const password = await promptHidden("Enter Gate A keystore password for the pool upgrade: ");
const privateKey = decryptKeystore(keystore, password);
const address = accountInfo.deployment.address;
if (BigInt(ec.starkCurve.getStarkKey(privateKey)) !== BigInt(accountInfo.variant.public_key)) {
  throw new Error("Keystore key does not match the account descriptor.");
}
const account = new Account({
  provider,
  address,
  signer: new Signer(privateKey),
  cairoVersion: "1",
});

// ImplementationData = { impl_hash, eic_data: None, final: false }.
const implementationData = [NEW_CLASS_HASH, 1, 0];
console.log("Granting upgrade authority and replacing the pool class in place...");
const upgrade = await account.execute([
  { contractAddress: POOL, entrypoint: "register_upgrade_governor", calldata: [address] },
  { contractAddress: POOL, entrypoint: "add_new_implementation", calldata: implementationData },
  { contractAddress: POOL, entrypoint: "replace_to", calldata: implementationData },
]);
const receipt = await provider.waitForTransaction(upgrade.transaction_hash);
if (!receipt.isSuccess()) throw new Error(`Pool upgrade reverted: ${upgrade.transaction_hash}`);
const upgradedClassHash = await provider.getClassHashAt(POOL);
if (BigInt(upgradedClassHash) !== BigInt(NEW_CLASS_HASH)) {
  throw new Error(`Pool class did not change: ${upgradedClassHash}`);
}
console.log(`Pool upgrade transaction: ${upgrade.transaction_hash}`);
console.log(`Pool now supports ComputeAndInvoke: ${upgradedClassHash}`);
