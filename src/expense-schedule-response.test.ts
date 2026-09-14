import assert from "node:assert/strict";
import { test } from "node:test";
import { expenseScheduleResponse } from "./expense-schedule-response.js";

const source = Object.freeze({ provider: "d1", view: "persisted", readCompletedAt: "2026-09-13T00:00:00.000Z", materialization: { performed: false, status: "not_evaluated" } });
const item = Object.freeze({ id: "opaque-schedule", active: 0, generated_count: 0, notes: "private note", tenant_id: "private" });
const meta = Object.freeze({ contract_version: "v1", source, next_cursor: null });
await test("schedule projection preserves zero values and omits unrequested fields and invented periods", () => {
  const result = expenseScheduleResponse({ data: { items: [item], total: 1 }, meta }, { fields: ["active", "generated_count"] }, null);
  assert.deepEqual(result?.data, { items: [{ id: item.id, active: 0, generated_count: 0 }], total: 1 });
  assert.doesNotMatch(JSON.stringify(result), /private|period/iu);
});
await Promise.all([
  ["active", false], ["active", 2], ["generated_count", -1], ["generated_count", 1.5],
  ["interval_count", 0], ["interval_count", 366], ["frequency", "hourly"], ["start_date", null],
  ["start_date", "2026-02-29"], ["end_date", "2026-04-31"],
].map(([field, value], index) => test(`invalid schedule fact ${String(index)} fails closed`, () => {
  assert.equal(expenseScheduleResponse({ data: { ...item, [String(field)]: value }, meta }, { fields: [String(field)] }, item.id), undefined);
})));
await test("schedule exact read binds identity and permits explicit notes", () => {
  const body = { data: item, meta };
  assert.deepEqual(expenseScheduleResponse(body, { fields: ["notes"] }, item.id)?.data, { id: item.id, notes: item.notes });
  assert.equal(expenseScheduleResponse(body, { fields: ["notes"] }, "other"), undefined);
});
