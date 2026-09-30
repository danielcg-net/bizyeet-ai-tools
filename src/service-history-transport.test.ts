import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";

const page = { data: { items: [{ from_status: "backlog", to_status: "delivered", created_at: "2026-09-01T00:00:00.000Z" }], total: 1 },
  meta: { contract_version: "v1", next_cursor: null } };

void test("service history transport stays on the canonical OAuth endpoint", async () => {
  const request = mock.fn((address: string, init: RequestInit) => {
    const url = new URL(address);
    assert.equal(url.origin, "https://tenant.example");
    assert.equal(url.pathname, "/api/agent/services/opaque-service/history");
    assert.deepEqual(Object.fromEntries(url.searchParams), { api_version: "v1", limit: "5", cursor: "opaque-cursor" });
    assert.equal(init.method, "GET");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer synthetic-token");
    return Promise.resolve(Response.json(page));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("synthetic-token"), request });
  const result = await client.serviceHistory("opaque-service", { limit: 5, cursor: "opaque-cursor" });
  assert.equal(result.status, 200);
  assert.deepEqual((result.body as { readonly data: unknown }).data, page.data);
  assert.match((result.body as { readonly meta: { readonly request_id: string } }).meta.request_id, /^[a-f0-9-]{36}$/u);
  assert.equal(request.mock.callCount(), 1);
});

void test("service history transport rejects bad options before credentials", async () => {
  const getAccessToken = mock.fn(() => Promise.resolve("synthetic-token"));
  const request = mock.fn(() => Promise.resolve(Response.json(page)));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken, request });
  assert.equal((await client.serviceHistory("opaque-service", { limit: 101 })).status, 400);
  assert.equal(getAccessToken.mock.callCount(), 0);
  assert.equal(request.mock.callCount(), 0);
});
