import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";

const page = Object.freeze({ data: { items: [], total: 0 }, meta: { contract_version: "v1", next_cursor: null,
  source: { provider: "d1", view: "persisted", readCompletedAt: "2026-09-13T00:00:00.000Z", materialization: { performed: false, status: "not_evaluated" } },
  period: { kind: "calendar_dates", startDate: "2026-09-01", endDate: null, startInclusive: true, endInclusive: true },
} });
await test("expense transport reuses bounded canonical OAuth GET without provider routing", async () => {
  const request = mock.fn((url: string, init: RequestInit) => {
    assert.equal(new URL(url).pathname, "/api/agent/expenses");
    assert.deepEqual(Object.fromEntries(new URL(url).searchParams), { api_version: "v1", limit: "2", currency: "CAD", start_date: "2026-09-01" });
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer synthetic");
    assert.equal(init.redirect, "error");
    return Promise.resolve(Response.json(page));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("synthetic"), request });
  assert.equal((await client.list("expenses", { page_size: 2, currency: "CAD", start_date: "2026-09-01" })).status, 200);
  assert.equal(request.mock.callCount(), 1);
});
await Promise.all([{ fields: ["tenant_id"] }, { start_date: "2026-02-29" }, { date_field: "received_at" }].map((options, index) =>
  test(`invalid expense query fails before credentials ${String(index)}`, async () => {
    const token = mock.fn(() => Promise.resolve("synthetic"));
    const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token });
    assert.equal((await client.list("expenses", options)).status, 400);
    assert.equal(token.mock.callCount(), 0);
  })));
await test("expense transport preserves OAuth expiry and rejects missing metadata", async () => {
  const expired = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("synthetic"), request: () => Promise.resolve(Response.json({ error: "invalid_token" }, { status: 401 })) });
  assert.equal((await expired.list("expenses")).status, 401);
  const malformed = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("synthetic"), request: () => Promise.resolve(Response.json({ data: { items: [], total: 0 }, meta: { contract_version: "v1", next_cursor: null } })) });
  assert.equal((await malformed.list("expenses")).status, 502);
});
