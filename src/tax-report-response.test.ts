import assert from "node:assert/strict";
import { test } from "node:test";
import { taxReportResponse } from "./tax-report-response.js";

const group = (currency: string, amount: number): Readonly<Record<string, string | number>> => ({ currency, taxable_sales_minor: 1000, collected_tax_minor: amount, reversals_minor: 0, adjustments_minor: 0, net_collected_minor: amount, entry_count: 1 });
const template = { data: { total: 1, items: [{ id: "opaque-tax-id", entry_type: "collected", authority: "GST_HST", taxable_base_minor: 1000,
  amount_minor: 50, currency: "CAD", received_at: "2026-01-15T12:00:00Z", reason: "private", customer_name: "private customer" }], totals: [group("CAD", 50)] },
meta: { contract_version: "v1", request_id: "00000000-0000-4000-8000-000000000000", page: 1, page_size: 25, total_pages: 1, returned: 1, filing_ready: false,
  period: { range: "custom", timeZone: "UTC", start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00.000Z", startDate: "2026-01-01", endDate: "2026-01-31", endDateExclusive: "2026-02-01", todayDate: "2026-01-15", startInclusive: true, endInclusive: false },
  source: { provider: "d1", view: "immutable_tax_ledger", readCompletedAt: "2026-01-15T12:00:00.000Z", secret: "never expose" } } };
const fixture = (): typeof template => template;
const calendarFixture = (): typeof template => ({ ...template, data: { items: [], totals: [], total: 0 }, meta: { ...template.meta, returned: 0 } });
const requested = { range: "custom", start_date: "2026-01-01", end_date: "2026-01-31" } as const;

await Promise.all(([
  [0, 1, 0, true], [2, 1, 1, false], [3, 1, 2, true], [3, 1, 1, false],
  [3, 2, 1, true], [3, 2, 0, false], [3, 2, 2, false], [4, 2, 2, true],
  [4, 2, 1, false], [3, 99, 1, true],
] as const).map(([total, page, returned, accepted]) => test(`validates exact page population ${String(total)}/${String(page)}/${String(returned)}`, () => {
  const totalPages = Math.max(1, Math.ceil(total / 2));
  const input = { ...fixture(), data: { total,
    items: Array.from({ length: returned }, (_, index) => ({ ...fixture().data.items[0], id: `tax-row-${String(index)}` })),
    totals: total === 0 ? [] : [{ ...group("CAD", 50), entry_count: total }] },
  meta: { ...fixture().meta, page: Math.min(page, totalPages), page_size: 2, total_pages: totalPages, returned } };
  assert.equal(taxReportResponse(input, { ...requested, page, page_size: 2 }) !== undefined, accepted);
})));

await Promise.all(([
  ["currency", "USD"], ["authority", "BC_PST"], ["entry_type", "reversal"], ["province", "AB"],
] as const).map(([field, value]) => test(`rejects contradictory ${field} even when hidden by selection`, () => {
  assert.equal(taxReportResponse(fixture(), { ...requested, [field]: value, fields: ["reason"] }), undefined);
})));
void test("validates filter evidence but strips it from explicitly selected output", () => {
  const input = { ...fixture(), data: { ...fixture().data, total: 1, totals: [group("CAD", 50)] } };
  const result = taxReportResponse(input, { ...requested, currency: "CAD", authority: "GST_HST", entry_type: "collected", fields: ["reason"] });
  assert.deepEqual((result?.data as Readonly<{ items: unknown }>).items, [{ id: "opaque-tax-id", reason: "private" }]);
  assert.equal(taxReportResponse({ ...fixture(), data: { ...fixture().data, totals: [group("USD", 30)] } }, { ...requested, currency: "CAD" }), undefined);
});

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
  assert.ok(taxReportResponse({ ...calendarFixture(), meta: { ...calendarFixture().meta, period, source } }, { range }));
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
  const result = taxReportResponse({ ...calendarFixture(), meta: { ...calendarFixture().meta, period,
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
  assert.ok(taxReportResponse({ ...calendarFixture(), meta: { ...calendarFixture().meta, period } },
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
  const input = { ...fixture(), data: { ...fixture().data, total: 2,
    items: [...fixture().data.items, { ...fixture().data.items[0], id: "second-tax-id", currency: "USD" }],
    totals: [group("CAD", 50), group("USD", 30)] }, meta: { ...fixture().meta, returned: 2 } };
  const result = taxReportResponse(input, requested);
  assert.ok(result);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(result).includes("never expose"), false);
  assert.deepEqual((result.data as Readonly<{ totals: unknown }>).totals, input.data.totals);
  assert.ok(Object.isFrozen(result));
});
void test("rejects item currencies not represented in totals", () => {
  const input = { ...fixture(), data: { ...fixture().data, total: 2,
    items: [
      { ...fixture().data.items[0], id: "first-tax-id", currency: "CAD", reason: "first" },
      { ...fixture().data.items[0], id: "second-tax-id", currency: "USD", reason: "second" },
    ],
    totals: [Object.freeze({ ...group("CAD", 60), entry_count: 2 })] }, meta: { ...fixture().meta, returned: 2 } };
  const result = taxReportResponse(input, { ...requested, fields: ["reason"] });
  assert.equal(result, undefined);
});
void test("rejects duplicated ledger identities and inconsistent currency counts", () => {
  assert.equal(taxReportResponse({ ...fixture(), data: { ...fixture().data, total: 2, totals: [{ ...group("CAD", 50), entry_count: 2 }], items: [fixture().data.items[0], fixture().data.items[0]] },
    meta: { ...fixture().meta, returned: 2 } }, requested), undefined);
  assert.equal(taxReportResponse({ ...fixture(), data: { ...fixture().data, total: 3 } }, requested), undefined);
});
await Promise.all(["2030-01-15T12:00:00Z", "2025-12-31T23:59:59Z", "2026-02-01T00:00:00Z"].map((received_at) =>
  test(`rejects receipt outside reported period ${received_at}`, () => {
    assert.equal(taxReportResponse({ ...fixture(), data: { ...fixture().data, items: [{ ...fixture().data.items[0], received_at }] } },
      { ...requested, fields: ["reason"] }), undefined);
  })));
void test("does not reinterpret a supplied receipt date as record creation time", () => {
  assert.ok(taxReportResponse({ ...fixture(), data: { ...fixture().data,
    items: [{ ...fixture().data.items[0], received_at: "2026-01-20T12:00:00Z" }] } }, requested));
});
void test("only exposes reason when explicitly requested", () => {
  const result = taxReportResponse(fixture(), { ...requested, fields: ["reason"] });
  assert.deepEqual((result?.data as Readonly<{ items: unknown }>).items, [{ id: "opaque-tax-id", reason: "private" }]);
});
await Promise.all([
  { ...fixture(), meta: { ...fixture().meta, filing_ready: true } },
  { ...fixture(), meta: { ...fixture().meta, page_size: 100 } },
  { ...fixture(), meta: { ...fixture().meta, total_pages: 99 } },
  { ...fixture(), meta: { ...fixture().meta, source: { ...fixture().meta.source, provider: "zoho_invoice" } } },
  { ...fixture(), meta: { ...fixture().meta, period: { ...fixture().meta.period, startDate: "2026-01-02" } } },
  { ...fixture(), data: { ...fixture().data, totals: [group("CAD", Number.MAX_SAFE_INTEGER + 1)] } },
  { ...fixture(), data: { ...fixture().data, totals: [group("CAD", 50), group("CAD", 30)] } },
  { ...fixture(), data: { ...fixture().data, items: [{ ...fixture().data.items[0], amount_minor: "50" }] } },
].map((value, index) => test(`rejects malformed or mismatched report ${String(index)}`, () => { assert.equal(taxReportResponse(value, requested), undefined); })));
