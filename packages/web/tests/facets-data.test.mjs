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

test("launcher contexts are the same three cards documented by the product", () => {
  assert.deepEqual(
    data.apps.map((app) => app.id).sort(),
    ["ekubo", "endur", "vesu"],
  );
  for (const app of data.apps) {
    assert.ok(app.name);
    assert.ok(app.action);
    assert.ok(app.monogram);
  }
});

test("Vesu and Endur are bound to reviewed Mainnet ERC-4626 routes", () => {
  const mainnet = data.networks.mainnet;
  for (const id of ["vesu", "endur"]) {
    const app = data.apps.find((candidate) => candidate.id === id);
    assert.ok(app);
    assert.equal(app.executionPage, `mainnet-defi.html?protocol=${id}`);
    assert.match(app.contract, /^0x[0-9a-f]{60,}$/i);
    assert.match(app.outputToken, /^0x[0-9a-f]{60,}$/i);
    assert.match(app.helper, /^0x[0-9a-f]{60,}$/i);
    assert.match(app.helperClassHash, /^0x[0-9a-f]{60,}$/i);
    const helper = mainnet[id === "vesu" ? "vesuHelper" : "endurHelper"];
    assert.equal(helper.status, "deployed");
    assert.match(helper.deploymentTransaction, /^0x[0-9a-f]{60,}$/i);
    assert.equal(typeof helper.deploymentBlock, "number");
    assert.equal(BigInt(helper.constructorCalldata[1]), BigInt(data.strk));
    assert.equal(BigInt(helper.constructorCalldata[2]), BigInt(app.outputToken));
    assert.equal(
      app.status,
      id === "vesu" ? "wallet-mediated-blocked" : "wallet-mediated-verified",
    );
    if (id === "vesu") {
      assert.equal(app.executionEnabled, false);
      assert.match(app.blockReason, /not-allowed/);
    } else {
      assert.match(app.mainnetTransaction, /^0x[0-9a-f]{60,}$/i);
      assert.equal(app.mainnetBlock, 14052044);
    }
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
  const vesu = data.apps.find((app) => app.id === "vesu");
  assert.equal(vesu.status, "wallet-mediated-blocked");
  assert.equal(vesu.executionEnabled, false);
  assert.equal(vesu.mainnetTransaction, undefined);
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
