import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { getCustomer, listCustomers } from "./agent-client.js";

const profile = { clientId: "public-client", issuer: "https://example.test" };
const metadata = { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token" };
const validCredentials = { accessToken: "access-token", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "refresh-token", scope: "customers.read" };
const header = (request: RequestInit | undefined, name: string): string | null => new Headers(request?.headers).get(name);

void test("passes long opaque identifiers unchanged through the canonical transport", async (): Promise<void> => {
  const id = `crm1.${"a".repeat(489)}.customers.1234567`;
  assert.equal(id.length, 512);
  const response = { data: { id }, meta: { contract_version: "v1" } };
  const outcome = await getCustomer({ credentials: validCredentials, metadata, now: () => 1000, profile, resourceId: id,
    persistCredentials: () => Promise.reject(new Error("Unexpected persistence")),
    fetcher: (url) => {
      assert.equal(new URL(url).pathname, `/api/agent/customers/${id}`);
      return Promise.resolve(Response.json(response));
    },
  });
  assert.deepEqual(outcome.response, response);
});

void test("does not turn provider failures, stale cursors or invalid envelopes into empty success", async (): Promise<void> => {
  await Promise.all([
    { status: 503, body: { error: { code: "provider_unavailable" } }, expected: /provider_unavailable/u },
    { status: 400, body: { error: { code: "invalid_cursor" } }, expected: /invalid_cursor/u },
    { status: 200, body: { data: { items: [] }, meta: { contract_version: "v1" } }, expected: /invalid_response/u },
  ].map(async ({ status, body, expected }) => {
    const fetcher = mock.fn(() => Promise.resolve(Response.json(body, { status })));
    await assert.rejects(listCustomers({ credentials: validCredentials, metadata, now: () => 1000, profile,
      options: {}, fetcher, persistCredentials: () => Promise.reject(new Error("Unexpected persistence")),
    }), expected);
    assert.equal(fetcher.mock.callCount(), 1);
  }));
});

void test("uses only bounded customer-list query parameters", async (): Promise<void> => {
  const result = await listCustomers({
    credentials: validCredentials,
    fetcher: (url, request): Promise<Response> => {
      const target = new URL(url);
      assert.equal(target.pathname, "/api/agent/customers");
      assert.equal(target.searchParams.get("limit"), "25");
      assert.equal(request?.redirect, "error");
      assert.equal(header(request, "Authorization"), "Bearer access-token");
      return Promise.resolve(new Response(JSON.stringify({ data: { items: [], total: 0 }, meta: { contract_version: "v1", request_id: "req", next_cursor: null } })));
    },
    metadata,
    now: () => 1000,
    options: { limit: 25, search: "acme" },
    persistCredentials: () => Promise.reject(new Error("Valid credentials must not be rewritten.")),
    profile,
  });

  assert.deepEqual(result.response, { data: { items: [], total: 0 }, meta: { contract_version: "v1", request_id: "req", next_cursor: null } });
});

void test("refreshes once after an expired access token and preserves no generic retry loop", async (): Promise<void> => {
  const responses = (function* (): Generator<Promise<Response>, undefined, undefined> {
    yield Promise.resolve(new Response(JSON.stringify({ access_token: "fresh-access", expires_in: 300, refresh_token: "fresh-refresh", scope: "customers.read", token_type: "Bearer" })));
    yield Promise.resolve(new Response(JSON.stringify({ data: { id: "customer-1" }, meta: { contract_version: "v1", request_id: "req" } })));
  })();
  const result = await getCustomer({
    credentials: { ...validCredentials, expiresAt: "1970-01-01T00:00:00.000Z" },
    fetcher: (url, request): Promise<Response> => {
      assert.equal(header(request, "Authorization"), url.endsWith("/token") ? null : "Bearer fresh-access");
      return responses.next().value ?? Promise.reject(new Error("Unexpected request."));
    },
    metadata,
    now: () => 1000,
    persistCredentials: (credentials) => { assert.equal(credentials.refreshToken, "fresh-refresh"); return Promise.resolve(); },
    profile,
    resourceId: "customer-1",
  });

  assert.equal(result.credentials.refreshToken, "fresh-refresh");
});

void test("rejects unbounded limits and route-like customer identifiers before making a request", async (): Promise<void> => {
  const noRequest = (): Promise<Response> => Promise.reject(new Error("Network should not run."));
  const persistCredentials = (): Promise<void> => Promise.reject(new Error("Storage should not run."));
  await assert.rejects(listCustomers({ credentials: validCredentials, fetcher: noRequest, metadata, now: () => 1000, options: { limit: 101 }, persistCredentials, profile }));
  await assert.rejects(getCustomer({ credentials: validCredentials, fetcher: noRequest, metadata, now: () => 1000, persistCredentials, profile, resourceId: "../other-tenant" }));
});

void test("persists rotation before a failed resource request, including a 401-triggered refresh", async (): Promise<void> => {
  await Promise.all([true, false].map(async (expired): Promise<void> => {
    const persistCredentials = mock.fn((): Promise<void> => Promise.resolve());
    const fetcher = mock.fn((url: string, request?: RequestInit): Promise<Response> => {
      if (url.endsWith("/token")) return Promise.resolve(new Response(JSON.stringify({ access_token: "fresh-access", expires_in: 300, refresh_token: "fresh-refresh", token_type: "Bearer" })));
      if (header(request, "Authorization") === "Bearer access-token") return Promise.resolve(Response.json({ error: { code: "authorization_required" } }, { status: 401 }));
      assert.equal(persistCredentials.mock.callCount(), 1);
      return Promise.reject(new Error("Resource connection failed"));
    });
    await assert.rejects(getCustomer({
      credentials: { ...validCredentials, expiresAt: expired ? "1970-01-01T00:00:00.000Z" : validCredentials.expiresAt },
      fetcher, metadata, now: () => 1000, persistCredentials, profile, resourceId: "customer-1",
    }), /request_unavailable/u);
    assert.equal(persistCredentials.mock.callCount(), 1);
    assert.equal(fetcher.mock.callCount(), expired ? 2 : 3);
  }));
});

void test("does not call the resource if rotated credentials cannot be persisted", async (): Promise<void> => {
  const fetcher = mock.fn((url: string): Promise<Response> => {
    assert.equal(url, metadata.token_endpoint);
    return Promise.resolve(new Response(JSON.stringify({ access_token: "fresh-access", expires_in: 300, refresh_token: "fresh-refresh", token_type: "Bearer" })));
  });
  await assert.rejects(getCustomer({
    credentials: { ...validCredentials, expiresAt: "1970-01-01T00:00:00.000Z" },
    fetcher, metadata, now: () => 1000,
    persistCredentials: () => Promise.reject(new Error("Credential store unavailable")),
    profile, resourceId: "customer-1",
  }), /Credential store unavailable/u);
  assert.equal(fetcher.mock.callCount(), 1);
});
