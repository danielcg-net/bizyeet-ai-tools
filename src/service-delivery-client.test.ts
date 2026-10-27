import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { createCanonicalCrmClient } from "./canonical-crm-client.js";

const serviceId = "sales1.fingerprint.services.service";
const previewId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const meta = { contract_version: "v1", request_id: "synthetic-request", private: "hidden" };
const preview = { data: { preview_id: previewId, request_hash: "h".repeat(43), expires_at: "2030-01-01T00:00:00.000Z",
  confirmation_class: "lifecycle_transition", operation: "service_deliver", resource_id: serviceId, resource_label: "Transfer",
  proposed_changes: { serviceName: "Transfer", lifecycleAction: "Mark service delivered", notification: "May send an automatic email." },
  side_effects: ["Mark one service delivered."], warnings: ["Cannot be undone by the agent."], idempotency_key_format: "uuid",
  approval_path: `/dashboard/#/agent-approvals/${previewId}`, private: "hidden" }, meta };
const completed = { data: { service: { id: serviceId, name: "Transfer", status: "delivered", private_cost: "hidden" },
  already_delivered: false, notification: { attempted: true, sent: true, reconciliation_required: false, private: "hidden" },
  audit_reference: previewId, private: "hidden" }, meta };

void test("service delivery uses canonical OAuth preview, execute, and read-only status routes", async () => {
  const request = mock.fn((url: string, init: RequestInit) => {
    assert.match(url, /^https:\/\/tenant\.example\/api\/agent\/services\/deliver-(?:preview|execute|status)/u);
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer oauth-token");
    assert.equal(init.redirect, "error");
    if (url.includes("-status")) {
      assert.equal(init.method, "GET");
      return Promise.resolve(Response.json({ data: { preview_id: previewId, state: "succeeded", retry_mutation: false,
        reconciliation_required: false, outcome: { status: 200, data: completed.data } }, meta }));
    }
    assert.equal(init.method, "POST");
    assert.equal(typeof init.body, "string");
    if (typeof init.body !== "string") throw new Error("Expected JSON body");
    assert.deepEqual(JSON.parse(init.body) as unknown, url.includes("-preview")
      ? { resource_id: serviceId }
      : { preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key });
    return Promise.resolve(Response.json(url.includes("-preview") ? preview : completed));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  const prepared = await client.previewServiceDelivery({ resource_id: serviceId });
  const executed = await client.executeServiceDelivery({ preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key });
  const observed = await client.serviceDeliveryStatus({ preview_id: previewId, idempotency_key: key });
  assert.equal(prepared.status, 200);
  assert.equal(executed.status, 200);
  assert.equal(observed.status, 200);
  assert.equal(request.mock.callCount(), 3);
  assert.doesNotMatch(JSON.stringify([prepared, executed, observed]), /hidden|oauth-token|rrrrrrrr/u);
  assert.deepEqual((executed.body as { data: { already_delivered: boolean } }).data.already_delivered, false);
});

void test("delivery rejects unrelated fields and mismatched server previews", async () => {
  const request = mock.fn(() => Promise.resolve(Response.json({ ...preview, data: { ...preview.data, resource_id: "sales1.fingerprint.services.other" } })));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  assert.equal((await client.previewServiceDelivery({ resource_id: serviceId, status: "delivered" } as { resource_id: string })).status, 400);
  assert.equal(request.mock.callCount(), 0);
  assert.equal((await client.previewServiceDelivery({ resource_id: serviceId })).status, 502);
  assert.equal(request.mock.callCount(), 1);
});

void test("delivery maps uncertain execution to reconciliation, never a retry", async () => {
  const request = mock.fn(() => Promise.resolve(Response.json({ error: { code: "internal_error" } }, { status: 503 })));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  assert.deepEqual((await client.executeServiceDelivery({ preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key })).body,
    { error: { code: "execution_ambiguous" } });
  assert.equal(request.mock.callCount(), 1);
});
