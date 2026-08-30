import test from "node:test";
import assert from "node:assert/strict";
import { parseTokenAmount } from "../assets/js/amount.js";

test("token amount parser accepts arbitrary positive STRK amounts", () => {
  assert.equal(parseTokenAmount("0.1", 18, "STRK"), 100000000000000000n);
  assert.equal(parseTokenAmount("2.4", 18, "STRK"), 2400000000000000000n);
  assert.equal(parseTokenAmount("0.000000000000000001", 18, "STRK"), 1n);
});

test("token amount parser rejects zero, negatives, exponents, and excess precision", () => {
  for (const value of ["0", "-1", "1e2", "0.0000000000000000001", "nope"]) {
    assert.throws(() => parseTokenAmount(value, 18, "STRK"));
  }
});
