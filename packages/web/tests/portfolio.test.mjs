import assert from "node:assert/strict";
import test from "node:test";

import {
  assetCatalog,
  decodeWalletBalances,
  extractPartialCommitment,
  loadPortfolio,
  routeApps,
} from "../assets/js/portfolio.js";

const STRK = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const XSTRK = "0x28d709c875c0ceac3dce7065bec5328186dc89fe254527084d1689910954b0a";
const ETH = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

const apps = [
  {
    id: "endur", name: "Endur", dappName: "facet-mainnet-endur-v1", nonce: 0,
    outputToken: XSTRK, outputSymbol: "xSTRK",
    policy: { supportedAssets: [STRK, XSTRK] },
  },
  {
    id: "ekubo", name: "Ekubo", dappName: "facet-mainnet-ekubo-v1", nonce: 0,
    route: { tokenIn: STRK, tokenInSymbol: "STRK", tokenOut: ETH, tokenOutSymbol: "ETH" },
    policy: { supportedAssets: [STRK, ETH] },
  },
  { id: "ekubo-exit", lifecycle: { contextApp: "endur" }, policy: { supportedAssets: [] } },
];

test("normalizes wallet commitment response wrappers", () => {
  assert.equal(extractPartialCommitment({ partial_commitment: "0x000abc" }), "0xabc");
  assert.equal(extractPartialCommitment({ result: { partialCommitment: 12 } }), "0xc");
  assert.equal(extractPartialCommitment(["0x44"]), "0x44");
  assert.equal(extractPartialCommitment({ error: "NOT_SUPPORTED" }), null);
});

test("decodes only requested private assets and defaults missing balances to zero", () => {
  const balances = decodeWalletBalances([{ token: STRK, balance: "5" }, { token: "0xdead", balance: "9" }], [STRK, ETH]);
  assert.equal(balances.get(STRK), 5n);
  assert.equal(balances.get(ETH), 0n);
  assert.deepEqual(routeApps(apps).map((app) => app.id), ["endur", "ekubo"]);
  assert.deepEqual(assetCatalog(apps, STRK).map(({ symbol }) => symbol), ["STRK", "xSTRK", "ETH"]);
});

test("loads private balances and resolves public facets without creating lifecycle state", async () => {
  const storage = new Map();
  // The activity cache is session-scoped; nothing identifying may reach localStorage.
  globalThis.sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const disk = new Map();
  globalThis.localStorage = {
    getItem: (key) => disk.get(key) ?? null,
    setItem: (key, value) => disk.set(key, value),
    removeItem: (key) => disk.delete(key),
  };
  const wallet = {
    async request(message) {
      if (message.type === "wallet_strk20Balances") {
        return [{ token: STRK, balance: "5000000000000000000" }, { token: XSTRK, balance: "7" }];
      }
      if (message.type === "wallet_strk20ShadowAccountCommitment") {
        return { partial_commitment: "0xabc" };
      }
      throw new Error("unexpected wallet request " + message.type);
    },
  };
  const chain = {
    async shadowAccounts(_network, _anonymizer, partial, nonce) {
      assert.equal(partial, "0xabc");
      assert.equal(nonce, 0);
      return [{ nonce: 0n, address: "0xdef", isDeployed: true }];
    },
    async balanceOf(_network, token, address) {
      assert.equal(address, "0xdef");
      return token === XSTRK ? 11n : 0n;
    },
  };
  const result = await loadPortfolio({
    wallet, chain, anonymizer: "0x999", apps, strk: STRK, account: "0xowner",
  });
  assert.equal(result.privateBalances[STRK], "5000000000000000000");
  assert.equal(result.privateBalances[XSTRK], "7");
  assert.equal(result.facets.length, 2);
  assert.equal(result.facets[0].chain.address, "0xdef");
  assert.equal(result.facets[0].chain.positions[0].symbol, "xSTRK");
  assert.equal(storage.get("facet-activity-session-v2"), undefined,
    "portfolio discovery created a wallet-to-app lifecycle record");
  assert.equal(disk.size, 0, "the portfolio refresh wrote a wallet-to-app record to disk");
});
