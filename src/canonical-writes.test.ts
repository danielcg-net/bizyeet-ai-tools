import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";
import { agentFailure, agentFailureMessage } from "./agent-error.js";

const id = "11111111-1111-4111-8111-111111111111";
const resourceId = `crm1.${"a".repeat(64)}.customers.123`;
const approval = { preview_id: id, approval_receipt: "r".repeat(43), idempotency_key: "22222222-2222-4222-8222-222222222222" };
const proposal = { resource_id: resourceId, changes: { business: "Proposed name" } };
const preview = { preview_id: id, request_hash: "b".repeat(41) + "-_", expires_at: "2099-01-01T00:00:00.000Z", confirmation_class: "reversible_write",
  resource_id: resourceId, proposed_changes: proposal.changes, side_effects: ["Update customer"], warnings: [], idempotency_key_format: "uuid", approval_path: `/dashboard/#/agent-approvals/${id}` };
const envelope = (data: unknown): Readonly<Record<string, unknown>> => ({ data, meta: { contract_version: "v1", request_id: "req_write_abc" } });
const token = (): Promise<string> => Promise.resolve("oauth-access");

await test("preview uses one canonical POST and projects only documented response fields", async () => {
  const request = mock.fn((url: string, init: RequestInit): Promise<Response> => {
    assert.equal(url, "https://tenant.example/api/agent/customers/update-preview?api_version=v1");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    assert.equal(init.body, JSON.stringify(proposal));
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer oauth-access");
    return Promise.resolve(Response.json(envelope({ ...preview, approval_receipt: "must-not-leak" })));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token, request });
  assert.deepEqual(await client.previewCustomerUpdate(proposal), { status: 200, body: envelope(preview) });
  assert.equal(request.mock.callCount(), 1);
});

await test("execution preserves exact receipt and idempotency key without reflecting receipt", async () => {
  const data = { resource: { id: resourceId, business: "Updated" }, audit_reference: id };
  const request = mock.fn((url: string, init: RequestInit): Promise<Response> => {
    assert.equal(url, "https://tenant.example/api/agent/customers/update-execute?api_version=v1");
    assert.equal(init.body, JSON.stringify(approval));
    return Promise.resolve(Response.json(envelope({ ...data, approval_receipt: approval.approval_receipt })));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token, request });
  assert.deepEqual(await client.executeCustomerUpdate(approval), { status: 200, body: envelope(data) });
  assert.equal(request.mock.callCount(), 1);
});

await test("rejects a structurally valid preview for a different customer", async () => {
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token,
    request: () => Promise.resolve(Response.json(envelope({ ...preview, resource_id: "other-customer" }))) });
  assert.deepEqual(await client.previewCustomerUpdate(proposal), { status: 502, body: { error: { code: "invalid_response" } } });
});

await Promise.all(["network", "malformed", "private-field", "oversized", "nested"].map((scenario) => test(`execution ${scenario} fails ambiguous without retry`, async () => {
  const request = mock.fn((): Promise<Response> => scenario === "network" ? Promise.reject(new Error(approval.approval_receipt))
    : Promise.resolve(Response.json(scenario === "malformed" ? {}
      : scenario === "oversized" ? envelope({ resource: { id: resourceId, business: "x".repeat(32_768) }, audit_reference: id })
      : scenario === "nested" ? envelope({ resource: { id: resourceId, business: { private: "hidden" } }, audit_reference: id })
      : envelope({ resource: { id: resourceId, email: "private" }, audit_reference: id }))));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token, request });
  const result = await client.executeCustomerUpdate(approval);
  const failure = agentFailure(result.status, result.body);
  assert.equal(failure.code, "execution_ambiguous");
  assert.equal(failure.retryable, false);
  assert.match(agentFailureMessage(failure), /Do not retry/u);
  assert.equal(request.mock.callCount(), 1);
  assert.doesNotMatch(JSON.stringify(result), /private|rrrrrrrr/u);
})));

await test("rejects receipt, route, extra-field and byte-bound violations before credentials", async () => {
  const getAccessToken = mock.fn(token);
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken });
  assert.equal((await client.executeCustomerUpdate({ ...approval, approval_receipt: "invalid" })).status, 400);
  assert.equal((await client.previewCustomerUpdate({ ...proposal, resource_id: "../me" })).status, 400);
  assert.equal((await client.previewCustomerUpdate({ ...proposal, changes: { business: "é".repeat(9000) } })).status, 400);
  const extra = { ...approval, tenant_id: "other" };
  assert.equal((await client.executeCustomerUpdate(extra)).status, 400);
  assert.equal(getAccessToken.mock.callCount(), 0);
});

await Promise.all([401, 403, 409, 503].map((status) => test(`never retries execution HTTP ${String(status)}`, async () => {
  const request = mock.fn((): Promise<Response> => Promise.resolve(Response.json({ error: { code: "execution_in_progress" } }, { status })));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token, request });
  assert.equal((await client.executeCustomerUpdate(approval)).status, status);
  assert.equal(request.mock.callCount(), 1);
})));
