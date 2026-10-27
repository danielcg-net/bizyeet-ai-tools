import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { createCanonicalCrmClient } from "./canonical-crm-client.js";

const serviceId = "sales1.fingerprint.services.service";
const previewId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const meta = { contract_version: "v1", request_id: "synthetic-request", secret: "hidden" };
const preview = { data: { preview_id: previewId, request_hash: "h".repeat(43), expires_at: "2030-01-01T00:00:00.000Z",
  confirmation_class: "lifecycle_transition", operation: "service_transition", resource_id: serviceId, resource_label: "Transfer",
  proposed_changes: { serviceName: "Transfer", status: "in_progress", notification: "May send a tenant-configured email." },
  side_effects: ["Change one service lifecycle status."], warnings: ["Delivery is separate."], idempotency_key_format: "uuid",
  approval_path: `/dashboard/#/agent-approvals/${previewId}`, secret: "hidden" }, meta };
const completed = { data: { service: { id: serviceId, name: "Transfer", status: "in_progress", private_cost: "hidden" },
  notification: { attempted: false, sent: false, reconciliation_required: false, private: "hidden" },
  audit_reference: previewId, secret: "hidden" }, meta };

void test("service transition uses the canonical OAuth routes and projects only public fields", async () => {
  const request = mock.fn((url: string, init: RequestInit) => {
    assert.match(url, /^https:\/\/tenant\.example\/api\/agent\/services\/transition-(?:preview|execute|status)/u);
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
      ? { resource_id: serviceId, status: "in_progress" }
      : { preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key });
    return Promise.resolve(Response.json(url.includes("-preview") ? preview : completed));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  const prepared = await client.previewServiceTransition({ resource_id: serviceId, status: "in_progress" });
  const executed = await client.executeServiceTransition({ preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key });
  const observed = await client.serviceTransitionStatus({ preview_id: previewId, idempotency_key: key });
  assert.equal(prepared.status, 200);
  assert.equal(executed.status, 200);
  assert.equal(observed.status, 200);
  assert.equal(request.mock.callCount(), 3);
  assert.doesNotMatch(JSON.stringify([prepared, executed, observed]), /hidden|oauth-token|rrrrrrrr/u);
});

void test("transition rejects delivery and mismatched previews before or after transport", async () => {
  const request = mock.fn(() => Promise.resolve(Response.json({ ...preview, data: { ...preview.data, resource_id: "sales1.fingerprint.services.other" } })));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  assert.equal((await client.previewServiceTransition({ resource_id: serviceId, status: "delivered" as "in_progress" })).status, 400);
  assert.equal(request.mock.callCount(), 0);
  assert.equal((await client.previewServiceTransition({ resource_id: serviceId, status: "in_progress" })).status, 502);
  assert.equal(request.mock.callCount(), 1);
});

void test("transition never retries an ambiguous lifecycle effect", async () => {
  const request = mock.fn(() => Promise.resolve(Response.json({ error: { code: "internal_error" } }, { status: 503 })));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  assert.deepEqual((await client.executeServiceTransition({ preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key })).body,
    { error: { code: "execution_ambiguous" } });
  assert.equal(request.mock.callCount(), 1);
});
