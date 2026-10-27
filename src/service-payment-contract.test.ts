import assert from "node:assert/strict";
import test from "node:test";
import { servicePaymentResponse, validServicePaymentOptions } from "./service-payment-contract.js";

const handle = `pay1.${"a".repeat(64)}.payment-1`;
const page = { data: { items: [{ id: handle, amount: "12.50", status: "sent", currency: "CAD", private_memo: "do not expose", service: { id: "secret" } }], total: 1 },
  meta: { contract_version: "v1", next_cursor: null, request_id: "request-1", private_trace: "secret" } };

void test("service payment options reject relationships, invalid filters, and excess page sizes", () => {
  assert.equal(validServicePaymentOptions({ limit: 5, fields: ["amount", "status"], status: "sent" }), true);
  [{ fields: ["service"] }, { fields: ["customer"] }, { status: "draft" }, { limit: 101 },
    { sort: "customer_business" }, { tenant_id: "other" }, { cursor: "\0" }, { search: "😀".repeat(121) }].forEach((options) => {
    assert.equal(validServicePaymentOptions(options), false);
  });
});

void test("service payment response projects only documented public facts", () => {
  const projected = servicePaymentResponse(page, { limit: 1, fields: ["amount", "status"] });
  assert.deepEqual(projected?.data, { items: [{ id: handle, amount: "12.50", status: "sent" }], total: 1 });
  assert.equal(JSON.stringify(projected).includes("private_memo"), false);
  assert.equal(JSON.stringify(projected).includes("private_trace"), false);
  assert.equal(JSON.stringify(projected).includes("service"), false);
});

void test("service payment response rejects malformed envelopes and non-scalar selected facts", () => {
  assert.equal(servicePaymentResponse({ ...page, data: { items: [{ id: "raw-id" }], total: 1 } }, {}), undefined);
  assert.equal(servicePaymentResponse({ ...page, data: { items: [{ id: handle, amount: { raw: "secret" } }], total: 1 } }, { fields: ["amount"] }), undefined);
  assert.equal(servicePaymentResponse({ ...page, data: { items: [{ id: handle }, { id: handle }], total: 1 } }, { limit: 1 }), undefined);
});
