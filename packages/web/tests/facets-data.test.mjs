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
