import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";
import { serviceResponse } from "./service-response.js";

const detail = Object.freeze({ data: { id: "opaque-service", pricing_revision: 3, cost_notes: "hidden",
  items: [{ id: "opaque-line", description: "Transfer", quantity: "2", unit_price: "25.00", unit_cost: "hidden" }] },
meta: { contract_version: "v1", secret: "hidden" } });

void test("service detail strips nested costs and retains update prerequisites", () => {
  const result = serviceResponse(detail, { fields: ["pricing_revision", "items"] }, "opaque-service");
  assert.ok(result);
  assert.equal(JSON.stringify(result).includes("hidden"), false);
  assert.deepEqual(result.data, { id: "opaque-service", pricing_revision: 3,
    items: [{ id: "opaque-line", description: "Transfer", quantity: "2", unit_price: "25.00" }] });
  assert.equal(serviceResponse(detail, {}, "other-service"), undefined);
  assert.equal(serviceResponse({ ...detail, data: { ...detail.data, pricing_revision: "3" } }, {}, "opaque-service"), undefined);
});

void test("service transport requests only canonical OAuth endpoints and rejects invalid projections before auth", async () => {
  const client = createCanonicalCrmClient({ origin: "https://example.com", getAccessToken: () => Promise.resolve("oauth-token"),
    request: (url, init) => {
      assert.equal(url, "https://example.com/api/agent/services/opaque-service?api_version=v1&fields=pricing_revision%2Citems");
      assert.equal(new Headers(init.headers).get("Authorization"), "Bearer oauth-token");
      assert.equal(init.method, "GET");
      return Promise.resolve(Response.json(detail));
    } });
  assert.equal((await client.get("services", "opaque-service", { fields: ["pricing_revision", "items"] })).status, 200);
  const denied = createCanonicalCrmClient({ origin: "https://example.com", getAccessToken: () => { throw new Error("must not authenticate"); } });
  assert.equal((await denied.list("services", { fields: ["items"] })).status, 400);
  assert.equal((await denied.get("services", "opaque-service", { fields: ["unit_cost"] })).status, 400);
});

void test("service pages retain bounded cursors and never replace malformed pages with empty success", () => {
  const page = { data: { items: [{ id: "opaque-service", pricing_revision: 3 }], total: 1 }, meta: { contract_version: "v1", next_cursor: null } };
  assert.ok(serviceResponse(page, { page_size: 1 }, null));
  assert.equal(serviceResponse(page, { page_size: 0 }, null), undefined);
  assert.equal(serviceResponse({ ...page, meta: { ...page.meta, next_cursor: "bad\0value" } }, {}, null), undefined);
  assert.equal(serviceResponse({ ...page, data: { ...page.data, total: 0 } }, {}, null), undefined);
});
