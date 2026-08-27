import assert from "node:assert/strict";
import test from "node:test";
import { applicationContext, contextLabel } from "../assets/js/app-context.js";

test("application contexts keep one stable namespace and default rotation", () => {
  const context = applicationContext({ id: "ekubo", name: "Ekubo" });
  assert.deepEqual(context, {
    appId: "ekubo",
    dappName: "facet-mainnet-ekubo-v1",
    nonce: 0,
    lifecycle: "persistent",
  });
  assert.equal(contextLabel(context), "facet-mainnet-ekubo-v1 · nonce 0");
});

test("application contexts accept explicit namespaces and rotations", () => {
  const context = applicationContext({ id: "vesu", dappName: "facet-mainnet-vesu-v1", nonce: 2 });
  assert.equal(context.dappName, "facet-mainnet-vesu-v1");
  assert.equal(context.nonce, 2);
  assert.equal(context.lifecycle, "persistent");
});

test("application contexts reject unsafe identifiers", () => {
  assert.throws(() => applicationContext({ id: "../wallet" }), /context identifier/);
  assert.throws(() => applicationContext({ id: "ekubo", dappName: "facet context" }), /dapp name/);
  assert.throws(() => applicationContext({ id: "ekubo", nonce: -1 }), /nonce/);
});
