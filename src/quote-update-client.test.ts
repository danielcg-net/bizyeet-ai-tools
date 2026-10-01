import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";

const previewId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const quoteId = "sales1.fingerprint.quotes.quote";
const lineId = `${quoteId}.items.line`;
const meta = { contract_version: "v1", request_id: "synthetic-request", private: "hidden" };
const proposal = { resource_id: quoteId, quote: { title: "Revised", expectedPricingRevision: 2,
  items: [{ id: lineId, description: "Transfer", quantity: "2", unitPrice: "25.00" }] } };
const preview = { data: { preview_id: previewId, request_hash: "h".repeat(43), expires_at: "2030-01-01T00:00:00.000Z",
  confirmation_class: "reversible_write", operation: "quote_update", resource_id: quoteId, resource_label: "Revised",
  proposed_changes: { quoteTitle: "Revised", lineItems: "2 × Transfer — 25.00", totalAmount: "50.00", pricingCurrency: "CAD",
    grossAmount: "50.00", discountAmount: "0.00", discountCode: "", discountCodeId: "" },
  side_effects: ["Update one draft quote"], warnings: [], idempotency_key_format: "uuid",
  approval_path: `/dashboard/#/agent-approvals/${previewId}`, private: "hidden" }, meta };
const completed = { data: { resource: { id: quoteId, title: "Revised", status: "draft",
  items: [{ id: lineId, description: "Transfer", quantity: "2", unit_price: "25.00", unit_cost: "hidden" }], private: "hidden" },
  audit_reference: previewId, private: "hidden" }, meta };

void test("quote update binds preview to one quote and projects an approved execution", async () => {
  const request = mock.fn((url: string, init: RequestInit) => {
    assert.match(url, /^https:\/\/tenant\.example\/api\/agent\/quotes\/update-(?:preview|execute)\?api_version=v1$/u);
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer oauth-token");
    assert.equal(init.redirect, "error");
    if (url.includes("preview")) {
      const body = init.body;
      assert.equal(typeof body, "string");
      if (typeof body !== "string") throw new Error("Expected JSON body");
      assert.deepEqual(JSON.parse(body), proposal);
    }
    return Promise.resolve(Response.json(url.includes("preview") ? preview : completed, { status: 200 }));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  const prepared = await client.previewQuoteUpdate(proposal);
  assert.equal(prepared.status, 200);
  assert.equal(JSON.stringify(prepared).includes("hidden"), false);
  const result = await client.executeQuoteUpdate({ preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key });
  assert.equal(result.status, 200);
  assert.deepEqual((result.body as { data: { resource: { items: unknown } } }).data.resource.items,
    [{ id: lineId, description: "Transfer", quantity: "2", unit_price: "25.00" }]);
  assert.equal(JSON.stringify(result).includes("hidden"), false);
  assert.equal(request.mock.callCount(), 2);
});

void test("quote update rejects wrong-bound previews and never retries uncertain execution", async () => {
  const request = mock.fn((url: string) => Promise.resolve(Response.json(url.includes("preview")
    ? { ...preview, data: { ...preview.data, resource_id: "other-quote" } } : { error: { code: "internal_error" } },
  { status: url.includes("preview") ? 200 : 503 })));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  assert.equal((await client.previewQuoteUpdate(proposal)).status, 502);
  const result = await client.executeQuoteUpdate({ preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key });
  assert.deepEqual(result.body, { error: { code: "execution_ambiguous" } });
  assert.equal(request.mock.callCount(), 2);
  const invalid = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => { throw new Error("must not authenticate"); } });
  assert.equal((await invalid.previewQuoteUpdate({ resource_id: "/bad", quote: {} })).status, 400);
});

void test("quote update status validates a 200 outcome without repeating the mutation", async () => {
  const request = mock.fn((url: string, init: RequestInit) => {
    assert.equal(new URL(url).pathname, "/api/agent/quotes/update-status");
    assert.equal(new URL(url).searchParams.get("preview_id"), previewId);
    assert.equal(new URL(url).searchParams.get("idempotency_key"), key);
    assert.equal(init.method, "GET");
    return Promise.resolve(Response.json({ data: { preview_id: previewId, state: "succeeded", retry_mutation: false,
      reconciliation_required: false, outcome: { status: 200, data: completed.data } }, meta }));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  const result = await client.quoteUpdateStatus({ preview_id: previewId, idempotency_key: key });
  assert.equal(result.status, 200);
  assert.equal(JSON.stringify(result).includes("hidden"), false);
  assert.equal(request.mock.callCount(), 1);
});
