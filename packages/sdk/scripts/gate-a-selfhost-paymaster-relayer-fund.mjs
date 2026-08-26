import { readFile } from "node:fs/promises";
import { Account, RpcProvider, Signer } from "starknet";

const secretDir = "/Users/user/.facet-secrets/starknet-gate-a-new";
const profileFile = process.env.FACET_PAYMASTER_PROFILE
  ?? `${secretDir}/selfhost-paymaster-v2.json`;
const rpcUrl = process.env.FACET_PAYMASTER_RPC_URL
  ?? "https://sepolia.rpc.vauban.tech/rpc/v0_10";
const token = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const profile = JSON.parse(await readFile(profileFile, "utf8"));
const amount = BigInt(process.env.FACET_PAYMASTER_RELAYER_FUND_STRK ?? "8") * 10n ** 18n;
const gasTank = profile.gas_tank.address;
const relayer = profile.relayers.addresses[0];
const provider = new RpcProvider({ nodeUrl: rpcUrl });
const account = new Account({
  provider,
  address: gasTank,
  signer: new Signer(profile.gas_tank.private_key),
  cairoVersion: "1",
});

console.log(`Moving ${amount / 10n ** 18n} STRK from the existing gas tank to relayer ${relayer}...`);
const low = `0x${amount.toString(16)}`;
const tx = await account.execute({
  contractAddress: token,
  entrypoint: "transfer",
  calldata: [relayer, low, "0x0"],
});
console.log(`Relayer funding submitted: ${tx.transaction_hash}`);
const receipt = await provider.waitForTransaction(tx.transaction_hash);
console.log(`Relayer funding confirmed: ${receipt.status ?? "confirmed"}`);
