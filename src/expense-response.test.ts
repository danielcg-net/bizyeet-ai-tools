import assert from "node:assert/strict";
import { test } from "node:test";
import { expenseResponse } from "./expense-response.js";
import { validResourceId } from "./canonical-crm-client.js";

const source = Object.freeze({ provider: "d1", view: "persisted", readCompletedAt: "2026-09-13T00:00:00.000Z", materialization: { performed: false, status: "not_evaluated" } });
const period = Object.freeze({ kind: "calendar_dates", startDate: null, endDate: null, startInclusive: true, endInclusive: true });
const item = Object.freeze({ id: "opaque-expense", amount: "123.45", currency: "CAD", notes: "do not expose", tenant_id: "private" });
const envelope = (meta: Readonly<Record<string, unknown>> = {}): unknown => ({ data: { items: [item], total: 1 }, meta: { contract_version: "v1", source, period, next_cursor: null, ...meta } });
const options = Object.freeze({ fields: Object.freeze(["amount", "currency"]) });

await Promise.all([
  "😀".repeat(512), "😀".repeat(513), "x".repeat(512), "x".repeat(513),
  "a/b", "a\\b", "a?b", "a#b", ".", "%2e%2e", "\ud800", "a\u0000b", "opaque-expense",
].map((id, index) => test(`expense request and response identities share bounds ${String(index)}`, () => {
  const data = { id, schedule_id: id };
  const fields = { fields: ["schedule_id"] };
  const meta = { contract_version: "v1", source, period, next_cursor: null };
  assert.equal(expenseResponse({ data, meta }, fields, id) !== undefined, validResourceId(id));
  assert.equal(expenseResponse({ data: { items: [data], total: 1 }, meta }, fields, null) !== undefined, validResourceId(id));
  assert.equal(expenseResponse({ data: { id: "valid", schedule_id: id }, meta }, fields, "valid") !== undefined, validResourceId(id));
})));

await test("expense projection preserves money and strips unrequested/private fields", () => {
  const result = expenseResponse(envelope(), options, null);
  assert.deepEqual(result?.data, { items: [{ id: item.id, amount: "123.45", currency: "CAD" }], total: 1 });
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(result).includes("do not expose"), false);
});
await Promise.all([
  { source: undefined }, { source: { ...source, provider: "zoho" } }, { source: { ...source, view: "live" } },
  { source: { ...source, readCompletedAt: "2026-02-30T00:00:00.000Z" } },
  { source: { ...source, materialization: { performed: true, status: "complete" } } },
  { period: undefined }, { period: { ...period, endInclusive: false } },
  { period: { ...period, startDate: "2026-09-01" } }, { next_cursor: "bad" },
].map((meta, index) => test(`rejects malformed or mismatched expense metadata ${String(index)}`, () => {
  assert.equal(expenseResponse(envelope(meta), options, null), undefined);
})));
await test("expense detail binds the returned identity and permits explicitly requested notes", () => {
  const body = { data: item, meta: { contract_version: "v1", source } };
  assert.deepEqual(expenseResponse(body, { fields: ["notes"] }, item.id)?.data, { id: item.id, notes: item.notes });
  assert.equal(expenseResponse(body, options, "different-id"), undefined);
});
await test("expense list rejects overfull pages, invalid money and missing requested fields", () => {
  assert.equal(expenseResponse(envelope(), { ...options, page_size: 0 }, null), undefined);
  assert.equal(expenseResponse(envelope(), { fields: ["name"] }, null), undefined);
  assert.equal(expenseResponse({ data: { ...item, amount: "NaN" }, meta: { contract_version: "v1", source } }, options, item.id), undefined);
});
