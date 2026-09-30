import assert from "node:assert/strict";
import { test } from "node:test";
import { validMarginReportOptions } from "./margin-report-contract.js";

void test("margin filters keep tenant calendar and provider selection server-owned", () => {
  assert.equal(validMarginReportOptions({ kind: "sent_quotes", range: "custom", start_date: "2026-02-01", end_date: "2026-02-28",
    page: 2, page_size: 50, fields: ["id", "revenue", "actual_cost"] }), true);
  assert.equal(validMarginReportOptions({ range: "7d" }), true);
  assert.equal(validMarginReportOptions({ range: "30d" }), true);
  assert.equal(validMarginReportOptions({ range: "custom", start_date: "2024-02-29", end_date: "2024-03-01" }), true);
});

await Promise.all([
  { provider: "d1" }, { tenant_id: "other" }, { timeZone: "UTC" }, { kind: "sales" },
  { range: "custom", start_date: "2026-02-30", end_date: "2026-03-01" },
  { range: "today", start_date: "2026-01-01" }, { range: "custom", start_date: "2026-02-02", end_date: "2026-02-01" },
  { range: "7d", start_date: "2026-01-01" }, { range: "30d", end_date: "2026-01-31" },
  { page: 0 }, { page: 1_000_001 }, { page_size: 51 }, { fields: [] }, { fields: ["id", "id"] },
  { fields: ["customer_name"] },
].map((value, index) => test(`margin option ${String(index)} fails closed`, () => {
  assert.equal(validMarginReportOptions(value), false);
})));
