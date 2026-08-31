import { createDecipheriv, scryptSync, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { keccak_256 } from "@noble/hashes/sha3";
import { Account, RpcProvider, Signer } from "starknet";
import { homedir } from "node:os";

const secretDir = `${homedir()}/.facet-secrets/starknet-gate-a-new`;
const accountFile = `${secretDir}/account.json`;
const keystoreFile = `${secretDir}/keystore.json`;
const profileFile = process.env.FACET_PAYMASTER_PROFILE
  ?? `${secretDir}/selfhost-paymaster-v2.json`;
const rpcUrl = process.env.FACET_PAYMASTER_RPC_URL
  ?? "https://sepolia.rpc.vauban.tech/rpc/v0_10";
const amount = process.env.FACET_PAYMASTER_TOPUP_STRK ?? "8";

function promptHidden(prompt) {
  if (!process.stdin.isTTY) throw new Error("Run this command directly in a terminal.");
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

const [accountInfo, keystore, profile] = await Promise.all([
  readFile(accountFile, "utf8").then(JSON.parse),
  readFile(keystoreFile, "utf8").then(JSON.parse),
  readFile(profileFile, "utf8").then(JSON.parse),
]);
const password = await promptHidden("Enter Gate A keystore password for paymaster top-up: ");
const privateKey = decryptKeystore(keystore, password);
const masterAddress = accountInfo.deployment.address;
const gasTank = profile.gas_tank.address;
const relayer = profile.relayers.addresses[0];
const token = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const amountWei = BigInt(amount) * 10n ** 18n;
const provider = new RpcProvider({ nodeUrl: rpcUrl });
const masterAccount = new Account({
  provider,
  address: masterAddress,
  signer: new Signer(privateKey),
  cairoVersion: "1",
});
const gasTankAccount = new Account({
  provider,
  address: gasTank,
  signer: new Signer(profile.gas_tank.private_key),
  cairoVersion: "1",
});

console.log(`Funding gas tank ${gasTank} with ${amount} STRK from Gate A...`);
const gasTankTransfer = await masterAccount.execute({
  contractAddress: token,
  entrypoint: "transfer",
  calldata: [gasTank, `0x${amountWei.toString(16)}`, "0x0"],
});
const gasTankReceipt = await provider.waitForTransaction(gasTankTransfer.transaction_hash);
if (!gasTankReceipt.isSuccess()) throw new Error("Gas-tank funding reverted.");
console.log(`Gas-tank funding transaction: ${gasTankTransfer.transaction_hash}`);

console.log(`Funding relayer ${relayer} with ${amount} STRK from gas tank...`);
const relayerTransfer = await gasTankAccount.execute({
  contractAddress: token,
  entrypoint: "transfer",
  calldata: [relayer, `0x${amountWei.toString(16)}`, "0x0"],
});
const relayerReceipt = await provider.waitForTransaction(relayerTransfer.transaction_hash);
if (!relayerReceipt.isSuccess()) throw new Error("Relayer funding reverted.");
console.log(`Relayer funding transaction: ${relayerTransfer.transaction_hash}`);
console.log("Paymaster gas tank and relayer funding completed.");
