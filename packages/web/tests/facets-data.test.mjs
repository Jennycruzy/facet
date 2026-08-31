import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const data = JSON.parse(await readFile(new URL("../data/facets.json", import.meta.url), "utf8"));

test("facet cards have stable identities, recorded fallbacks, and transaction blocks", () => {
  assert.ok(data.facets.length > 0);
  assert.equal(new Set(data.facets.map((facet) => facet.id)).size, data.facets.length);
  for (const facet of data.facets) {
    assert.match(facet.address, /^0x[0-9a-f]{60,}$/i);
    assert.match(facet.snapshotBalanceWei, /^\d+$/);
    assert.ok(facet.transactions.length > 0);
    for (const transaction of facet.transactions) {
      assert.match(transaction.hash, /^0x[0-9a-f]{60,}$/i);
      assert.equal(typeof transaction.block, "number");
    }
  }
});

const VERIFIED = "wallet-mediated-verified";

test("only routes with a Mainnet receipt carry the verified status", () => {
  assert.deepEqual(
    data.apps.filter((app) => app.status === VERIFIED).map((app) => app.id).sort(),
    ["ekubo", "endur"],
  );
  for (const app of data.apps) {
    assert.ok(app.name);
    assert.ok(app.action);
    assert.ok(app.monogram);
  }
});

test("every route uses a clean public path", () => {
  assert.deepEqual(
    Object.fromEntries(data.apps.map((app) => [app.id, app.executionPage])),
    { ekubo: "/ekubo", endur: "/endur", "ekubo-exit": "/ekubo-exit" },
  );
});

test("a route may only claim a Mainnet transaction if it has the verified status", () => {
  for (const app of data.apps) {
    if (app.status === VERIFIED) {
      assert.match(app.mainnetTransaction, /^0x[0-9a-f]{60,}$/i,
        `${app.id} claims verification without a transaction hash`);
    } else {
      assert.equal(app.mainnetTransaction, undefined,
        `${app.id} is unexecuted and must not carry a transaction hash`);
    }
  }
});

test("the Endur exit is pinned to the initialised xSTRK/STRK pool key", () => {
  const exit = data.apps.find((app) => app.id === "ekubo-exit");
  const endur = data.apps.find((app) => app.id === "endur");
  // Endur's redeem returns a queue ticket, not STRK, so the exit is a secondary-market swap of
  // the xSTRK the stake route produced. The 0.05% / 1000 key returns NOT_INITIALIZED for this pair.
  assert.equal(exit.route.tokenIn, endur.outputToken);
  assert.equal(exit.route.tokenOut, data.strk);
  assert.equal(exit.route.fee, "0x68db8bac710cb4000000000000000");
  assert.equal(exit.route.tickSpacing, 200);
  assert.equal(exit.route.token0, exit.route.tokenIn);
  assert.equal(exit.route.token1, exit.route.tokenOut);
  assert.ok(BigInt(exit.route.token0) < BigInt(exit.route.token1), "pool key must be sorted");
  assert.equal(exit.lifecycle.contextApp, "endur");
  assert.deepEqual(exit.lifecycle.closesAssets.map(BigInt), [BigInt(endur.outputToken)]);
});

test("every Ekubo-shaped route carries the parameters the shared page reads", () => {
  for (const app of data.apps.filter((candidate) => candidate.route)) {
    for (const key of ["token0","token1","fee","tickSpacing","tokenIn","tokenInSymbol",
                       "tokenOut","tokenOutSymbol","defaultAmount","slippageBps"]) {
      assert.ok(app.route[key] !== undefined, `${app.id} route is missing ${key}`);
    }
    assert.notEqual(app.route.tokenIn, app.route.tokenOut);
    assert.match(app.route.defaultAmount, /^\d+$/);
  }
});

test("Endur is bound to the reviewed Mainnet ERC-4626 route", () => {
  const mainnet = data.networks.mainnet;
  for (const id of ["endur"]) {
    const app = data.apps.find((candidate) => candidate.id === id);
    assert.ok(app);
    assert.equal(app.executionPage, "/endur");
    assert.match(app.contract, /^0x[0-9a-f]{60,}$/i);
    assert.match(app.outputToken, /^0x[0-9a-f]{60,}$/i);
    assert.match(app.helper, /^0x[0-9a-f]{60,}$/i);
    assert.match(app.helperClassHash, /^0x[0-9a-f]{60,}$/i);
    const helper = mainnet.endurHelper;
    assert.equal(helper.status, "deployed");
    assert.match(helper.deploymentTransaction, /^0x[0-9a-f]{60,}$/i);
    assert.equal(typeof helper.deploymentBlock, "number");
    assert.equal(BigInt(helper.constructorCalldata[1]), BigInt(data.strk));
    assert.equal(BigInt(helper.constructorCalldata[2]), BigInt(app.outputToken));
    assert.equal(app.status, "wallet-mediated-verified");
    assert.match(app.mainnetTransaction, /^0x[0-9a-f]{60,}$/i);
    assert.equal(app.mainnetBlock, 14052044);
  }
});

test("verified Mainnet integrations are unique receipts and blocked routes have no hash", () => {
  const verified = data.apps.filter((app) => app.status === "wallet-mediated-verified");
  assert.deepEqual(verified.map((app) => app.id).sort(), ["ekubo", "endur"]);
  assert.equal(new Set(verified.map((app) => app.mainnetTransaction)).size, verified.length);
  for (const app of verified) {
    assert.match(app.mainnetTransaction, /^0x[0-9a-f]{60,}$/i);
    assert.equal(typeof app.mainnetBlock, "number");
    assert.notEqual(app.executionEnabled, false);
  }
});

test("the product separates Mainnet route evidence from Sepolia identity evidence", () => {
  assert.ok(data.facets.every((facet) => facet.network === "sepolia"));
  const verified = data.apps.filter((app) => app.status === "wallet-mediated-verified");
  assert.equal(verified.length, 2);
  assert.ok(verified.every((app) => app.mainnetTransaction && app.mainnetBlock));
  assert.match(data.uncutNote, /identity on Mainnet/i);
});

test("reviewed route code can resolve every Mainnet target from the data file", () => {
  const mainnet = data.networks.mainnet;
  for (const value of [mainnet.rpc, mainnet.pool, mainnet.anonymizer, mainnet.eth, mainnet.ekuboRouter]) {
    assert.ok(value);
  }
  const ekubo = data.apps.find((app) => app.id === "ekubo");
  assert.equal(ekubo.helper, mainnet.ekuboHelper.address);
  assert.equal(ekubo.helperClassHash, mainnet.ekuboHelper.classHash);
  assert.equal(ekubo.router, mainnet.ekuboRouter);
});
