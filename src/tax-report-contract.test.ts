import assert from "node:assert/strict";
import { test } from "node:test";
import { validTaxReportOptions } from "./tax-report-contract.js";

await Promise.all([
  {}, { range: "7d" }, { range: "30d" }, { range: "month" }, { range: "last_month" },
  { range: "custom", start_date: "2024-02-29", end_date: "2024-02-29" },
  { authority: "GST_HST", entry_type: "reversal", province: "AB", currency: "CAD", page: 2, page_size: 100, fields: ["reason"] },
].map((input, index) => test(`accepts canonical tax query ${String(index)}`, () => { assert.equal(validTaxReportOptions(input), true); })));

await Promise.all([
  null, [], { tenant_id: "other" }, { provider: "d1" }, { timeZone: "UTC" }, { period: {} },
  { range: null }, { range: "unknown" }, { range: "mtd" }, { range: "7d", start_date: "2026-01-01" },
  { range: "custom" }, { range: "custom", start_date: "2026-02-29", end_date: "2026-03-01" },
  { range: "custom", start_date: "2026-02-02", end_date: "2026-02-01" },
  { page: "1" }, { page: 0 }, { page: 1_000_001 }, { page_size: 101 }, { page_size: 1.5 },
  { fields: [] }, { fields: ["id", "id"] }, { fields: ["payment_id"] }, { fields: ["customer_name"] },
  { fields: [null] }, { authority: "OTHER" }, { province: "abc" }, { currency: "cad" }, { entry_type: "COLLECTED" },
].map((input, index) => test(`rejects malformed tax query ${String(index)}`, () => { assert.equal(validTaxReportOptions(input), false); })));
