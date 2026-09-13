import assert from "node:assert/strict";
import { test } from "node:test";
import { validPaymentSummaryOptions } from "./payment-summary-contract.js";
import { paymentSummaryMcpTool } from "./payment-summary-mcp.js";

await Promise.all([
  ["2026-02-30", false], ["1900-02-29", false], ["2100-02-29", false], ["0099-01-01", false],
  ["2000-02-29", true], ["2024-02-29", true], ["2400-02-29", true], ["0100-01-01", true],
].map(([value, valid]) => test(`summary schema and validator agree on ${String(value)}`, () => {
  assert.equal(new RegExp(paymentSummaryMcpTool.inputSchema.properties.start_date.pattern, "u").test(String(value)), valid);
  assert.equal(validPaymentSummaryOptions({ range: "custom", start_date: value, end_date: value }), valid);
})));

await Promise.all([
  {}, { range: "today" }, { range: "month" }, { range: "last_month" }, { range: "ytd" },
  { range: "custom", start_date: "2026-03-08", end_date: "2026-03-08" },
  { range: "custom", start_date: "2024-02-29", end_date: "2024-03-01" },
].map((input, index) => test(`accepts summary filters ${String(index)}`, () => {
  assert.equal(validPaymentSummaryOptions(input), true);
})));

await Promise.all([
  null, [], { range: null }, { range: "week" }, { range: " today " },
  { tenant_id: "other" }, { currency: "CAD" }, { timeZone: "UTC" }, { provider: "d1" },
  { range: "today", start_date: "2026-03-08" }, { range: "custom" },
  { range: "custom", start_date: "2026-02-29", end_date: "2026-03-01" },
  { range: "custom", start_date: "2026-03-09", end_date: "2026-03-08" },
  { range: "custom", start_date: "2026-03-08T00:00:00Z", end_date: "2026-03-08" },
].map((input, index) => test(`rejects summary policy overrides or invalid dates ${String(index)}`, () => {
  assert.equal(validPaymentSummaryOptions(input), false);
})));
