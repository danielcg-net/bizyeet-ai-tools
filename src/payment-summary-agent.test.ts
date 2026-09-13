import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { receivedPaymentSummary } from "./agent-client.js";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";

const profile = Object.freeze({ issuer: "https://example.test", clientId: "public-client" });
const credentials = Object.freeze({ profile, accessToken: "old-access", refreshToken: "old-refresh", scope: "payments.read", expiresAt: "2099-01-01T00:00:00Z" });
const metadata = Object.freeze({ authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token" });
const period = Object.freeze({ range: "today", timeZone: "UTC", start: "2026-09-13T00:00:00.000Z", end: "2026-09-14T00:00:00.000Z" });
const data = Object.freeze({ label: "gross collected receipts", start: period.start, end: period.end, period, currencies: [], source: { provider: "d1", readCompletedAt: "2026-09-13T12:00:00.000Z" } });
const now = (): number => 1000;
const requestId = "123e4567-e89b-42d3-a456-426614174000";

await Promise.all([false, true].map((revoked) => test(`summary refreshes once before returning projected data, revoked=${String(revoked)}`, async () => {
  const persistCredentials = mock.fn((): Promise<void> => Promise.resolve());
  const fetcher = mock.fn((url: string, init?: RequestInit): Promise<Response> => {
    if (url.endsWith("/token")) return Promise.resolve(revoked ? Response.json({ error: "invalid_grant" }, { status: 400 })
      : Response.json({ access_token: "new-access", refresh_token: "new-refresh", token_type: "Bearer", expires_in: 300 }));
    assert.equal(new URL(url).pathname, "/api/agent/payments/received-summary");
    assert.deepEqual(Object.fromEntries(new URL(url).searchParams), { api_version: "v1", range: "today" });
    assert.equal(init?.method, "GET");
    assert.equal(init.redirect, "error");
    if (new Headers(init.headers).get("Authorization") === "Bearer old-access") return Promise.resolve(Response.json({ error: "invalid_token" }, { status: 401 }));
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer new-access");
    assert.equal(persistCredentials.mock.callCount(), 1);
    return Promise.resolve(Response.json({ data: { ...data, private_notes: "omit" }, meta: { contract_version: "v1", request_id: requestId } }));
  });
  const result = receivedPaymentSummary({ credentials, profile, metadata, now, fetcher, persistCredentials, options: { range: "today" } });
  if (revoked) await assert.rejects(result, /OAuth refresh/u);
  else assert.deepEqual((await result).response, { data, meta: { contract_version: "v1", request_id: requestId } });
  assert.equal(fetcher.mock.callCount(), revoked ? 2 : 3);
  assert.equal(persistCredentials.mock.callCount(), revoked ? 0 : 1);
})));

await test("invalid summary dates fail before requesting an access token", async () => {
  const getAccessToken = mock.fn((): Promise<string> => Promise.reject(new Error("Unexpected credentials")));
  const client = createCanonicalCrmClient({ origin: profile.issuer, getAccessToken });
  assert.equal((await client.receivedPaymentSummary({ range: "custom", start_date: "2026-02-30", end_date: "2026-03-01" })).status, 400);
  assert.equal(getAccessToken.mock.callCount(), 0);
});

await test("malformed financial response is rejected, never presented as a zero summary", async () => {
  const client = createCanonicalCrmClient({ origin: profile.issuer, getAccessToken: (): Promise<string> => Promise.resolve("token"),
    request: (): Promise<Response> => Promise.resolve(Response.json({ data: { ...data, currencies: [{ currency: "CAD", amount: null }] }, meta: { contract_version: "v1" } })),
  });
  assert.equal((await client.receivedPaymentSummary()).status, 502);
});
