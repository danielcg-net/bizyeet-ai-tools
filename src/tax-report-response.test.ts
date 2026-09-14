import assert from "node:assert/strict";
import { test } from "node:test";
import { taxReportResponse } from "./tax-report-response.js";

const group = (currency: string, amount: number): Readonly<Record<string, string | number>> => ({ currency, taxable_sales_minor: 1000, collected_tax_minor: amount, reversals_minor: 0, adjustments_minor: 0, net_collected_minor: amount, entry_count: 1 });
const template = { data: { total: 1, items: [{ id: "opaque-tax-id", entry_type: "collected", authority: "GST_HST", taxable_base_minor: 1000,
  amount_minor: 50, currency: "CAD", received_at: "2026-01-15T12:00:00Z", reason: "private", customer_name: "private customer" }], totals: [group("CAD", 50), group("USD", 30)] },
meta: { contract_version: "v1", request_id: "00000000-0000-4000-8000-000000000000", page: 1, page_size: 25, total_pages: 1, returned: 1, filing_ready: false,
  period: { range: "custom", timeZone: "UTC", start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00.000Z", startDate: "2026-01-01", endDate: "2026-01-31", endDateExclusive: "2026-02-01", todayDate: "2026-01-15", startInclusive: true, endInclusive: false },
  source: { provider: "d1", view: "immutable_tax_ledger", readCompletedAt: "2026-01-15T12:00:00.000Z", secret: "never expose" } } };
const fixture = (): typeof template => template;
const requested = { range: "custom", start_date: "2026-01-01", end_date: "2026-01-31" } as const;

void test("preserves currency totals and strips unrequested private fields", () => {
  const result = taxReportResponse(fixture(), requested);
  assert.ok(result);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(result).includes("never expose"), false);
  assert.deepEqual((result.data as Readonly<{ totals: unknown }>).totals, fixture().data.totals);
  assert.ok(Object.isFrozen(result));
});
void test("only exposes reason when explicitly requested", () => {
  const result = taxReportResponse(fixture(), { ...requested, fields: ["reason"] });
  assert.deepEqual((result?.data as Readonly<{ items: unknown }>).items, [{ id: "opaque-tax-id", reason: "private" }]);
});
await Promise.all([
  { ...fixture(), meta: { ...fixture().meta, filing_ready: true } },
  { ...fixture(), meta: { ...fixture().meta, page_size: 100 } },
  { ...fixture(), meta: { ...fixture().meta, source: { ...fixture().meta.source, provider: "zoho_invoice" } } },
  { ...fixture(), meta: { ...fixture().meta, period: { ...fixture().meta.period, startDate: "2026-01-02" } } },
  { ...fixture(), data: { ...fixture().data, totals: [group("CAD", Number.MAX_SAFE_INTEGER + 1)] } },
  { ...fixture(), data: { ...fixture().data, totals: [group("CAD", 50), group("CAD", 30)] } },
  { ...fixture(), data: { ...fixture().data, items: [{ ...fixture().data.items[0], amount_minor: "50" }] } },
].map((value, index) => test(`rejects malformed or mismatched report ${String(index)}`, () => { assert.equal(taxReportResponse(value, requested), undefined); })));
