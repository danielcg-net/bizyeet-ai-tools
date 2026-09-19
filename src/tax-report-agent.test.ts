import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";
import { readTaxReport } from "./agent-client.js";

const profile = Object.freeze({ issuer: "https://example.test", clientId: "public-client" });
const credentials = Object.freeze({ profile, accessToken: "old-access", refreshToken: "old-refresh", scope: "reports.read", expiresAt: "2099-01-01T00:00:00Z" });
const envelope = Object.freeze({ data: { items: [], totals: [], total: 0 }, meta: {
  contract_version: "v1", page: 1, page_size: 25, total_pages: 1, returned: 0, filing_ready: false,
  period: { range: "today", timeZone: "UTC", start: "2026-01-15T00:00:00.000Z", end: "2026-01-16T00:00:00.000Z",
    startDate: "2026-01-15", endDate: "2026-01-15", endDateExclusive: "2026-01-16", todayDate: "2026-01-15", startInclusive: true, endInclusive: false },
  source: { provider: "d1", view: "immutable_tax_ledger", readCompletedAt: "2026-01-15T12:00:00.000Z" },
} });

void test("tax query validation runs before credentials are requested", async () => {
  const getAccessToken = mock.fn((): Promise<string> => Promise.resolve("token"));
  const client = createCanonicalCrmClient({ origin: profile.issuer, getAccessToken });
  assert.equal((await client.taxReport({ range: "custom", start_date: "2026-02-30", end_date: "2026-03-01" })).status, 400);
  assert.equal(getAccessToken.mock.callCount(), 0);
});

void test("requests filter evidence even when the user selects only private reason", async () => {
  const request = mock.fn((url: string): Promise<Response> => {
    assert.equal(new URL(url).searchParams.get("fields"), "reason,currency,authority,entry_type,province,received_at");
    return Promise.resolve(Response.json(envelope));
  });
  const client = createCanonicalCrmClient({ origin: profile.issuer, getAccessToken: (): Promise<string> => Promise.resolve("token"), request });
  assert.equal((await client.taxReport({ range: "today", fields: ["reason"], currency: "CAD", authority: "GST_HST", entry_type: "collected", province: "AB" })).status, 200);
  assert.equal(request.mock.callCount(), 1);
});

void test("requests currency evidence when a private projection omits it", async () => {
  const request = mock.fn((url: string): Promise<Response> => {
    assert.equal(new URL(url).searchParams.get("fields"), "reason,currency,received_at");
    return Promise.resolve(Response.json(envelope));
  });
  const client = createCanonicalCrmClient({ origin: profile.issuer, getAccessToken: (): Promise<string> => Promise.resolve("token"), request });
  assert.equal((await client.taxReport({ range: "today", fields: ["reason"] })).status, 200);
  assert.equal(request.mock.callCount(), 1);
});

await Promise.all([false, true].map((revoked) => test(`tax read preserves shared OAuth refresh behavior revoked=${String(revoked)}`, async () => {
  const persistCredentials = mock.fn((): Promise<void> => Promise.resolve());
  const fetcher = mock.fn((url: string, init?: RequestInit): Promise<Response> => {
    if (url.endsWith("/token")) return Promise.resolve(revoked ? Response.json({ error: "invalid_grant" }, { status: 400 })
      : Response.json({ access_token: "new-access", refresh_token: "new-refresh", token_type: "Bearer", expires_in: 300 }));
    assert.equal(new URL(url).pathname, "/api/agent/reports/taxes");
    assert.deepEqual(Object.fromEntries(new URL(url).searchParams), { api_version: "v1", range: "today", fields: "amount_minor,currency,received_at" });
    assert.equal(init?.method, "GET");
    assert.equal(init.redirect, "error");
    if (new Headers(init.headers).get("Authorization") === "Bearer old-access") return Promise.resolve(Response.json({ error: "invalid_token" }, { status: 401 }));
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer new-access");
    assert.equal(persistCredentials.mock.callCount(), 1);
    return Promise.resolve(Response.json(envelope));
  });
  const result = readTaxReport({ credentials, profile, metadata: { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token" },
    now: (): number => 1000, fetcher, persistCredentials, options: { range: "today", fields: ["amount_minor", "currency"] } });
  if (revoked) await assert.rejects(result, /OAuth refresh/u);
  else assert.deepEqual(((await result).response as Readonly<{ data: unknown }>).data, envelope.data);
  assert.equal(fetcher.mock.callCount(), revoked ? 2 : 3);
  assert.equal(persistCredentials.mock.callCount(), revoked ? 0 : 1);
})));

void test("mismatched tax period fails closed instead of returning financial data", async () => {
  const client = createCanonicalCrmClient({ origin: profile.issuer, getAccessToken: (): Promise<string> => Promise.resolve("token"),
    request: (): Promise<Response> => Promise.resolve(Response.json(envelope)) });
  assert.equal((await client.taxReport({ range: "last_month" })).status, 502);
});
