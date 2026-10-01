import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";

const empty = { data: { kind: "completed_services", items: [], totals: [], total: 0 }, meta: {
  contract_version: "v1", page: 1, page_size: 25, total_pages: 1, returned: 0,
  period: { range: "custom", timeZone: "America/Edmonton", start: "2026-01-01T07:00:00.000Z", end: "2026-02-01T07:00:00.000Z",
    startDate: "2026-01-01", endDate: "2026-01-31", endDateExclusive: "2026-02-01", todayDate: "2026-01-15",
    startInclusive: true, endInclusive: false },
  source: { provider: "d1", view: "completed_services", readCompletedAt: "2026-01-15T12:00:00.000Z" },
} };

void test("margin read makes one canonical OAuth GET with bounded evidence selection", async () => {
  const request = mock.fn((url: string, init: RequestInit) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/api/agent/reports/margin");
    assert.equal(parsed.searchParams.get("api_version"), "v1");
    assert.equal(parsed.searchParams.get("range"), "custom");
    assert.equal(parsed.searchParams.get("start_date"), "2026-01-01");
    assert.equal(parsed.searchParams.get("end_date"), "2026-01-31");
    assert.equal(parsed.searchParams.get("fields"), "actual_cost,source,currency,missing_cost_count,cost_basis,margin_amount,margin_percent");
    assert.equal(init.method, "GET");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer synthetic-oauth");
    assert.equal(init.redirect, "error");
    return Promise.resolve(Response.json(empty));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("synthetic-oauth"), request });
  const result = await client.marginReport({ range: "custom", start_date: "2026-01-01", end_date: "2026-01-31", fields: ["actual_cost"] });
  assert.equal(result.status, 200);
  assert.deepEqual((result.body as { data: unknown }).data, empty.data);
  assert.equal(request.mock.callCount(), 1);
});

void test("invalid margin request stops before OAuth and provider calls", async () => {
  const token = mock.fn((): Promise<string> => Promise.resolve("unexpected"));
  const request = mock.fn((): Promise<Response> => Promise.resolve(Response.json(empty)));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token, request });
  assert.equal((await client.marginReport({ range: "custom", start_date: "2026-02-30", end_date: "2026-03-01" })).status, 400);
  assert.equal(token.mock.callCount(), 0);
  assert.equal(request.mock.callCount(), 0);
});

void test("provider failure is not converted to an empty margin report", async () => {
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("synthetic-oauth"),
    request: () => Promise.resolve(Response.json({ error: { code: "crm_operation_unsupported" } }, { status: 422 })) });
  assert.deepEqual(await client.marginReport(), { status: 422, body: { error: { code: "crm_operation_unsupported" } } });
});
