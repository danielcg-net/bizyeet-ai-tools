import assert from "node:assert/strict";
import { test } from "node:test";
import { validPaymentQuery } from "./payment-contract.js";

await Promise.all([
  {},
  { status: "received", sort: "amount", dir: "desc" },
  { date_field: "received_at", start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00.000Z" },
  { fields: ["id", "amount", "customer", "service"], search: "CAD" },
].map((query, index) => test(`accepts bounded payment query ${String(index)}`, () => {
  assert.equal(validPaymentQuery(query), true);
})));

await Promise.all([
  { status: "paid" }, { sort: "customer_business" }, { dir: "sideways" },
  { date_field: "updated_at" }, { start: "2026-02-30T00:00:00Z" },
  { start: "2026-09-01" }, { start: "2026-09-01T00:00:00+00:00" },
  { start: "2026-09-01T00:00:00.1Z" },
  { start: "2026-09-02T00:00:00Z", end: "2026-09-01T00:00:00Z" },
  { start: "2026-09-01T00:00:00Z", end: "2026-09-01T00:00:00.000Z" },
  { fields: ["customer_email"] }, { fields: ["provider_ref"] },
  { search: "x".repeat(121) },
].map((query, index) => test(`rejects invalid or private payment query ${String(index)}`, () => {
  assert.equal(validPaymentQuery(query), false);
})));
