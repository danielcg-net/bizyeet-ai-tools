import assert from "node:assert/strict";
import { test } from "node:test";
import { paymentSummaryResponse } from "./payment-summary-response.js";

const period = Object.freeze({ range: "custom", timeZone: "America/Edmonton", start: "2026-03-08T07:00:00.000Z", end: "2026-03-09T06:00:00.000Z" });
const currencies = Object.freeze([
  Object.freeze({ currency: "CAD", amount: 5, paymentCount: 1, usedDefaultCurrency: false }),
  Object.freeze({ currency: "CAD", amount: 3, paymentCount: 1, usedDefaultCurrency: true }),
  Object.freeze({ currency: "USD", amount: 7, paymentCount: 2, usedDefaultCurrency: false }),
]);
const data = Object.freeze({ label: "gross collected receipts", start: period.start, end: period.end, period, currencies, source: Object.freeze({ provider: "d1", readCompletedAt: "2026-03-10T00:00:00.000Z" }) });
const envelope = (value: unknown): unknown => ({ data: value, meta: { contract_version: "v1" } });

await test("preserves distinct currency and legacy groups without exposing extra fields", () => {
  const result = paymentSummaryResponse(envelope({ ...data, tenant_id: "private", currencies: currencies.map((row) => ({ ...row, private_cost: 99 })) }));
  assert.ok(result);
  assert.deepEqual(result.data, data);
  assert.doesNotMatch(JSON.stringify(result), /private/u);
});

await Promise.all([
  { ...data, currencies: [{ ...currencies[0], amount: null }] },
  { ...data, currencies: [{ ...currencies[0], amount: Infinity }] },
  { ...data, currencies: [{ ...currencies[0], paymentCount: -1 }] },
  { ...data, currencies: [{ ...currencies[0], usedDefaultCurrency: "false" }] },
  { ...data, label: "net revenue" }, { ...data, start: period.end },
  { ...data, period: { ...period, end: period.start } },
  { ...data, source: { provider: "d1" } },
].map((value, index) => test(`rejects malformed summary ${String(index)}`, () => {
  assert.equal(paymentSummaryResponse(envelope(value)), undefined);
})));
