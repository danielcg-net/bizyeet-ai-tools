import assert from "node:assert/strict";
import { test } from "node:test";
import { marginReportResponse } from "./margin-report-response.js";

const fingerprint = "a".repeat(64);
const id = `margin1.${fingerprint}.active_services.CAD.service`;
const row = { id, source: "service", status: "active", currency: "CAD", revenue: "100.00", missing_cost_count: 0,
  cost_basis: "actual", margin_amount: "-50.00", margin_percent: "-50.00", actual_cost: "150.00", private_cost: "secret" };
const totals = [{ currency: "CAD", count: 1, missing_cost_count: 0, cost_data_complete: true, revenue: "100.00",
  estimated_cost: "0.00", actual_cost: "150.00", effective_cost: "150.00", margin_amount: "-50.00", margin_percent: "-50.00" }];
const report = { data: { kind: "active_services", items: [row], totals, total: 1, private: "secret" }, meta: {
  contract_version: "v1", request_id: "synthetic-id", page: 1, page_size: 25, total_pages: 1, returned: 1,
  period: { range: "custom", timeZone: "America/Edmonton", start: "2026-01-01T07:00:00.000Z", end: "2026-02-01T07:00:00.000Z",
    startDate: "2026-01-01", endDate: "2026-01-31", endDateExclusive: "2026-02-01", todayDate: "2026-01-15",
    startInclusive: true, endInclusive: false },
  source: { provider: "d1", view: "active_services", readCompletedAt: "2026-01-15T12:00:00.000Z", private: "secret" },
  private: "secret" } };
const options = { kind: "active_services" as const, range: "custom" as const, start_date: "2026-01-01", end_date: "2026-01-31" };

void test("margin response retains explicit period and per-currency totals but redacts private row facts", () => {
  const projected = marginReportResponse(report, options);
  assert.equal((projected?.data as { kind: string }).kind, "active_services");
  assert.deepEqual((projected?.data as { items: unknown[] }).items, [{ id, source: "service", status: "active", currency: "CAD",
    revenue: "100.00", missing_cost_count: 0, cost_basis: "actual", margin_amount: "-50.00", margin_percent: "-50.00" }]);
  assert.deepEqual((projected?.data as { totals: unknown }).totals, totals);
  assert.doesNotMatch(JSON.stringify(projected), /secret|private_cost/u);
  assert.deepEqual((projected?.meta as { period: { startInclusive: boolean; endInclusive: boolean } }).period.startInclusive, true);
  assert.deepEqual((projected?.meta as { period: { startInclusive: boolean; endInclusive: boolean } }).period.endInclusive, false);
});

void test("explicit cost selection does not leak evidence fields", () => {
  const projected = marginReportResponse(report, { ...options, fields: ["actual_cost"] });
  assert.deepEqual((projected?.data as { items: unknown[] }).items, [{ id, actual_cost: "150.00" }]);
});

void test("margin handle preserves a canonical encoded source identifier", () => {
  const encoded = `margin1.${fingerprint}.active_services.CAD.service%20one`;
  const projected = marginReportResponse({ ...report, data: { ...report.data, items: [{ ...row, id: encoded }] } }, options);
  assert.deepEqual((projected?.data as { items: { id: string }[] }).items[0]?.id, encoded);
});

void test("multi-currency margin and missing cost remain separate and explicit", () => {
  const second = { ...row, id: `margin1.${fingerprint}.active_services.USD.other`, currency: "USD", revenue: "80.00",
    missing_cost_count: 1, cost_basis: "missing", margin_amount: null, margin_percent: null, actual_cost: "0.00" };
  const secondTotal = { ...totals[0], currency: "USD", revenue: "80.00", count: 1,
    missing_cost_count: 1, cost_data_complete: false, margin_amount: "0.00", margin_percent: null };
  const projected = marginReportResponse({ ...report, data: { ...report.data, items: [row, second], totals: [...totals, secondTotal], total: 2 },
    meta: { ...report.meta, returned: 2 } }, options);
  assert.deepEqual((projected?.data as { totals: unknown }).totals, [totals[0], secondTotal]);
  assert.deepEqual((projected?.data as { items: { margin_amount: string | null; cost_basis: string }[] }).items[1]?.margin_amount, null);
  assert.deepEqual((projected?.data as { items: { margin_amount: string | null; cost_basis: string }[] }).items[1]?.cost_basis, "missing");
});

await Promise.all([
  { ...report, data: { ...report.data, totals: [] } },
  { ...report, data: { ...report.data, items: [{ ...row, currency: "USD" }] } },
  { ...report, data: { ...report.data, items: [{ ...row, id: `margin1.${fingerprint}.sent_quotes.CAD.service` }] } },
  { ...report, data: { ...report.data, items: [{ ...row, id: `margin1.${fingerprint}.active_services.USD.service` }] } },
  { ...report, data: { ...report.data, items: [{ ...row, id: `margin1.${fingerprint}.active_services.CAD.%ZZ` }] } },
  { ...report, data: { ...report.data, items: [{ ...row, id: "margin1.short.active_services.CAD.service" }] } },
  { ...report, data: { ...report.data, items: [{ ...row, missing_cost_count: 1, cost_basis: "missing", margin_amount: "-50.00" }] } },
  { ...report, meta: { ...report.meta, period: { ...report.meta.period, endInclusive: true } } },
  { ...report, meta: { ...report.meta, source: { ...report.meta.source, provider: "zoho" } } },
  { ...report, meta: { ...report.meta, page: 2 } },
  { ...report, meta: { ...report.meta, period: { ...report.meta.period, start: "2026-01-01T00:00:00.000Z" } } },
  { ...report, meta: { ...report.meta, period: { ...report.meta.period, startDate: "2026-01-02" } } },
].map((value, index) => test(`margin response ${String(index)} rejects inconsistent financial evidence`, () => {
  assert.equal(marginReportResponse(value, options), undefined);
})));
