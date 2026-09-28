import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";

const previewId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const receipt = "r".repeat(43);
const meta = { contract_version: "v1", request_id: "synthetic-request", private: "hidden" };
const proposal = { quote: { customerId: "opaque-customer", title: "Transfer", items: [{ description: "Transfer", quantity: "1", unitPrice: "25.00" }] } };
const preview = { data: { preview_id: previewId, request_hash: "h".repeat(43), expires_at: "2030-01-01T00:00:00.000Z",
  confirmation_class: "reversible_write", operation: "quote_create", resource_id: "opaque-customer", resource_label: "Customer",
  proposed_changes: { quoteTitle: "Transfer", parentType: "Customer", lineItems: "1 × Transfer — 25.00", totalAmount: "25.00", pricingCurrency: "CAD" }, side_effects: ["Create draft"], warnings: [],
  idempotency_key_format: "uuid", approval_path: `/dashboard/#/agent-approvals/${previewId}`, secret: "hidden" }, meta };
const completed = { data: { resource: { id: "opaque-quote", title: "Transfer", items: [{ description: "Transfer", quantity: "1", unit_price: "25.00", unit_cost: "hidden" }], private: "hidden" },
  audit_reference: previewId, secret: "hidden" }, meta };

void test("quote create uses canonical OAuth POST and projects only approved fields", async () => {
  const request = mock.fn((url: string, init: RequestInit) => {
    assert.match(url, /^https:\/\/tenant\.example\/api\/agent\/quotes\/create-(?:preview|execute)\?api_version=v1$/u);
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer oauth-token");
    assert.equal(init.redirect, "error");
    if (url.includes("preview")) assert.deepEqual(JSON.parse(String(init.body)), proposal);
    return Promise.resolve(Response.json(url.includes("preview") ? preview : completed, { status: url.includes("preview") ? 200 : 201 }));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  const prepared = await client.previewQuoteCreate(proposal);
  assert.equal(prepared.status, 200);
  assert.equal(JSON.stringify(prepared).includes("hidden"), false);
  const result = await client.executeQuoteCreate({ preview_id: previewId, approval_receipt: receipt, idempotency_key: key });
  assert.equal(result.status, 201);
  assert.deepEqual((result.body as { data: { resource: { items: unknown } } }).data.resource.items,
    [{ description: "Transfer", quantity: "1", unit_price: "25.00" }]);
  assert.equal(JSON.stringify(result).includes("hidden"), false);
  assert.equal(request.mock.callCount(), 2);
});

void test("quote create does not retry ambiguous execute and rejects malformed previews before authentication", async () => {
  const request = mock.fn(() => Promise.resolve(Response.json({ error: { code: "internal_error" } }, { status: 503 })));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  const result = await client.executeQuoteCreate({ preview_id: previewId, approval_receipt: receipt, idempotency_key: key });
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: { code: "execution_ambiguous" } });
  assert.equal(request.mock.callCount(), 1);
  const invalid = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => { throw new Error("must not authenticate"); } });
  assert.equal((await invalid.previewQuoteCreate({ quote: [] as unknown as Readonly<Record<string, unknown>> })).status, 400);
  assert.equal((await invalid.executeQuoteCreate({ preview_id: previewId, approval_receipt: "bad", idempotency_key: key })).status, 400);
});

void test("quote status validates a 201 outcome and strips private data without mutation", async () => {
  const request = mock.fn((url: string, init: RequestInit) => {
    assert.equal(new URL(url).pathname, "/api/agent/quotes/create-status");
    assert.equal(new URL(url).searchParams.get("preview_id"), previewId);
    assert.equal(new URL(url).searchParams.get("idempotency_key"), key);
    assert.equal(init.method, "GET");
    return Promise.resolve(Response.json({ data: { preview_id: previewId, state: "succeeded", retry_mutation: false,
      reconciliation_required: false, outcome: { status: 201, data: completed.data } }, meta }));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  const result = await client.quoteCreateStatus({ preview_id: previewId, idempotency_key: key });
  assert.equal(result.status, 200);
  assert.equal(JSON.stringify(result).includes("hidden"), false);
  assert.equal(request.mock.callCount(), 1);
});
