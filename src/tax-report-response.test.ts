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

await Promise.all(([
  ["today", "2026-03-08", "2026-03-08", "2026-03-09"],
  ["7d", "2026-03-02", "2026-03-08", "2026-03-09"],
  ["30d", "2026-02-07", "2026-03-08", "2026-03-09"],
  ["month", "2026-03-01", "2026-03-08", "2026-03-09"],
  ["ytd", "2026-01-01", "2026-03-08", "2026-03-09"],
  ["last_month", "2026-02-01", "2026-02-28", "2026-03-01"],
] as const).map(([range, startDate, endDate, exclusive]) => test(`validates ${range} labels against the server calendar anchor`, () => {
  const period = { ...fixture().meta.period, range, startDate, endDate, endDateExclusive: exclusive,
    todayDate: "2026-03-08", start: `${startDate}T00:00:00.000Z`, end: `${exclusive}T00:00:00.000Z` };
  const source = { ...fixture().meta.source, readCompletedAt: "2026-03-08T12:00:00.000Z" };
  assert.ok(taxReportResponse({ ...fixture(), meta: { ...fixture().meta, period, source } }, { range }));
  assert.equal(taxReportResponse({ ...fixture(), meta: { ...fixture().meta, period } }, { range }), undefined);
  assert.equal(taxReportResponse({ ...fixture(), meta: { ...fixture().meta,
    period: { ...period, startDate: "2020-01-01", start: "2020-01-01T00:00:00.000Z" },
  } }, { range }), undefined);
})));

await Promise.all(([
  ["2026-03-09T06:00:10.000Z", true],
  ["2026-03-09T06:00:15.001Z", false],
  ["2026-03-08T12:00:00.000Z", true],
  ["2026-03-07T12:00:00.000Z", false],
] as const).map(([completedAt, accepted]) => test(`validates tenant-local anchor at ${completedAt}`, () => {
  const period = { ...fixture().meta.period, range: "today", timeZone: "America/Edmonton", todayDate: "2026-03-08",
    startDate: "2026-03-08", endDate: "2026-03-08", endDateExclusive: "2026-03-09",
    start: "2026-03-08T07:00:00.000Z", end: "2026-03-09T06:00:00.000Z" };
  const result = taxReportResponse({ ...fixture(), meta: { ...fixture().meta, period,
    source: { ...fixture().meta.source, readCompletedAt: completedAt } } }, { range: "today" });
  assert.equal(result !== undefined, accepted);
})));

await Promise.all([
  { start: "2030-01-01T00:00:00.000Z", end: "2030-02-01T00:00:00.000Z" },
  { start: "2026-01-01T12:00:00.000Z" },
  { end: "2026-02-01T12:00:00.000Z" },
  { timeZone: "Not/A_Timezone" },
  { endDateExclusive: "2030-01-01", end: "2030-01-01T00:00:00.000Z" },
].map((period, index) => test(`rejects inconsistent calendar boundary ${String(index)}`, () => {
  assert.equal(taxReportResponse({ ...fixture(), meta: { ...fixture().meta,
    period: { ...fixture().meta.period, ...period },
  } }, requested), undefined);
})));

void test("accepts tenant-local boundaries across a 23-hour DST day", () => {
  const period = { ...fixture().meta.period, start: "2026-03-08T07:00:00.000Z", end: "2026-03-09T06:00:00.000Z",
    startDate: "2026-03-08", endDate: "2026-03-08", endDateExclusive: "2026-03-09", timeZone: "America/Edmonton" };
  assert.ok(taxReportResponse({ ...fixture(), meta: { ...fixture().meta, period } },
    { ...requested, start_date: "2026-03-08", end_date: "2026-03-08" }));
});

await Promise.all(([
  ["entry_type", "refund"], ["authority", "unknown"], ["province", "Alberta"],
  ["received_at", "not-a-date"], ["received_at", "2026-02-30T12:00:00Z"],
  ["effective_at", "2026-02-30"], ["rate_ppm", -1],
  ["label", "bad\u0000label"], ["reason", "x".repeat(1_048_577)],
  ["registration_number", " untrimmed "],
] as const).map(([field, value], index) => test(`rejects malformed selected tax field ${String(index)}`, () => {
  assert.equal(taxReportResponse({ ...fixture(), data: { ...fixture().data,
    items: [{ ...fixture().data.items[0], [field]: value }],
  } }, { ...requested, fields: [field] }), undefined);
})));

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
