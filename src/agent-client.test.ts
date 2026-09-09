import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { checkIdentity, getCustomer, listCustomers, executeCustomerUpdate } from "./agent-client.js";
import { isAgentFailure } from "./agent-error.js";

const profile = { clientId: "public-client", issuer: "https://example.test" };
const metadata = { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token" };
const validCredentials = { profile, accessToken: "access-token", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "refresh-token", scope: "customers.read" };
const header = (request: RequestInit | undefined, name: string): string | null => new Headers(request?.headers).get(name);

void test("execution does not refresh and replay after an HTTP denial", async () => {
  const fetcher = mock.fn(() => Promise.resolve(Response.json({ error: { code: "authorization_required" } }, { status: 401 })));
  await assert.rejects(executeCustomerUpdate({ credentials: validCredentials, metadata, now: () => 1000, profile, fetcher,
    persistCredentials: () => Promise.reject(new Error("Must not refresh after dispatch")),
    approval: { preview_id: "11111111-1111-4111-8111-111111111111", approval_receipt: "r".repeat(43), idempotency_key: "22222222-2222-4222-8222-222222222222" },
  }), (error: unknown) => error instanceof Error && isAgentFailure(error.cause) && error.cause.status === 401);
  assert.equal(fetcher.mock.callCount(), 1);
});

void test("checks server identity without accessing CRM or exposing tokens and user identifiers", async () => {
  const fetcher = mock.fn((url: string, init?: RequestInit) => {
    assert.equal(url, "https://example.test/api/agent/me");
    assert.equal(init?.redirect, "error");
    assert.equal(header(init, "Authorization"), "Bearer access-token");
    return Promise.resolve(Response.json({ tenant_id: "synthetic-tenant", client_id: profile.clientId,
      user_id: "private-user", scope: ["customers.read"], unexpected: "secret-value" }));
  });
  const result = await checkIdentity({ credentials: validCredentials, metadata, now: () => 1000, profile, fetcher,
    persistCredentials: () => Promise.reject(new Error("Unexpected write")),
  });
  const serialized = JSON.stringify(result.response);
  assert.match(serialized, /"verification":"server"/u);
  assert.match(serialized, /synthetic-tenant/u);
  assert.doesNotMatch(serialized, /private-user|secret-value|access-token|refresh-token/u);
  assert.equal(fetcher.mock.callCount(), 1);
});

void test("identity probe rejects a mismatched OAuth client and malformed scopes", async () => {
  await Promise.all([
    { tenant_id: "tenant", client_id: "different-client", scope: [] },
    { tenant_id: "tenant", client_id: profile.clientId, scope: [123] },
  ].map(async (body) => {
    await assert.rejects(checkIdentity({ credentials: validCredentials, metadata, now: () => 1000, profile,
      fetcher: () => Promise.resolve(Response.json(body)), persistCredentials: () => Promise.resolve(),
    }), (error: unknown) => error instanceof Error && isAgentFailure(error.cause) && error.cause.code === "invalid_response");
  }));
});

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
    { status: 503, body: { error: { code: "provider_unavailable" } }, expected: { code: "provider_unavailable" } },
    { status: 400, body: { error: { code: "invalid_cursor" } }, expected: { code: "invalid_cursor" } },
    { status: 200, body: { data: { items: [] }, meta: { contract_version: "v1" } }, expected: { code: "invalid_response" } },
  ].map(async ({ status, body, expected }) => {
    const fetcher = mock.fn(() => Promise.resolve(Response.json(body, { status })));
    await assert.rejects(listCustomers({ credentials: validCredentials, metadata, now: () => 1000, profile,
      options: {}, fetcher, persistCredentials: () => Promise.reject(new Error("Unexpected persistence")),
    }), (error: unknown) => error instanceof Error && isAgentFailure(error.cause) && error.cause.code === expected.code);
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
    persistCredentials: (credentials) => { assert.equal(credentials.refreshToken, "fresh-refresh"); assert.deepEqual(credentials.profile, profile); return Promise.resolve(); },
    profile,
    resourceId: "customer-1",
  });

  assert.equal(result.credentials.refreshToken, "fresh-refresh");
  assert.deepEqual(result.credentials.profile, profile);
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
    }), (error: unknown) => error instanceof Error && isAgentFailure(error.cause) && error.cause.code === "request_unavailable");
    assert.equal(persistCredentials.mock.callCount(), 1);
    assert.equal(fetcher.mock.callCount(), expired ? 3 : 4);
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
