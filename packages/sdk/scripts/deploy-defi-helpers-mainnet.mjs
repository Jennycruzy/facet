import { createDecipheriv, scryptSync, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak_256 } from "@noble/hashes/sha3";
import { homedir } from "node:os";
import {
  Account,
  CallData,
  RpcProvider,
  Signer,
  constants,
  ec,
  hash,
} from "starknet";

// Facet's own pinned allowlisted ERC-4626 helper. It is bound at construction
// to one privacy pool, one underlying token, and one vault. The same declared
// class is used by two deterministic instances below; only the vault differs.
const HELPER_CLASS_HASH =
  "0x65f9084b78e26882f2dc1f57b5dff660126487d3b2495cf0fec79ef5bc2c9d4";
const HELPER_COMPILED_CLASS_HASH =
  "0x74f090a448998ae228ea2294d8e007d83174f36ca8498d152b6f4c53692eb05";

const RPC_URL = process.env.FACET_MAINNET_RPC_URL ?? "https://rpc.starknet.lava.build";
const ACCOUNT_DIR = process.env.FACET_MAINNET_ACCOUNT_DIR
  ?? `${homedir()}/.facet-secrets/starknet-gate2`;
const ACCOUNT_FILE = resolve(ACCOUNT_DIR, "account.json");
const KEYSTORE_FILE = resolve(ACCOUNT_DIR, "keystore.json");
const ARTIFACT_DIR = process.env.FACET_CONTRACT_ARTIFACT_DIR
  ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../contracts/target/dev");

const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const XSTRK = "0x028d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a";

const HELPERS = [
  {
    id: "endur",
    label: "Endur xSTRK",
    vault: XSTRK,
    salt: "0x46414345545f454e4455525f7631", // FACET_ENDUR_v1
  },
];

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

function sierraForRpc(sierra) {
  // Debug metadata is useful locally but is not part of a Mainnet declare payload.
  return {
    sierra_program: sierra.sierra_program,
    contract_class_version: sierra.contract_class_version,
    entry_points_by_type: sierra.entry_points_by_type,
    abi: typeof sierra.abi === "string" ? sierra.abi : JSON.stringify(sierra.abi),
  };
}

function predictedAddress(owner, salt, constructorCalldata) {
  const deploySalt = ec.starkCurve.pedersen(owner, salt);
  return hash.calculateContractAddressFromHash(
    deploySalt,
    HELPER_CLASS_HASH,
    CallData.compile(constructorCalldata),
    constants.UDC.ADDRESS,
  );
}

function assertArtifacts(sierra, casm) {
  const classHash = hash.computeSierraContractClassHash(sierraForRpc(sierra));
  const compiledClassHash = hash.computeCompiledClassHash(casm);
  if (BigInt(classHash) !== BigInt(HELPER_CLASS_HASH)) {
    throw new Error(`Helper Sierra class hash mismatch: ${classHash}`);
  }
  if (BigInt(compiledClassHash) !== BigInt(HELPER_COMPILED_CLASS_HASH)) {
    throw new Error(`Helper CASM class hash mismatch: ${compiledClassHash}`);
  }
  return { classHash, compiledClassHash };
}

async function deployedClassHash(provider, address) {
  try {
    return await provider.getClassHashAt(address);
  } catch {
    return null;
  }
}

const [accountInfo, sierra, casm] = await Promise.all([
  readFile(ACCOUNT_FILE, "utf8").then(JSON.parse),
  readFile(resolve(ARTIFACT_DIR, "facet_contracts_FacetErc4626Anonymizer.contract_class.json"), "utf8")
    .then(JSON.parse),
  readFile(resolve(ARTIFACT_DIR, "facet_contracts_FacetErc4626Anonymizer.compiled_contract_class.json"), "utf8")
    .then(JSON.parse),
]);
const hashes = assertArtifacts(sierra, casm);
const owner = accountInfo.deployment.address;
const provider = new RpcProvider({ nodeUrl: RPC_URL });

if (await provider.getChainId() !== constants.StarknetChainId.SN_MAIN) {
  throw new Error("The configured RPC is not Starknet Mainnet.");
}

const records = HELPERS.map((helper) => ({
  ...helper,
  address: predictedAddress(owner, helper.salt, [POOL, STRK, helper.vault]),
  classHash: hashes.classHash,
  constructorCalldata: [POOL, STRK, helper.vault],
}));

let classDeclared = true;
try {
  await provider.getClassByHash(HELPER_CLASS_HASH);
} catch {
  classDeclared = false;
}

for (const helper of records) {
  const current = await deployedClassHash(provider, helper.address);
  helper.deployed = current !== null;
  if (current !== null && BigInt(current) !== BigInt(HELPER_CLASS_HASH)) {
    throw new Error(`${helper.label} address is occupied by class ${current}.`);
  }
}

console.log(`Mainnet owner: ${owner}`);
console.log(`Facet ERC-4626 helper class: ${HELPER_CLASS_HASH}`);
console.log(`Compiled class hash: ${HELPER_COMPILED_CLASS_HASH}`);
console.log(`Class declared: ${classDeclared ? "yes" : "no"}`);
for (const helper of records) {
  console.log(`${helper.label} helper: ${helper.address} (${helper.deployed ? "deployed" : "not deployed"})`);
}

if (process.argv.includes("--check")) {
  console.log("Check complete: artifacts, Mainnet network, class state, and deterministic addresses inspected; no transaction submitted.");
  console.log(JSON.stringify({
    network: "SN_MAIN",
    owner,
    classHash: HELPER_CLASS_HASH,
    compiledClassHash: HELPER_COMPILED_CLASS_HASH,
    classDeclared,
    helpers: records,
  }, null, 2));
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

if (!classDeclared) {
  console.log(`Declaring Facet ERC-4626 helper class ${HELPER_CLASS_HASH}…`);
  const declaration = await account.declare({ contract: sierraForRpc(sierra), casm });
  const receipt = await provider.waitForTransaction(declaration.transaction_hash);
  if (!receipt.isSuccess()) throw new Error("Facet ERC-4626 helper class declaration reverted.");
  console.log(`Helper class declaration transaction: ${declaration.transaction_hash}`);
}

for (const helper of records) {
  if (helper.deployed) continue;
  console.log(`Deploying ${helper.label} through the Mainnet UDC…`);
  const deployment = await account.deploy({
    classHash: HELPER_CLASS_HASH,
    constructorCalldata: helper.constructorCalldata,
    salt: helper.salt,
    unique: true,
  });
  if (BigInt(deployment.contract_address[0]) !== BigInt(helper.address)) {
    throw new Error(`${helper.label} predicted address mismatch: ${deployment.contract_address[0]}`);
  }
  const receipt = await provider.waitForTransaction(deployment.transaction_hash);
  if (!receipt.isSuccess()) throw new Error(`${helper.label} deployment reverted.`);
  const deployedHash = await provider.getClassHashAt(helper.address);
  if (BigInt(deployedHash) !== BigInt(HELPER_CLASS_HASH)) {
    throw new Error(`${helper.label} class hash verification failed: ${deployedHash}`);
  }
  helper.deployed = true;
  helper.deploymentTransaction = deployment.transaction_hash;
  console.log(`${helper.label} deployment transaction: ${deployment.transaction_hash}`);
}

console.log(JSON.stringify({
  network: "SN_MAIN",
  owner,
  classHash: HELPER_CLASS_HASH,
  compiledClassHash: HELPER_COMPILED_CLASS_HASH,
  helpers: records,
}, null, 2));
