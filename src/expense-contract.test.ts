import assert from "node:assert/strict";
import { test } from "node:test";
import { validExpenseListOptions } from "./expense-contract.js";

await Promise.all([
  {}, { fields: ["amount", "currency"], page_size: 100 }, { search: "😀".repeat(120) },
  { start_date: "2024-02-29", end_date: "2024-02-29" }, { start_date: "2026-01-01" },
  { status: "skipped", currency: "CAD", sort: "amount", dir: "asc" }, { cursor: "a".repeat(43) },
].map((input, index) => test(`accepts expense transport query ${String(index)}`, () => {
  assert.equal(validExpenseListOptions(input), true);
})));
await Promise.all([
  null, [], { tenant_id: "other" }, { provider: "d1" }, { materialize: true }, { offset: 1 },
  { fields: [] }, { fields: ["id", "id"] }, { fields: ["tenant_id"] }, { fields: [null] },
  { page_size: 0 }, { page_size: 101 }, { page_size: 1.5 }, { page_size: "1" },
  { search: "😀".repeat(121) }, { search: "\uD800" }, { search: "line\nbreak" },
  { currency: "cad" }, { status: "received" }, { sort: "native_id" }, { dir: "ASC" },
  { cursor: "short" }, { cursor: "x".repeat(129) }, { schedule: "" },
  { start_date: "2026-02-29" }, { end_date: "1900-02-29" }, { start_date: "0099-01-01" },
  { start_date: "2026-09-02", end_date: "2026-09-01" }, { start_date: null },
].map((input, index) => test(`rejects expense policy override or malformed query ${String(index)}`, () => {
  assert.equal(validExpenseListOptions(input), false);
})));
