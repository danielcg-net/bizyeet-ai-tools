import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";

const previewId = "11111111-1111-4111-8111-111111111111";
const query = { preview_id: previewId, idempotency_key: "22222222-2222-4222-8222-222222222222" };
const metadata = { contract_version: "v1", request_id: previewId };
const makeData = (overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> => ({
  preview_id: previewId, state: "pending", retry_mutation: false, reconciliation_required: false, outcome: null, ...overrides,
});
const getAccessToken = (): Promise<string> => Promise.resolve("synthetic-access");

await Promise.all([
  makeData(), makeData({ state: "unknown", reconciliation_required: true }),
  makeData({ state: "ambiguous", reconciliation_required: true, outcome: { status: 503, error: { code: "execution_ambiguous" } } }),
  makeData({ state: "failed", outcome: { status: 409, error: { code: "conflict" } } }),
  makeData({ state: "succeeded", outcome: { status: 200, data: { audit_reference: previewId, resource: { id: "opaque:customer", business: "Synthetic" } } } }),
].map((data) => test(`reads projected ${String(data.state)} outcome through exact GET endpoint`, async () => {
  const request = mock.fn((url: string, init: RequestInit) => {
    const target = new URL(url);
    assert.equal(target.origin, "https://tenant.example");
    assert.equal(target.pathname, "/api/agent/customers/update-status");
    assert.deepEqual(Object.fromEntries(target.searchParams), { api_version: "v1", ...query });
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
    return Promise.resolve(Response.json({ data: { ...data, approval_receipt: "must-not-leak" }, meta: { ...metadata, secret: "must-not-leak" } }));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken, request });
  const result = await client.customerUpdateStatus(query);
  assert.deepEqual(result, { status: 200, body: { data, meta: metadata } });
  assert.equal(request.mock.callCount(), 1);
})));

await Promise.all([
  makeData({ preview_id: crypto.randomUUID() }), makeData({ state: "executing" }), makeData({ retry_mutation: true }),
  makeData({ reconciliation_required: true }), makeData({ outcome: {} }),
  makeData({ state: "succeeded", outcome: null }),
  makeData({ state: "failed", outcome: { status: 200, error: { code: "conflict" } } }),
  makeData({ state: "ambiguous", reconciliation_required: true, outcome: { status: 503, error: { code: "private-diagnostic" } } }),
  makeData({ state: "succeeded", outcome: { status: 200, data: { audit_reference: previewId,
    resource: { id: "customer", email: "private@example.invalid" } } } }),
].map((data, index) => test(`rejects malformed status envelope ${String(index)}`, async () => {
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken,
    request: () => Promise.resolve(Response.json({ data, meta: metadata })) });
  assert.deepEqual(await client.customerUpdateStatus(query), { status: 502, body: { error: { code: "invalid_response" } } });
})));

await test("retries only a bounded GET transport failure without writing", async () => {
  const request = mock.fn((_url: string, init: RequestInit): Promise<Response> => {
    assert.equal(init.method, "GET");
    return Promise.reject(new Error("synthetic network error"));
  });
  const wait = mock.fn(() => Promise.resolve());
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken, request, wait });
  assert.deepEqual(await client.customerUpdateStatus(query), { status: 503, body: { error: { code: "request_unavailable" } } });
  assert.equal(request.mock.callCount(), 2);
  assert.equal(wait.mock.callCount(), 1);
});

await test("rejects invalid query UUIDs before acquiring credentials", async () => {
  const token = mock.fn(getAccessToken);
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token });
  assert.equal((await client.customerUpdateStatus({ ...query, preview_id: "invalid" })).status, 400);
  assert.equal((await client.customerUpdateStatus({ ...query, idempotency_key: "invalid" })).status, 400);
  assert.equal(token.mock.callCount(), 0);
});
