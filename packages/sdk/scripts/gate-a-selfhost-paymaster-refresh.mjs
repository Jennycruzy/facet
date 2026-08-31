import { homedir } from "node:os";
process.env.FACET_PAYMASTER_FORCE_SETUP = "1";
process.env.FACET_PAYMASTER_PROFILE ??=
  `${homedir()}/.facet-secrets/starknet-gate-a-new/selfhost-paymaster-v2.json`;
process.env.FACET_PAYMASTER_CLIENT ??=
  `${homedir()}/.facet-secrets/starknet-gate-a-new/selfhost-paymaster-client-v2.json`;
process.env.FACET_PAYMASTER_CLI ??=
  `${homedir()}/.facet-tools/avnu-paymaster/target/release/paymaster-cli`;
await import("./gate-a-selfhost-paymaster-setup.mjs");
