import assert from "node:assert/strict";
import test from "node:test";
import { escapeDisplayJson } from "./display-json.js";

void test("display JSON escapes controls and format characters without changing opaque values", () => {
  const value = { cursor: "a\u0000\u009b\u202e\u2028\u2029\u{e0001}\ud800z", label: "café 🎉", "\u202e": "key" };
  const serialized = escapeDisplayJson(JSON.stringify(value));
  assert.doesNotMatch(serialized, /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u);
  assert.deepEqual(JSON.parse(serialized) as unknown, value);
  assert.ok(serialized.includes("café 🎉"));
  assert.equal(escapeDisplayJson(serialized), serialized);
});
