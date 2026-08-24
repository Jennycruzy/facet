import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const clientFile = process.env.FACET_PAYMASTER_CLIENT_FILE
  ?? "/Users/user/.facet-secrets/starknet-gate-a-new/selfhost-paymaster-client.json";
const mode = process.argv[2] ?? "run";
if (!new Set(["preflight", "run"]).has(mode)) {
  throw new Error("Usage: node scripts/gate-a-selfhost.mjs [preflight|run]");
}

const client = JSON.parse(await readFile(clientFile, "utf8"));
if (!client.apiKey || !client.poolAddress || !client.localUrl) {
  throw new Error(`Incomplete self-hosted paymaster client profile: ${clientFile}`);
}

const target = mode === "preflight"
  ? "gate-a-avnu-preflight.mjs"
  : "gate-a-sepolia.mjs";
const child = spawn(process.execPath, [new URL(target, import.meta.url).pathname], {
  stdio: "inherit",
  env: {
    ...process.env,
    FACET_PAYMASTER_API_KEY: client.apiKey,
    FACET_PAYMASTER_URL: client.localUrl,
    FACET_POOL_ADDRESS: client.poolAddress,
    FACET_USE_TEST_POOL: "1",
  },
});

child.once("error", (error) => {
  throw error;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
