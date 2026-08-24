import { createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { keccak_256 } from "@noble/hashes/sha3";
import { ec } from "starknet";

const RPC_URL = process.env.FACET_RPC_URL
  ?? "https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_10";
const SECRET_DIR = "/Users/user/.facet-secrets/starknet-gate-a-new";
const ACCOUNT_FILE = `${SECRET_DIR}/account.json`;
const KEYSTORE_FILE = `${SECRET_DIR}/keystore.json`;
const TEST_POOL_FILE = `${SECRET_DIR}/test-pool.json`;
const PROFILE_FILE = `${SECRET_DIR}/selfhost-paymaster.json`;
const CLIENT_FILE = `${SECRET_DIR}/selfhost-paymaster-client.json`;
const PAYMASTER_CLI = process.env.FACET_PAYMASTER_CLI
  ?? "/Users/user/.facet-tools/avnu-paymaster/target/release/paymaster-cli";
const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

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

async function run(command, args, stdinValue) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "inherit", "inherit"] });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${signal ?? code}`));
    });
    child.stdin.end(stdinValue);
  });
}

await mkdir(SECRET_DIR, { recursive: true, mode: 0o700 });
try {
  const existing = JSON.parse(await readFile(CLIENT_FILE, "utf8"));
  if (existing.apiKey && existing.poolAddress) {
    console.log(`Existing self-hosted paymaster profile: ${PROFILE_FILE}`);
    console.log(`Configured pool: ${existing.poolAddress}`);
    console.log("No deployment was repeated.");
    process.exit(0);
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const [accountInfo, keystore, testPool] = await Promise.all([
  readFile(ACCOUNT_FILE, "utf8").then(JSON.parse),
  readFile(KEYSTORE_FILE, "utf8").then(JSON.parse),
  readFile(TEST_POOL_FILE, "utf8").then(JSON.parse),
]);
const password = await promptHidden("Enter Gate A keystore password for paymaster setup: ");
const privateKey = decryptKeystore(keystore, password);
const address = accountInfo.deployment.address;
if (BigInt(ec.starkCurve.getStarkKey(privateKey)) !== BigInt(accountInfo.variant.public_key)) {
  throw new Error("Keystore key does not match the Gate A account descriptor.");
}

console.log("Deploying one isolated relayer, gas tank, estimate account, and forwarder...");
console.log("Funding allocation: 2 STRK gas tank + 1 STRK estimate account + 1 STRK reserve.");
await run(PAYMASTER_CLI, [
  "setup",
  "--rpc-url", RPC_URL,
  "--rpc-timeout", "10",
  "--chain-id", "sepolia",
  "--master-address", address,
  "--master-pk-stdin",
  "--num-relayers", "1",
  "--fund", "2",
  "--estimate-account-fund", "1",
  "--profile", PROFILE_FILE,
  "--max-check-status-attempts", "60",
  "--min-relayer-balance", "0.25",
  "--rebalancing-trigger-balance", "0.5",
  "--force",
], `${privateKey}\n`);

const profile = JSON.parse(await readFile(PROFILE_FILE, "utf8"));
const apiKey = `paymaster_${randomBytes(32).toString("hex")}`;
profile.privacy = {
  pool: testPool.poolAddress,
  pool_fee_amount: "0",
  gas_overhead: 5_000_000,
};
profile.supported_tokens = [...new Set([...(profile.supported_tokens ?? []), STRK])];
profile.sponsoring = { mode: "self", api_key: apiKey, sponsor_metadata: [] };
await writeFile(PROFILE_FILE, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
await chmod(PROFILE_FILE, 0o600);
await writeFile(CLIENT_FILE, `${JSON.stringify({
  apiKey,
  poolAddress: testPool.poolAddress,
  localUrl: "http://127.0.0.1:3018",
}, null, 2)}\n`, { mode: 0o600 });
await chmod(CLIENT_FILE, 0o600);

console.log(`Paymaster profile saved: ${PROFILE_FILE}`);
console.log(`Client settings saved: ${CLIENT_FILE}`);
console.log("The Gate account private key was not written to either file.");
