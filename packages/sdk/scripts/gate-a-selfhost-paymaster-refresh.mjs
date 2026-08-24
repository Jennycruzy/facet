process.env.FACET_PAYMASTER_FORCE_SETUP = "1";
process.env.FACET_PAYMASTER_PROFILE ??=
  "/Users/user/.facet-secrets/starknet-gate-a-new/selfhost-paymaster-v2.json";
process.env.FACET_PAYMASTER_CLIENT ??=
  "/Users/user/.facet-secrets/starknet-gate-a-new/selfhost-paymaster-client-v2.json";
process.env.FACET_PAYMASTER_CLI ??=
  "/Users/user/.facet-tools/avnu-paymaster/target/release/paymaster-cli";
await import("./gate-a-selfhost-paymaster-setup.mjs");
