import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";

const id = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const receipt = "r".repeat(43);
const envelope = (data: unknown): Readonly<Record<string, unknown>> => ({ data, meta: { contract_version: "v1", request_id: "synthetic" } });
const preview = (kind: "customers" | "leads"): Readonly<Record<string, unknown>> => ({ preview_id: id, request_hash: "h".repeat(43),
  expires_at: "2099-01-01T00:00:00.000Z", confirmation_class: "reversible_write", operation: `${kind}.create`,
  resource_id: "new@example.invalid", resource_label: "New record", proposed_changes: { business: "New record", email: "new@example.invalid" },
  side_effects: ["Create one record"], warnings: [], idempotency_key_format: "uuid",
  approval_path: `/dashboard/#/agent-approvals/${id}` });
const outcome = (kind: "customers" | "leads"): Readonly<Record<string, unknown>> => ({ resource: {
  id: `crm1.${"a".repeat(64)}.${kind}.123`, business: "New record", company: "New record", contact_name: null,
  updated_at: "2026-09-28T00:00:00.000Z", ...(kind === "leads" ? { pipeline_stage: "New Lead" } : {}),
}, audit_reference: id });
const proposal = { record: { business: "New record", email: "new@example.invalid" } };
const approval = { preview_id: id, approval_receipt: receipt, idempotency_key: key };

await Promise.all((["customers", "leads"] as const).map((kind) => test(`${kind} create uses only canonical preview/execute/status endpoints`, async () => {
  const request = mock.fn((url: string, init: RequestInit): Promise<Response> => {
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer oauth-token");
    assert.equal(init.redirect, "error");
    const endpoint = new URL(url);
    assert.ok(endpoint.pathname.startsWith(`/api/agent/${kind}/create-`));
    if (endpoint.pathname.endsWith("preview")) {
      assert.equal(init.method, "POST");
      assert.equal(init.body, JSON.stringify(proposal));
      return Promise.resolve(Response.json(envelope(preview(kind))));
    }
    if (endpoint.pathname.endsWith("execute")) {
      assert.equal(init.method, "POST");
      assert.equal(init.body, JSON.stringify(approval));
      return Promise.resolve(Response.json(envelope(outcome(kind)), { status: 201 }));
    }
    assert.equal(init.method, "GET");
    assert.equal(endpoint.searchParams.get("idempotency_key"), key);
    return Promise.resolve(Response.json(envelope({ preview_id: id, state: "succeeded", retry_mutation: false,
      reconciliation_required: false, outcome: { status: 201, data: outcome(kind) } })));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  const prepared = kind === "customers" ? await client.previewCustomerCreate(proposal) : await client.previewLeadCreate(proposal);
  const created = kind === "customers" ? await client.executeCustomerCreate(approval) : await client.executeLeadCreate(approval);
  const status = kind === "customers" ? await client.customerCreateStatus({ preview_id: id, idempotency_key: key })
    : await client.leadCreateStatus({ preview_id: id, idempotency_key: key });
  assert.equal(prepared.status, 200);
  assert.equal(created.status, 201);
  assert.equal(status.status, 200);
  assert.equal(request.mock.callCount(), 3);
})));

await test("create input is bounded and rejects private fields before token access", async () => {
  const token = mock.fn(() => Promise.resolve("oauth-token"));
  const request = mock.fn(() => Promise.resolve(Response.json(envelope(preview("customers")))));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token, request });
  await Promise.all([{ business: "New", email: "new@example.invalid", provider_payload: "secret" },
    { business: "New", email: "" }, { business: "New", email: "new@example.invalid", notes: "x".repeat(17000) }]
    .map(async (record): Promise<void> => {
      assert.deepEqual(await client.previewCustomerCreate({ record }), { status: 400, body: { error: { code: "invalid_request" } } });
    }));
  assert.equal(token.mock.callCount(), 0);
  assert.equal(request.mock.callCount(), 0);
});

await test("uncertain create execution never retries or exposes private provider details", async () => {
  const request = mock.fn(() => Promise.reject(new Error("private-provider-detail")));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  assert.deepEqual(await client.executeLeadCreate(approval), { status: 503, body: { error: { code: "execution_ambiguous" } } });
  assert.equal(request.mock.callCount(), 1);
});
