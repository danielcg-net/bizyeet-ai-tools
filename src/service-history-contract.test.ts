import assert from "node:assert/strict";
import { test } from "node:test";
import { serviceHistoryResponse, validServiceHistoryOptions } from "./service-history-contract.js";

const page = { data: { items: [{ from_status: null, to_status: "delivered", created_at: "2026-09-01T00:00:00.000Z", private_note: "do not expose" }], total: 1 },
  meta: { contract_version: "v1", next_cursor: null, request_id: "safe-reference", tenant_id: "private" } };

void test("service history projects only bounded immutable lifecycle facts", () => {
  const result = serviceHistoryResponse(page, { limit: 10 });
  assert.deepEqual(result, { data: { items: [{ from_status: null, to_status: "delivered", created_at: "2026-09-01T00:00:00.000Z" }], total: 1 },
    meta: { contract_version: "v1", next_cursor: null, request_id: "safe-reference" } });
  assert.doesNotMatch(JSON.stringify(result), /private_note|tenant_id|do not expose/u);
});

void test("service history rejects malformed pagination and forged response shapes", () => {
  [{ limit: 0 }, { limit: 101 }, { cursor: "" }, { fields: ["private_note"] }].forEach((options) => {
    assert.equal(validServiceHistoryOptions(options), false);
  });
  [
    { ...page, data: { items: [...page.data.items, ...page.data.items], total: 2 } },
    { ...page, data: { items: [{ ...page.data.items[0], to_status: {} }], total: 1 } },
    { ...page, meta: { ...page.meta, next_cursor: "" } },
    { ...page, data: { items: page.data.items, total: 0 } },
  ].forEach((invalid) => { assert.equal(serviceHistoryResponse(invalid, { limit: 1 }), undefined); });
});
