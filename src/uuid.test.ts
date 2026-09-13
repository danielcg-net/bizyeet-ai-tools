import assert from "node:assert/strict";
import { test } from "node:test";
import { isUuid } from "./uuid.js";

await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((version) => test(`accepts assigned UUID version ${String(version)} in either case`, () => {
  const id = `abcdefab-1234-${String(version)}abc-8def-abcdefabcdef`;
  assert.equal(isUuid(id), true);
  assert.equal(isUuid(id.toUpperCase()), true);
})));

await Promise.all([
  null, undefined, 123, "", "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff",
  ...["0", "9", "f"].map((version) => `abcdefab-1234-${version}abc-8def-abcdefabcdef`),
  "abcdefab-1234-7abc-cdef-abcdefabcdef", "abcdefab-1234-7abc-8def-abcdefabcdeg",
  " abcdefab-1234-7abc-8def-abcdefabcdef", "abcdefab-1234-7abc-8def-abcdefabcdef\n",
].map((value, index) => test(`rejects invalid UUID case ${String(index)}`, () => { assert.equal(isUuid(value), false); })));
