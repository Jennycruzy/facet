import { createDecipheriv, scryptSync, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak_256 } from "@noble/hashes/sha3";
import { homedir } from "node:os";
import {
  Account,
  RpcProvider,
  Signer,
  CallData,
  constants,
  ec,
  hash,
} from "starknet";

const RPC_URL = process.env.FACET_MAINNET_RPC_URL
  // Cartridge currently returns an opaque internal error for DECLARE fee estimates.
  // Lava accepts the same v0.10 request and returned a fee estimate read-only.
  ?? "https://rpc.starknet.lava.build";
const ACCOUNT_DIR = process.env.FACET_MAINNET_ACCOUNT_DIR
  ?? `${homedir()}/.facet-secrets/starknet-gate2`;
const ACCOUNT_FILE = resolve(ACCOUNT_DIR, "account.json");
const KEYSTORE_FILE = resolve(ACCOUNT_DIR, "keystore.json");
const ARTIFACT_DIR = process.env.FACET_CONTRACT_ARTIFACT_DIR
  ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../contracts/target/mainnet-artifacts");

const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const SHADOW_ACCOUNT_CLASS_HASH =
  "0x346e143e3b353473a0d6f681c31ffcf2866537898008027fb3b57335bad7b5f";
const EXPECTED = {
  FacetAccount: {
    classHash: "0x5d07634600fff340d733946c2c8f925ee4c3c637c33f61e33e187b9024de46d",
    compiledClassHash: "0x147d6e959eada2c5dcd90745a62f968a0ac8813499f9f82ba64de0db2db4793",
    salt: "0x46414345545f4143434f554e545f7631",
  },
  ImmutableShadowAccountAnonymizer: {
    classHash: "0x85fbf40e535f188b695c1c3b4492c3045de7305c94e2ce7de4d0f9551adb21",
    compiledClassHash: "0x47ba3ac050abb5b4b94f80bf512afb5c36a623669656134666bf709b09f6706",
    salt: "0x46414345545f414e4f4e594d495a45525f7631",
  },
};

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
    const onData = (char) => {
      if (char === "\u0003") {
        process.stdin.off("data", onData);
        restore();
        reject(new Error("Cancelled"));
      } else if (char === "\r" || char === "\n") {
        process.stdin.off("data", onData);
        restore();
        resolvePrompt(value);
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

function collectAbiNames(value, names = new Set(), seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return names;
  seen.add(value);
  if (typeof value.name === "string") names.add(value.name);
  if (typeof value.interface_name === "string") names.add(value.interface_name);
  if (Array.isArray(value)) {
    for (const item of value) collectAbiNames(item, names, seen);
  } else {
    for (const item of Object.values(value)) collectAbiNames(item, names, seen);
  }
  return names;
}

function sierraForRpc(sierra) {
  // Mainnet's v0.10 RPC accepts the consensus Sierra fields only. Debug info is
  // useful locally but is not part of the declare payload and is rejected there.
  return {
    sierra_program: sierra.sierra_program,
    contract_class_version: sierra.contract_class_version,
    entry_points_by_type: sierra.entry_points_by_type,
    abi: typeof sierra.abi === "string" ? sierra.abi : JSON.stringify(sierra.abi),
  };
}

function assertArtifacts(name, sierra, casm) {
  const expected = EXPECTED[name];
  // The ABI is part of the Sierra class hash. Use the exact RPC representation
  // (ABI string, no debug metadata), which is also what Account.declare sends.
  const classHash = hash.computeSierraContractClassHash(sierraForRpc(sierra));
  const compiledClassHash = hash.computeCompiledClassHash(casm);
  if (BigInt(classHash) !== BigInt(expected.classHash)) {
    throw new Error(`${name} Sierra class hash mismatch: ${classHash}`);
  }
  if (BigInt(compiledClassHash) !== BigInt(expected.compiledClassHash)) {
    throw new Error(`${name} CASM class hash mismatch: ${compiledClassHash}`);
  }
  if (Object.hasOwn(sierra, "sierra_program_debug_info")) {
    console.log(`${name}: local artifact includes debug metadata; it will be removed from the RPC payload.`);
  }
  return { classHash, compiledClassHash };
}

function predictAddress(accountAddress, classHash, salt, constructorCalldata) {
  const deploySalt = ec.starkCurve.pedersen(accountAddress, salt);
  return hash.calculateContractAddressFromHash(
    deploySalt,
    classHash,
    CallData.compile(constructorCalldata),
    constants.UDC.ADDRESS,
  );
}

async function deployedClassHash(provider, address) {
  try {
    return await provider.getClassHashAt(address);
  } catch {
    return null;
  }
}

async function declareIfNeeded(account, provider, name, sierra, casm, classHash) {
  try {
    await provider.getClassByHash(classHash);
    console.log(`${name} class already declared: ${classHash}`);
    return "";
  } catch {
    console.log(`Declaring ${name}: ${classHash}`);
    const declaration = await account.declare({ contract: sierra, casm });
    const receipt = await provider.waitForTransaction(declaration.transaction_hash);
    if (!receipt.isSuccess()) throw new Error(`${name} declaration reverted.`);
    console.log(`${name} declaration transaction: ${declaration.transaction_hash}`);
    return declaration.transaction_hash;
  }
}

async function deployIfNeeded(account, provider, name, payload, expectedAddress) {
  const current = await deployedClassHash(provider, expectedAddress);
  if (current !== null) {
    if (BigInt(current) !== BigInt(payload.classHash)) {
      throw new Error(`${name} address has unexpected class hash: ${current}`);
    }
    console.log(`${name} already deployed: ${expectedAddress}`);
    return { address: expectedAddress, transactionHash: "" };
  }

  console.log(`Deploying ${name}: ${expectedAddress}`);
  const deployment = await account.deploy(payload);
  if (BigInt(deployment.contract_address[0]) !== BigInt(expectedAddress)) {
    throw new Error(`${name} predicted address mismatch: ${deployment.contract_address[0]}`);
  }
  const receipt = await provider.waitForTransaction(deployment.transaction_hash);
  if (!receipt.isSuccess()) throw new Error(`${name} deployment reverted.`);
  const deployedHash = await provider.getClassHashAt(expectedAddress);
  if (BigInt(deployedHash) !== BigInt(payload.classHash)) {
    throw new Error(`${name} class hash verification failed: ${deployedHash}`);
  }
  console.log(`${name} deployment transaction: ${deployment.transaction_hash}`);
  return { address: expectedAddress, transactionHash: deployment.transaction_hash };
}

const [accountInfo, keystore] = await Promise.all([
  readFile(ACCOUNT_FILE, "utf8").then(JSON.parse),
  readFile(KEYSTORE_FILE, "utf8").then(JSON.parse),
]);
const owner = accountInfo.deployment.address;
const password = await promptHidden("Enter mainnet deployment keystore password: ");
const privateKey = decryptKeystore(keystore, password);
if (BigInt(ec.starkCurve.getStarkKey(privateKey)) !== BigInt(accountInfo.variant.public_key)) {
  throw new Error("Keystore key does not match the mainnet account descriptor.");
}

const [facetSierra, facetCasm, anonymizerSierra, anonymizerCasm] = await Promise.all([
  readFile(resolve(ARTIFACT_DIR, "FacetAccount.sierra.json"), "utf8").then(JSON.parse),
  readFile(resolve(ARTIFACT_DIR, "FacetAccount.casm.json"), "utf8").then(JSON.parse),
  readFile(resolve(ARTIFACT_DIR, "ImmutableShadowAccountAnonymizer.sierra.json"), "utf8").then(JSON.parse),
  readFile(resolve(ARTIFACT_DIR, "ImmutableShadowAccountAnonymizer.casm.json"), "utf8").then(JSON.parse),
]);

const facetHashes = assertArtifacts("FacetAccount", facetSierra, facetCasm);
const anonymizerHashes = assertArtifacts(
  "ImmutableShadowAccountAnonymizer",
  anonymizerSierra,
  anonymizerCasm,
);
const facetDeclareClass = sierraForRpc(facetSierra);
const anonymizerDeclareClass = sierraForRpc(anonymizerSierra);
const anonymizerAbi = typeof anonymizerSierra.abi === "string"
  ? JSON.parse(anonymizerSierra.abi)
  : anonymizerSierra.abi;
const privilegedNames = [...collectAbiNames(anonymizerAbi)].filter((name) =>
  /upgrade|replace|proxy|governance|role|admin/i.test(name),
);
if (privilegedNames.length > 0) {
  throw new Error(`Immutable anonymizer ABI contains privileged names: ${privilegedNames.join(", ")}`);
}
console.log("Compiled ABI check: immutable anonymizer has no upgrade, proxy, governance, role, or admin entrypoint.");

const provider = new RpcProvider({ nodeUrl: RPC_URL });
const account = new Account({ provider, address: owner, signer: new Signer(privateKey), cairoVersion: "1" });
const networkChainId = await provider.getChainId();
if (networkChainId !== constants.StarknetChainId.SN_MAIN) {
  throw new Error(`Wrong network: ${networkChainId}`);
}
console.log(`Mainnet deployment account: ${owner}`);
console.log(`Immutable anonymizer privacy contract: ${POOL}`);
console.log(`Shadow account class: ${SHADOW_ACCOUNT_CLASS_HASH}`);

const anonymizerCtor = [POOL, SHADOW_ACCOUNT_CLASS_HASH];
const anonymizerAddress = predictAddress(
  owner,
  anonymizerHashes.classHash,
  EXPECTED.ImmutableShadowAccountAnonymizer.salt,
  anonymizerCtor,
);
const facetCtor = [owner, anonymizerAddress];
const facetAddress = predictAddress(
  owner,
  facetHashes.classHash,
  EXPECTED.FacetAccount.salt,
  facetCtor,
);
console.log(`Predicted immutable anonymizer: ${anonymizerAddress}`);
console.log(`Predicted FacetAccount: ${facetAddress}`);

const anonymizerDeclaration = await declareIfNeeded(
  account,
  provider,
  "ImmutableShadowAccountAnonymizer",
  anonymizerDeclareClass,
  anonymizerCasm,
  anonymizerHashes.classHash,
);
const facetDeclaration = await declareIfNeeded(
  account,
  provider,
  "FacetAccount",
  facetDeclareClass,
  facetCasm,
  facetHashes.classHash,
);

const anonymizerDeployment = await deployIfNeeded(
  account,
  provider,
  "ImmutableShadowAccountAnonymizer",
  {
    classHash: anonymizerHashes.classHash,
    constructorCalldata: anonymizerCtor,
    salt: EXPECTED.ImmutableShadowAccountAnonymizer.salt,
    unique: true,
  },
  anonymizerAddress,
);
const facetDeployment = await deployIfNeeded(
  account,
  provider,
  "FacetAccount",
  {
    classHash: facetHashes.classHash,
    constructorCalldata: facetCtor,
    salt: EXPECTED.FacetAccount.salt,
    unique: true,
  },
  facetAddress,
);

console.log(JSON.stringify({
  network: "SN_MAIN",
  owner,
  pool: POOL,
  classes: {
    ImmutableShadowAccountAnonymizer: {
      classHash: anonymizerHashes.classHash,
      compiledClassHash: anonymizerHashes.compiledClassHash,
      declarationTransaction: anonymizerDeclaration,
      address: anonymizerDeployment.address,
      deploymentTransaction: anonymizerDeployment.transactionHash,
    },
    FacetAccount: {
      classHash: facetHashes.classHash,
      compiledClassHash: facetHashes.compiledClassHash,
      declarationTransaction: facetDeclaration,
      address: facetDeployment.address,
      deploymentTransaction: facetDeployment.transactionHash,
    },
  },
}, null, 2));
