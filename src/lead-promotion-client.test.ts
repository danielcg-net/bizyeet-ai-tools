import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";

const leadId = `crm1.${"a".repeat(64)}.leads.123`;
const customerId = `crm1.${"a".repeat(64)}.customers.456`;
const previewId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const approval = { preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key };
const envelope = (data: unknown): Readonly<Record<string, unknown>> => ({ data, meta: { contract_version: "v1", request_id: "synthetic" } });
const preview = { preview_id: previewId, request_hash: "h".repeat(43), expires_at: "2099-01-01T00:00:00.000Z",
  confirmation_class: "lifecycle_transition", operation: "leads.promote", resource_id: leadId,
  resource_label: "New customer", proposed_changes: { lead_id: leadId, customer_business: "New customer",
    customer_email: "new@example.invalid", lead_pipeline_stage: "Won" },
  side_effects: ["Create one customer, link lead and mark Won. No message is sent."], warnings: [],
  idempotency_key_format: "uuid", approval_path: `/dashboard/#/agent-approvals/${previewId}` };
const outcome = { resource: { id: customerId, business: "New customer", company: "New customer", contact_name: null,
  updated_at: "2026-09-28T00:00:00.000Z" }, audit_reference: previewId };

await test("promotion uses only separate canonical lifecycle endpoints and projects safe fields", async () => {
  const request = mock.fn((url: string, init: RequestInit): Promise<Response> => {
    const endpoint = new URL(url);
    assert.match(endpoint.pathname, /^\/api\/agent\/leads\/promotion-(preview|execute|status)$/u);
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer oauth-token");
    assert.equal(init.redirect, "error");
    if (endpoint.pathname.endsWith("preview")) {
      assert.equal(init.method, "POST");
      assert.equal(init.body, JSON.stringify({ record: { leadId } }));
      return Promise.resolve(Response.json(envelope({ ...preview, private_detail: "hidden" })));
    }
    if (endpoint.pathname.endsWith("execute")) {
      assert.equal(init.method, "POST");
      assert.equal(init.body, JSON.stringify(approval));
      return Promise.resolve(Response.json(envelope(outcome), { status: 201 }));
    }
    assert.equal(init.method, "GET");
    assert.equal(endpoint.searchParams.get("idempotency_key"), key);
    return Promise.resolve(Response.json(envelope({ preview_id: previewId, state: "succeeded", retry_mutation: false,
      reconciliation_required: false, outcome: { status: 201, data: outcome } })));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  const prepared = await client.previewLeadPromotion({ record: { leadId } });
  assert.equal(prepared.status, 200);
  assert.doesNotMatch(JSON.stringify(prepared.body), /private_detail/u);
  assert.equal((prepared.body as { data: { confirmation_class: string } }).data.confirmation_class, "lifecycle_transition");
  assert.equal((await client.executeLeadPromotion(approval)).status, 201);
  assert.equal((await client.leadPromotionStatus({ preview_id: previewId, idempotency_key: key })).status, 200);
  assert.equal(request.mock.callCount(), 3);
});

await test("promotion rejects unsupported input and fabricated preview effects before exposing them", async () => {
  const token = mock.fn(() => Promise.resolve("oauth-token"));
  const request = mock.fn(() => Promise.resolve(Response.json(envelope({ ...preview,
    proposed_changes: { ...preview.proposed_changes, existing_customer_id: customerId } }))));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token, request });
  assert.equal((await client.previewLeadPromotion({ record: { leadId: "bad/id" } })).status, 400);
  assert.equal(token.mock.callCount(), 0);
  assert.equal((await client.previewLeadPromotion({ record: { leadId } })).status, 502);
});

await test("uncertain promotion execution never retries or exposes provider details", async () => {
  const request = mock.fn(() => Promise.reject(new Error("private-provider-detail")));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  assert.deepEqual(await client.executeLeadPromotion(approval), { status: 503, body: { error: { code: "execution_ambiguous" } } });
  assert.equal(request.mock.callCount(), 1);
});
