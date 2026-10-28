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

await test("record-create status does not return unprojected non-OK error details", async () => {
  const request = mock.fn(() => Promise.resolve(Response.json({error: {code: "conflict", message: "SYNTHETIC_UNSAFE_DETAIL", details: {value: "SYNTHETIC_UNSAFE_DETAIL"}}, extra: "SYNTHETIC_UNSAFE_DETAIL"}, {status: 409})));
  const client = createCanonicalCrmClient({origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request});
  const result = await client.customerCreateStatus({preview_id: id, idempotency_key: key});
  assert.equal(result.status, 409);
  assert.doesNotMatch(JSON.stringify(result.body), /SYNTHETIC_UNSAFE_DETAIL/u);
  assert.equal(request.mock.callCount(), 1);
});

await Promise.all((["customers", "leads", "promotion"] as const).map((kind) => test(`${kind} status preserves safe error semantics and never repeats an HTTP denial`, async () => {
  await [
    {status: 302, code: "invalid_response", safe: "invalid_response", retryable: false},
    {status: 400, code: "invalid_request", safe: "invalid_request", retryable: false},
    {status: 401, code: "authorization_required", safe: "authorization_required", retryable: false},
    {status: 403, code: "authorization_denied", safe: "authorization_denied", retryable: false},
    {status: 404, code: "not_found", safe: "not_found", retryable: false},
    {status: 410, code: "preview_expired", safe: "preview_expired", retryable: false},
    {status: 403, code: "approval_required", safe: "approval_required", retryable: false},
    {status: 409, code: "idempotency_conflict", safe: "idempotency_conflict", retryable: false},
    {status: 409, code: "conflict", safe: "conflict", retryable: false},
    {status: 422, code: "crm_operation_unsupported", safe: "unsupported_operation", retryable: false},
    {status: 503, code: "provider_unavailable", safe: "provider_unavailable", retryable: true},
    {status: 429, code: "rate_limited", safe: "rate_limited", retryable: true},
    {status: 503, code: "execution_ambiguous", safe: "execution_ambiguous", retryable: false},
    {status: 409, code: "execution_in_progress", safe: "execution_in_progress", retryable: false},
    {status: 500, code: "SYNTHETIC_UNSAFE_DETAIL", safe: "internal_error", retryable: true},
  ].reduce(async (previous, scenario): Promise<void> => {
    await previous;
    const request = mock.fn((url: string, init: RequestInit): Promise<Response> => {
      const endpoint = new URL(url);
      assert.equal(endpoint.pathname, `/api/agent/${kind === "promotion" ? "leads/promotion" : `${kind}/create`}-status`);
      assert.equal(endpoint.searchParams.get("preview_id"), id);
      assert.equal(endpoint.searchParams.get("idempotency_key"), key);
      assert.equal(init.method, "GET");
      assert.equal(init.body, undefined);
      return Promise.resolve(Response.json({error: {code: scenario.code, request_id: "synthetic-correlation",
        retryable: scenario.retryable || scenario.safe.startsWith("execution_"),
        message: "SYNTHETIC_UNSAFE_DETAIL", details: {value: "SYNTHETIC_UNSAFE_DETAIL"}},
      meta: {value: "SYNTHETIC_UNSAFE_DETAIL"}}, {status: scenario.status}));
    });
    const client = createCanonicalCrmClient({origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request});
    const query = {preview_id: id, idempotency_key: key};
    const result = await (kind === "customers" ? client.customerCreateStatus(query) : kind === "leads" ? client.leadCreateStatus(query) : client.leadPromotionStatus(query));
    assert.deepEqual(result, {status: scenario.status, body: {error: {code: scenario.safe,
      request_id: "synthetic-correlation", retryable: scenario.retryable}}});
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_UNSAFE_DETAIL|oauth-token/u);
    assert.equal(request.mock.callCount(), 1);
  }, Promise.resolve());
})));

await test("status error correlation remains bounded and rejects unsafe references", async () => {
  const request = mock.fn(() => Promise.resolve(Response.json({error: {code: "conflict",
    request_id: "SYNTHETIC_UNSAFE_DETAIL\n", message: "SYNTHETIC_UNSAFE_DETAIL"}}, {status: 409})));
  const client = createCanonicalCrmClient({origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request});
  const result = await client.customerCreateStatus({preview_id: id, idempotency_key: key});
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_UNSAFE_DETAIL/u);
  assert.match((result.body as {error: {request_id: string}}).error.request_id, /^[0-9a-f-]{36}$/u);
});

await Promise.all((["customers", "leads", "promotion"] as const).flatMap((kind) => (["preview", "execute"] as const).map((operation) => test(`${kind} ${operation} projects HTTP errors without replaying a mutation POST`, async () => {
  await [
    {status: 400, code: "invalid_request", safe: "invalid_request"},
    {status: 401, code: "authorization_required", safe: "authorization_required"},
    {status: 403, code: "approval_required", safe: "approval_required"},
    {status: 409, code: "conflict", safe: "conflict"},
    {status: 410, code: "preview_expired", safe: "preview_expired"},
    {status: 422, code: "crm_operation_unsupported", safe: "unsupported_operation"},
    {status: 429, code: "rate_limited", safe: "rate_limited"},
    {status: 500, code: "SYNTHETIC_UNSAFE_DETAIL", safe: "internal_error"},
    {status: 503, code: "provider_unavailable", safe: "provider_unavailable"},
  ].reduce(async (previous, scenario): Promise<void> => {
    await previous;
    const proposal = kind === "promotion" ? {record: {leadId: `crm1.${"a".repeat(64)}.leads.123`}} : {record: {business: "New record", email: "new@example.invalid"}};
    const request = mock.fn((url: string, init: RequestInit): Promise<Response> => {
      assert.equal(new URL(url).pathname, `/api/agent/${kind === "promotion" ? "leads/promotion" : `${kind}/create`}-${operation}`);
      assert.equal(init.method, "POST");
      assert.equal(init.body, JSON.stringify(operation === "preview" ? proposal : approval));
      return Promise.resolve(Response.json({error: {code: scenario.code, request_id: "synthetic-correlation",
        retryable: false, message: "SYNTHETIC_UNSAFE_DETAIL", details: {value: "SYNTHETIC_UNSAFE_DETAIL"}},
      extra: "SYNTHETIC_UNSAFE_DETAIL"}, {status: scenario.status}));
    });
    const token = mock.fn(() => Promise.resolve("oauth-token"));
    const client = createCanonicalCrmClient({origin: "https://tenant.example", getAccessToken: token, request});
    const result = operation === "preview"
      ? await (kind === "customers" ? client.previewCustomerCreate(proposal) : kind === "leads" ? client.previewLeadCreate(proposal) : client.previewLeadPromotion(proposal as {record: {leadId: string}}))
      : await (kind === "customers" ? client.executeCustomerCreate(approval) : kind === "leads" ? client.executeLeadCreate(approval) : client.executeLeadPromotion(approval));
    const expected = operation === "execute" && scenario.status >= 500
      ? {code: "execution_ambiguous"} : {code: scenario.safe, request_id: "synthetic-correlation", retryable: false};
    assert.deepEqual(result, {status: scenario.status, body: {error: expected}});
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_UNSAFE_DETAIL|oauth-token/u);
    assert.equal(request.mock.callCount(), 1);
    assert.equal(token.mock.callCount(), 1);
  }, Promise.resolve());
}))));
