import assert from "node:assert/strict";
import test from "node:test";
import { serviceRevision, validServiceReadFields } from "./service-read-contract.js";

void test("service projections permit revision tokens but never private fields or list items", () => {
  assert.equal(validServiceReadFields(["pricing_revision", "items"], true), true);
  assert.equal(validServiceReadFields(["pricing_revision"], false), true);
  assert.equal(validServiceReadFields(["items"], false), false);
  ["unit_cost", "cost_notes", "customer_id", "tenant_id"].forEach((field) => {
    assert.equal(validServiceReadFields([field], true), false);
  });
});

void test("revision projection preserves opaque handles and strips undocumented facts", () => {
  const result = serviceRevision({ pricing_revision: 7, tenant_id: "private", items: [
    { id: "opaque-service-line", description: "Transfer", quantity: "2", unit_price: "25.00", unit_cost: "private" },
  ] });
  assert.deepEqual(result, { pricing_revision: 7, items: [
    { id: "opaque-service-line", description: "Transfer", quantity: "2", unit_price: "25.00" },
  ] });
  assert.equal(Object.isFrozen(result.items[0]), true);
});

void test("revision projection fails closed for missing tokens and malformed items", () => {
  [0, -1, 1.5, "7", Number.MAX_SAFE_INTEGER + 1, undefined].forEach((revision) => {
    assert.equal(serviceRevision({ pricing_revision: revision, items: [] }), undefined);
  });
  [null, {}, { id: "", description: "", quantity: "1", unit_price: "1.00" }].forEach((line) => {
    assert.equal(serviceRevision({ pricing_revision: 1, items: [line] }), undefined);
  });
});
