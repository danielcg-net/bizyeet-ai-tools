import assert from "node:assert/strict";
import test from "node:test";

import { getCustomer, listCustomers } from "./agent-client.js";

const profile = { clientId: "public-client", issuer: "https://example.test" };
const metadata = { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token" };
const validCredentials = { accessToken: "access-token", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "refresh-token", scope: "customers.read" };
const header = (request: RequestInit | undefined, name: string): string | null => new Headers(request?.headers).get(name);

void test("uses only bounded customer-list query parameters", async (): Promise<void> => {
  const result = await listCustomers({
    credentials: validCredentials,
    fetcher: (url, request): Promise<Response> => {
      const target = new URL(url);
      assert.equal(target.pathname, "/api/agent/customers");
      assert.equal(target.searchParams.get("limit"), "25");
      assert.equal(target.searchParams.get("api_version"), "v1");
      assert.equal(header(request, "Authorization"), "Bearer access-token");
      return Promise.resolve(new Response(JSON.stringify({ data: { items: [] }, meta: { contract_version: "v1", request_id: "req" } })));
    },
    metadata,
    now: () => 1000,
    options: { limit: 25, search: "acme" },
    profile,
  });

  assert.deepEqual(result.response, { data: { items: [] }, meta: { contract_version: "v1", request_id: "req" } });
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
    profile,
    resourceId: "customer-1",
  });

  assert.equal(result.credentials.refreshToken, "fresh-refresh");
});

void test("rejects unbounded limits and route-like customer identifiers before making a request", async (): Promise<void> => {
  const noRequest = (): Promise<Response> => Promise.reject(new Error("Network should not run."));
  await assert.rejects(listCustomers({ credentials: validCredentials, fetcher: noRequest, metadata, now: () => 1000, options: { limit: 101 }, profile }));
  await assert.rejects(getCustomer({ credentials: validCredentials, fetcher: noRequest, metadata, now: () => 1000, profile, resourceId: "../other-tenant" }));
});
