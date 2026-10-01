import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";

const previewId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const customerId = "sales1.fingerprint.customers.customer";
const serviceId = "sales1.fingerprint.services.service";
const proposal = { customerId, name: "Airport transfer", description: "Pickup", durationMinutes: 45,
  items: [{ description: "Ride", quantity: "2", unitPrice: "25.00" }] };
const meta = { contract_version: "v1", request_id: "synthetic-request", private: "hidden" };
const preview = { data: { preview_id: previewId, request_hash: "h".repeat(43), expires_at: "2030-01-01T00:00:00.000Z",
  confirmation_class: "lifecycle_transition", operation: "service_create", resource_id: customerId, resource_label: "Customer",
  proposed_changes: { serviceName: "Airport transfer", description: "Pickup", lineItems: "2 × Ride — 25.00",
    grossAmount: "50.00", discountAmount: "0.00", totalAmount: "50.00", discountTerms: "", pricingCurrency: "CAD",
    status: "backlog", durationMinutes: 45, customerDocuments: "", notification: "No customer communication is configured for this service." },
  side_effects: ["Create one backlog service for this customer.", "No customer communication is configured for this service."],
  warnings: [], idempotency_key_format: "uuid", approval_path: "/dashboard/#/agent-approvals/" + previewId, private: "hidden" }, meta };
const completed = { data: { service: { id: serviceId, name: "Airport transfer", status: "backlog", amount: "50.00",
  private_cost: "hidden" }, notification: { attempted: false, sent: false, reconciliation_required: false, private: "hidden" },
  audit_reference: previewId, private: "hidden" }, meta };

void test("service create sends only a bounded canonical proposal and redacts its preview/outcome", async () => {
  const request = mock.fn((url: string, init: RequestInit) => {
    assert.match(url, /^https:\/\/tenant\.example\/api\/agent\/services\/create-(?:preview|execute)\?api_version=v1$/u);
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer oauth-token");
    assert.equal(init.redirect, "error");
    assert.equal(typeof init.body, "string");
    if (typeof init.body !== "string") throw new Error("Expected JSON body");
    assert.deepEqual(JSON.parse(init.body) as unknown, url.includes("preview") ? { service: proposal }
      : { preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key });
    return Promise.resolve(Response.json(url.includes("preview") ? preview : completed, { status: url.includes("preview") ? 200 : 201 }));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  const prepared = await client.previewServiceCreate({ service: proposal });
  const created = await client.executeServiceCreate({ preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key });
  assert.equal(prepared.status, 200);
  assert.equal(created.status, 201);
  assert.deepEqual((created.body as { data: { service: unknown } }).data.service,
    { id: serviceId, name: "Airport transfer", status: "backlog", amount: "50.00" });
  assert.doesNotMatch(JSON.stringify([prepared, created]), /hidden|oauth-token|rrrrrrrr/u);
  assert.equal(request.mock.callCount(), 2);
});

void test("service creation rejects malformed preview and never retries ambiguous execution", async () => {
  const request = mock.fn((url: string) => Promise.resolve(Response.json(url.includes("preview")
    ? { ...preview, data: { ...preview.data, operation: "quote_create" } }
    : { error: { code: "internal_error" } }, { status: url.includes("preview") ? 200 : 503 })));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  assert.equal((await client.previewServiceCreate({ service: proposal })).status, 502);
  assert.deepEqual((await client.executeServiceCreate({ preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key })).body,
    { error: { code: "execution_ambiguous" } });
  assert.equal(request.mock.callCount(), 2);
});

void test("service-create preview binds the approved customer to the requested canonical customer", async () => {
  const request = mock.fn(() => Promise.resolve(Response.json({ ...preview,
    data: { ...preview.data, resource_id: "sales1.fingerprint.customers.other" } })));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  assert.equal((await client.previewServiceCreate({ service: proposal })).status, 502);
  assert.equal(request.mock.callCount(), 1);
  const invalid = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => { throw new Error("unexpected authentication"); } });
  assert.equal((await invalid.previewServiceCreate({ service: { ...proposal, customerId: "/bad" } })).status, 400);
});

void test("service-create preview rejects a non-string request hash before displaying approval details", async () => {
  const request = mock.fn(() => Promise.resolve(Response.json({ ...preview,
    data: { ...preview.data, request_hash: ["h".repeat(43)] } })));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  assert.equal((await client.previewServiceCreate({ service: proposal })).status, 502);
});

void test("service-create status reconciles one outcome through a read-only request", async () => {
  const request = mock.fn((url: string, init: RequestInit) => {
    assert.equal(new URL(url).pathname, "/api/agent/services/create-status");
    assert.equal(new URL(url).searchParams.get("preview_id"), previewId);
    assert.equal(new URL(url).searchParams.get("idempotency_key"), key);
    assert.equal(init.method, "GET");
    return Promise.resolve(Response.json({ data: { preview_id: previewId, state: "succeeded", retry_mutation: false,
      reconciliation_required: false, outcome: { status: 201, data: completed.data } }, meta }));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  const result = await client.serviceCreateStatus({ preview_id: previewId, idempotency_key: key });
  assert.equal(result.status, 200);
  assert.doesNotMatch(JSON.stringify(result), /hidden/u);
  assert.equal(request.mock.callCount(), 1);
});

await Promise.all(["scheduled", undefined].map((status) => test("service creation rejects non-backlog success: " + String(status), async () => {
  const response = { ...completed, data: { ...completed.data, service: { ...completed.data.service, status } } };
  const request = mock.fn((url: string) => Promise.resolve(Response.json(url.includes("-status")
    ? { data: { preview_id: previewId, state: "succeeded", retry_mutation: false,
      reconciliation_required: false, outcome: { status: 201, data: response.data } }, meta }
    : response, { status: url.includes("-status") ? 200 : 201 })));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  assert.deepEqual((await client.executeServiceCreate({ preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key })).body,
    { error: { code: "execution_ambiguous" } });
  assert.equal((await client.serviceCreateStatus({ preview_id: previewId, idempotency_key: key })).status, 502);
})));
