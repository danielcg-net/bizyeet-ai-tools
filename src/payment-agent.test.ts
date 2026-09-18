import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { getPayment, listPayments } from "./agent-client.js";

const profile = { issuer: "https://example.test", clientId: "public-client" };
const credentials = { profile, accessToken: "old-access", refreshToken: "old-refresh", scope: "payments.read", expiresAt: "2099-01-01T00:00:00Z" };
const metadata = { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token" };
const now = (): number => 1000;

await Promise.all([false, true].map((revoked) => test(`payment reads refresh once, revoked=${String(revoked)}`, async () => {
  const persistCredentials = mock.fn((): Promise<void> => Promise.resolve());
  const fetcher = mock.fn((url: string, init?: RequestInit): Promise<Response> => {
    if (url.endsWith("/token")) return Promise.resolve(revoked ? Response.json({ error: "invalid_grant" }, { status: 400 })
      : Response.json({ access_token: "new-access", refresh_token: "new-refresh", token_type: "Bearer", expires_in: 300 }));
    assert.equal(new URL(url).pathname, "/api/agent/payments/pay1.opaque.id");
    assert.equal(new URL(url).searchParams.get("fields"), "id,amount");
    if (new Headers(init?.headers).get("Authorization") === "Bearer old-access") return Promise.resolve(Response.json({ error: "invalid_token" }, { status: 401 }));
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer new-access");
    assert.equal(persistCredentials.mock.callCount(), 1);
    return Promise.resolve(Response.json({ data: { id: "pay1.opaque.id", amount: 12 }, meta: { contract_version: "v1" } }));
  });
  const result = getPayment({ credentials, profile, metadata, now, fetcher, persistCredentials, resourceId: "pay1.opaque.id", options: { fields: ["id", "amount"] } });
  if (revoked) await assert.rejects(result, /OAuth refresh/u);
  else assert.deepEqual((await result).response, { data: { id: "pay1.opaque.id", amount: 12 }, meta: { contract_version: "v1" } });
  assert.equal(fetcher.mock.callCount(), revoked ? 2 : 3);
  assert.equal(persistCredentials.mock.callCount(), revoked ? 0 : 1);
})));

await test("payment list forwards filters and opaque cursor without automatic pagination", async () => {
  const cursor = "opaque+/cursor?next=1";
  const fetcher = mock.fn((url: string): Promise<Response> => {
    const target = new URL(url);
    assert.equal(target.pathname, "/api/agent/payments");
    assert.deepEqual(Object.fromEntries(target.searchParams), { api_version: "v1", limit: "2", cursor, fields: "id,amount", sort: "amount", dir: "asc", status: "sent", date_field: "sent_at", start: "2026-09-01T00:00:00Z" });
    return Promise.resolve(Response.json({ data: { items: [{ id: "pay1.opaque.id" }], total: 5 }, meta: { contract_version: "v1", next_cursor: "more" } }));
  });
  const result = await listPayments({ credentials, profile, metadata, now, fetcher, persistCredentials: (): Promise<never> => Promise.reject(new Error("Unexpected refresh")),
    options: { limit: 2, cursor, fields: ["id", "amount"], sort: "amount", dir: "asc", status: "sent", date_field: "sent_at", start: "2026-09-01T00:00:00Z" } });
  assert.equal(fetcher.mock.callCount(), 1);
  assert.deepEqual(result.response, { data: { items: [{ id: "pay1.opaque.id" }], total: 5 }, meta: { contract_version: "v1", next_cursor: "more" } });
});
