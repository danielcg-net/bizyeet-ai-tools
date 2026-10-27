import assert from "node:assert/strict";
import { test } from "node:test";
import { validExpenseScheduleGetOptions, validExpenseScheduleListOptions } from "./expense-schedule-contract.js";

await Promise.all([{}, { active: "0", frequency: "monthly", sort: "active" }, { fields: ["interval_count", "generated_count"], page_size: 100 }, { search: "😀".repeat(120), currency: "CAD" }].map((input, index) => test(`accepts schedule query ${String(index)}`, () => {
  assert.equal(validExpenseScheduleListOptions(input), true);
})));
await Promise.all([null, [], { tenant_id: "other" }, { provider: "d1" }, { materialize: true }, { status: "paid" }, { schedule: "other" }, { start_date: "2026-01-01" },
  { fields: [] }, { fields: ["id", "id"] }, { fields: ["schedule_id"] }, { fields: ["notes"] }, { active: false }, { active: 0 }, { active: "2" },
  { frequency: "hourly" }, { sort: "incurred_on" }, { page_size: 101 }, { search: "x".repeat(121) }, { currency: "cad" },
].map((input, index) => test(`rejects schedule policy override or malformed input ${String(index)}`, () => {
  assert.equal(validExpenseScheduleListOptions(input), false);
})));
await test("exact schedule reads accept only fields", () => {
  assert.equal(validExpenseScheduleGetOptions({ fields: ["name"] }), true);
  assert.equal(validExpenseScheduleGetOptions({ page_size: 10 }), false);
  assert.equal(validExpenseScheduleGetOptions({ frequency: "monthly" }), false);
});
