import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { createCanonicalCrmClient } from "./canonical-crm-client.js";

const serviceId = "sales1.fingerprint.services.service";
const previewId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const service = { name: "Revised transfer", expectedPricingRevision: 3, pricingCurrency: "CAD",
  items: [{ id: "sales1.fingerprint.services.service.items.line", description: "Ride", quantity: "2", unitPrice: "25.00" }] };
const meta = { contract_version: "v1", request_id: "synthetic-request", private: "hidden" };
const preview = { data: { preview_id: previewId, request_hash: "h".repeat(43), expires_at: "2030-01-01T00:00:00.000Z",
  confirmation_class: "reversible_write", operation: "service_update", resource_id: serviceId, resource_label: "Transfer",
  proposed_changes: { serviceName: "Revised transfer", lineItems: "2 × Ride — 25.00", totalAmount: "50.00", pricingCurrency: "CAD",
    notification: "No customer communication is configured for this service." }, side_effects: ["Update one service without changing its lifecycle status."],
  warnings: [], idempotency_key_format: "uuid", approval_path: `/dashboard/#/agent-approvals/${previewId}`, private: "hidden" }, meta };
const completed = { data: { service: { id: serviceId, name: "Revised transfer", status: "backlog", pricing_revision: 4,
  private_cost: "hidden" }, notification: { attempted: false, sent: false, reconciliation_required: false, private: "hidden" },
audit_reference: previewId, private: "hidden" }, meta };

void test("service update uses only the canonical OAuth routes and redacts response data", async () => {
  const request = mock.fn((url: string, init: RequestInit) => {
    assert.match(url, /^https:\/\/tenant\.example\/api\/agent\/services\/update-(?:preview|execute)\?api_version=v1$/u);
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer oauth-token");
    assert.equal(init.redirect, "error");
    assert.equal(typeof init.body, "string");
    if (typeof init.body !== "string") throw new Error("Expected JSON body");
    assert.deepEqual(JSON.parse(init.body) as unknown, url.includes("preview") ? { resource_id: serviceId, service }
      : { preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key });
    return Promise.resolve(Response.json(url.includes("preview") ? preview : completed));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  const prepared = await client.previewServiceUpdate({ resource_id: serviceId, service });
  const updated = await client.executeServiceUpdate({ preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key });
  assert.equal(prepared.status, 200);
  assert.equal(updated.status, 200);
  assert.doesNotMatch(JSON.stringify([prepared, updated]), /hidden|oauth-token|rrrrrrrr/u);
  assert.equal(request.mock.callCount(), 2);
});

void test("service update binds preview identity and never retries an ambiguous execution", async () => {
  const request = mock.fn((url: string) => Promise.resolve(Response.json(url.includes("preview")
    ? { ...preview, data: { ...preview.data, resource_id: "sales1.fingerprint.services.other" } }
    : { error: { code: "internal_error" } }, { status: url.includes("preview") ? 200 : 503 })));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  assert.equal((await client.previewServiceUpdate({ resource_id: serviceId, service })).status, 502);
  assert.deepEqual((await client.executeServiceUpdate({ preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key })).body,
    { error: { code: "execution_ambiguous" } });
  assert.equal(request.mock.callCount(), 2);
  assert.equal((await client.previewServiceUpdate({ resource_id: "/bad", service })).status, 400);
  assert.equal(request.mock.callCount(), 2);
});

void test("service update status only reads the stored original outcome", async () => {
  const request = mock.fn((url: string, init: RequestInit) => {
    assert.equal(new URL(url).pathname, "/api/agent/services/update-status");
    assert.equal(new URL(url).searchParams.get("preview_id"), previewId);
    assert.equal(new URL(url).searchParams.get("idempotency_key"), key);
    assert.equal(init.method, "GET");
    return Promise.resolve(Response.json({ data: { preview_id: previewId, state: "succeeded", retry_mutation: false,
      reconciliation_required: false, outcome: { status: 200, data: completed.data } }, meta }));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  const result = await client.serviceUpdateStatus({ preview_id: previewId, idempotency_key: key });
  assert.equal(result.status, 200);
  assert.doesNotMatch(JSON.stringify(result), /hidden/u);
  assert.equal(request.mock.callCount(), 1);
});
