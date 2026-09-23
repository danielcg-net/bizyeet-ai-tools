import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";
import { quoteResponse } from "./quote-response.js";
import { validQuoteReadFields } from "./quote-read-contract.js";

const detail = Object.freeze({ data: { id: "opaque-quote", pricing_revision: 2, sent_count: 0, notes: "hidden",
  items: [{ id: "opaque-quote-line", description: "Transfer", quantity: "2", unit_price: "25.00", unit_cost: "hidden" }] },
meta: { contract_version: "v1", secret: "hidden" } });

void test("quote reads retain edit prerequisites but remove private fields", () => {
  const result = quoteResponse(detail, { fields: ["pricing_revision", "items"] }, "opaque-quote");
  assert.deepEqual(result?.data, { id: "opaque-quote", pricing_revision: 2,
    items: [{ id: "opaque-quote-line", description: "Transfer", quantity: "2", unit_price: "25.00" }] });
  assert.equal(JSON.stringify(result).includes("hidden"), false);
  assert.equal(quoteResponse(detail, {}, "other"), undefined);
  assert.equal(validQuoteReadFields(["pricing_revision", "items"]), true);
  assert.equal(validQuoteReadFields(["notes"]), false);
  [0, -1, 1.5, "2"].forEach((pricing_revision) => {
    assert.equal(quoteResponse({ ...detail, data: { ...detail.data, pricing_revision } }, {}, "opaque-quote"), undefined);
  });
  assert.equal(quoteResponse({ ...detail, data: { ...detail.data, sent_count: -1 } }, {}, "opaque-quote"), undefined);
  assert.equal(quoteResponse({ ...detail, data: { ...detail.data, items: [{ description: "Missing handle" }] } }, {}, "opaque-quote"), undefined);
});

void test("quote requests use canonical OAuth transport and deny unsupported fields before auth", async () => {
  const client = createCanonicalCrmClient({ origin: "https://example.com", getAccessToken: () => Promise.resolve("oauth-token"),
    request: (url, init) => {
      assert.equal(url, "https://example.com/api/agent/quotes/opaque-quote?api_version=v1&fields=pricing_revision%2Citems");
      assert.equal(new Headers(init.headers).get("Authorization"), "Bearer oauth-token");
      assert.equal(init.method, "GET");
      return Promise.resolve(Response.json(detail));
    } });
  assert.equal((await client.get("quotes", "opaque-quote", { fields: ["pricing_revision", "items"] })).status, 200);
  const denied = createCanonicalCrmClient({ origin: "https://example.com", getAccessToken: () => { throw new Error("must not authenticate"); } });
  assert.equal((await denied.list("quotes", { sort: "amount" })).status, 400);
  assert.equal((await denied.get("quotes", "opaque-quote", { fields: ["unit_cost"] })).status, 400);
});

void test("quote pagination preserves opaque cursors and rejects malformed envelopes", async () => {
  const page = { data: { items: [{ id: "opaque-quote", pricing_revision: 2 }], total: 1 },
    meta: { contract_version: "v1", next_cursor: "opaque-cursor" } };
  const client = createCanonicalCrmClient({ origin: "https://example.com", getAccessToken: () => Promise.resolve("oauth-token"),
    request: (url) => {
      assert.equal(new URL(url).pathname, "/api/agent/quotes");
      assert.equal(new URL(url).searchParams.get("cursor"), "opaque-cursor");
      assert.equal(new URL(url).searchParams.get("limit"), "1");
      return Promise.resolve(Response.json(page));
    } });
  assert.equal((await client.list("quotes", { cursor: "opaque-cursor", page_size: 1 })).status, 200);
  assert.equal(quoteResponse({ ...page, meta: { ...page.meta, next_cursor: "bad\0cursor" } }, {}, null), undefined);
  assert.equal(quoteResponse({ ...page, data: { ...page.data, total: 0 } }, {}, null), undefined);
  assert.equal(quoteResponse(page, { page_size: 0 }, null), undefined);
});
