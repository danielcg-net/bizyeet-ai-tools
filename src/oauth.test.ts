import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { authorizationUrl, createPkce, discoverOAuth, exchangeAuthorizationCode, exchangeDeviceCode, issuerOrigin, refreshAccessToken, registerPublicClient, requestDeviceAuthorization, revokeRefreshToken, type FetchLike } from "./oauth.js";

const issuer = new URL("https://example.test");
const jsonResponse = (value: Readonly<Record<string, unknown>>): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(value)));

void test("bounds every OAuth JSON boundary including successful and failed responses without retrying", async () => {
  const metadata = { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token",
    registration_endpoint: "https://example.test/register", device_authorization_endpoint: "https://example.test/device" };
  const operations: readonly ((fetcher: FetchLike) => Promise<unknown>)[] = [
    (fetcher): Promise<unknown> => discoverOAuth(issuer, fetcher),
    (fetcher): Promise<unknown> => exchangeAuthorizationCode({ fetcher, metadata, clientId: "client", code: "code", verifier: "verifier", redirectUri: "http://127.0.0.1:1234/callback", resource: issuer }),
    (fetcher): Promise<unknown> => refreshAccessToken({ fetcher, metadata, clientId: "client", refreshToken: "refresh", resource: issuer }),
    (fetcher): Promise<unknown> => requestDeviceAuthorization({ fetcher, metadata, clientId: "client", resource: issuer, scope: "customers.read" }),
    (fetcher): Promise<unknown> => registerPublicClient({ fetcher, metadata, redirectUri: "http://127.0.0.1:1234/callback" }),
    (fetcher): Promise<unknown> => exchangeDeviceCode({ fetcher, metadata, clientId: "client", resource: issuer,
      device: { deviceCode: "device", expiresIn: 900, interval: 5, userCode: "CODE", verificationUri: "https://example.test/verify" },
      dependencies: { now: () => 1000, sleep: () => Promise.reject(new Error("Must not poll again")) },
    }),
  ];
  await Promise.all(operations.flatMap((operation) => [200, 400].map(async (status) => {
    const response = Response.json({ ...metadata, issuer: issuer.origin, code_challenge_methods_supported: ["S256"],
      access_token: "access", expires_in: 900, token_type: "Bearer", client_id: "client", device_code: "device", user_code: "CODE",
      verification_uri: "https://example.test/verify", error: "authorization_pending", padding: "credential-excerpt".repeat(5000),
    }, { status });
    const fetcher = mock.fn(() => Promise.resolve(response));
    await assert.rejects(operation(fetcher), (error: unknown) => error instanceof Error && !error.message.includes("credential-excerpt"));
    assert.equal(fetcher.mock.callCount(), 1);
    assert.equal(response.body?.locked, false);
  })));
});

void test("credential-bearing OAuth POSTs have deadlines, reject redirects and never retry transport errors", async () => {
  const metadata = { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token",
    registration_endpoint: "https://example.test/register", revocation_endpoint: "https://example.test/revoke",
    device_authorization_endpoint: "https://example.test/device" };
  const operations: readonly ((fetcher: FetchLike) => Promise<unknown>)[] = [
    (fetcher): Promise<unknown> => exchangeAuthorizationCode({ fetcher, metadata, clientId: "client", code: "code", verifier: "verifier", redirectUri: "http://127.0.0.1:1234/callback", resource: issuer }),
    (fetcher): Promise<unknown> => refreshAccessToken({ fetcher, metadata, clientId: "client", refreshToken: "refresh", resource: issuer }),
    (fetcher): Promise<unknown> => revokeRefreshToken({ fetcher, metadata, clientId: "client", refreshToken: "refresh" }),
    (fetcher): Promise<unknown> => requestDeviceAuthorization({ fetcher, metadata, clientId: "client", resource: issuer, scope: "customers.read" }),
    (fetcher): Promise<unknown> => registerPublicClient({ fetcher, metadata, redirectUri: "http://127.0.0.1:1234/callback" }),
  ];
  await Promise.all(operations.map(async (operation) => {
    const fetcher = mock.fn((_url: string, init?: RequestInit): Promise<Response> => {
      assert.equal(init?.method, "POST");
      assert.equal(init.redirect, "error");
      assert.ok(init.signal instanceof AbortSignal);
      return Promise.reject(new Error("synthetic transport failure"));
    });
    await assert.rejects(operation(fetcher), /synthetic transport failure/u);
    assert.equal(fetcher.mock.callCount(), 1);
  }));
});

void test("rejects discovery issuer mismatch and credential-bearing endpoints", async (): Promise<void> => {
  const metadata = { issuer: issuer.origin, authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token", code_challenge_methods_supported: ["S256"] };
  await Promise.all([
    { issuer: undefined }, { issuer: "https://other.test" }, { issuer: "https://example.test/" },
    { token_endpoint: "https://user:secret@example.test/token" },
    { token_endpoint: "https://example.test/token#fragment" },
  ].map(async (override): Promise<void> => {
    await assert.rejects(discoverOAuth(issuer, (): Promise<Response> => jsonResponse({ ...metadata, ...override })), /compatible OAuth/u);
  }));
  await discoverOAuth(issuer, (_url, init): Promise<Response> => {
    assert.equal(init?.redirect, "error");
    return jsonResponse(metadata);
  });
});

void test("creates distinct RFC 7636 S256 proofs", (): void => {
  const first = createPkce();
  const second = createPkce();

  assert.match(first.verifier, /^[A-Za-z0-9_-]{64}$/u);
  assert.match(first.challenge, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(first.verifier, second.verifier);
});

void test("rejects issuer paths, credentials, and non-HTTPS origins", (): void => {
  ["http://example.test", "https://user@example.test", "https://example.test/path"].forEach((value) => {
    assert.throws(() => issuerOrigin(value));
  });
  assert.equal(issuerOrigin("https://example.test").origin, issuer.origin);
});

void test("accepts only same-origin metadata advertising S256", async (): Promise<void> => {
  const metadata = await discoverOAuth(issuer, (): Promise<Response> => jsonResponse({
    issuer: issuer.origin,
    authorization_endpoint: "https://example.test/authorize",
    code_challenge_methods_supported: ["S256"],
    token_endpoint: "https://example.test/token",
  }));

  assert.equal(metadata.token_endpoint, "https://example.test/token");
  await assert.rejects(discoverOAuth(issuer, (): Promise<Response> => jsonResponse({
    issuer: issuer.origin,
    authorization_endpoint: "https://other.test/authorize",
    code_challenge_methods_supported: ["S256"],
    token_endpoint: "https://example.test/token",
  })));
});

void test("binds authorization requests to state, resource, and PKCE S256", (): void => {
  const target = new URL(authorizationUrl({
    clientId: "public-client",
    metadata: { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token" },
    pkce: { challenge: "proof", verifier: "verifier" },
    redirectUri: "http://127.0.0.1:40000/callback",
    resource: issuer,
    scope: "customers.read",
    state: "state-value",
  }));

  assert.equal(target.searchParams.get("code_challenge_method"), "S256");
  assert.equal(target.searchParams.get("resource"), issuer.origin);
  assert.equal(target.searchParams.get("state"), "state-value");
});

void test("binds device authorization to the OAuth resource", async (): Promise<void> => {
  const device = await requestDeviceAuthorization({
    clientId: "public-client",
    fetcher: (_url, request): Promise<Response> => {
      const body = request?.body;
      assert.ok(body instanceof URLSearchParams);
      assert.equal(body.get("resource"), issuer.origin);
      return jsonResponse({ device_code: "device-code", expires_in: 900, interval: 5, user_code: "ABCD-EFGH", verification_uri: "https://example.test/verify" });
    },
    metadata: { authorization_endpoint: "https://example.test/authorize", device_authorization_endpoint: "https://example.test/device", token_endpoint: "https://example.test/token" },
    resource: issuer,
    scope: "customers.read",
  });

  assert.equal(device.userCode, "ABCD-EFGH");
});

void test("defaults an omitted device interval to five seconds and preserves explicit positive intervals", async () => {
  await Promise.all([undefined, 1, 10].map(async (interval) => {
    const device = await requestDeviceAuthorization({
      clientId: "public-client",
      fetcher: () => jsonResponse({ device_code: "device-code", expires_in: 900, interval, user_code: "ABCD-EFGH", verification_uri: "https://example.test/verify" }),
      metadata: { authorization_endpoint: "https://example.test/authorize", device_authorization_endpoint: "https://example.test/device", token_endpoint: "https://example.test/token" },
      resource: issuer,
      scope: "customers.read",
    });
    assert.equal(device.interval, interval ?? 5);
  }));
});

void test("rejects invalid explicit device intervals instead of applying the absent-value default", async () => {
  await Promise.all([null, 0, -1, "5", true, Number.NaN, Number.POSITIVE_INFINITY].map(async (interval) => {
    await assert.rejects(requestDeviceAuthorization({
      clientId: "public-client",
      fetcher: () => jsonResponse({ device_code: "device-code", expires_in: 900, interval, user_code: "ABCD-EFGH", verification_uri: "https://example.test/verify" }),
      metadata: { authorization_endpoint: "https://example.test/authorize", device_authorization_endpoint: "https://example.test/device", token_endpoint: "https://example.test/token" },
      resource: issuer,
      scope: "customers.read",
    }), /OAuth device authorization could not be started/u);
  }));
});

void test("honors slow_down before retrying a device token exchange", async (): Promise<void> => {
  const responseStream = (function* (): Generator<Promise<Response>, undefined, undefined> {
    yield jsonResponse({ error: "slow_down" });
    yield jsonResponse({ access_token: "access", expires_in: 300, refresh_token: "refresh", token_type: "Bearer" });
  })();
  const tokens = await exchangeDeviceCode({
    clientId: "public-client",
    dependencies: { now: () => 1000, sleep: (milliseconds) => milliseconds === 10000 ? Promise.resolve() : Promise.reject(new Error("Wrong polling interval.")) },
    device: { deviceCode: "device-code", expiresIn: 900, interval: 5, userCode: "ABCD-EFGH", verificationUri: "https://example.test/verify" },
    fetcher: () => responseStream.next().value ?? Promise.reject(new Error("Unexpected extra poll.")),
    metadata: { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token" },
    resource: issuer,
  });

  assert.equal(tokens.token_type, "Bearer");
});

void test("registers only a secretless public client with an exact loopback callback", async (): Promise<void> => {
  const registered = await registerPublicClient({
    fetcher: (_url, request): Promise<Response> => {
      const body = request?.body;
      if (typeof body !== "string") throw new Error("Expected JSON registration body.");
      assert.deepEqual(JSON.parse(body), {
        redirect_uris: ["http://127.0.0.1:43123/callback"],
        token_endpoint_auth_method: "none",
      });
      return jsonResponse({ client_id: "registered-client", token_endpoint_auth_method: "none" });
    },
    metadata: { authorization_endpoint: "https://example.test/authorize", registration_endpoint: "https://example.test/register", token_endpoint: "https://example.test/token" },
    redirectUri: "http://127.0.0.1:43123/callback",
  });

  assert.equal(registered.clientId, "registered-client");
  await assert.rejects(registerPublicClient({
    fetcher: () => Promise.reject(new Error("Network should not run.")),
    metadata: { authorization_endpoint: "https://example.test/authorize", registration_endpoint: "https://example.test/register", token_endpoint: "https://example.test/token" },
    redirectUri: "https://example.test/callback",
  }));
});

void test("sends refresh-token revocation only to the advertised OAuth endpoint", async (): Promise<void> => {
  await revokeRefreshToken({
    clientId: "public-client",
    fetcher: (url, request): Promise<Response> => {
      assert.equal(url, "https://example.test/revoke");
      const body = request?.body;
      assert.ok(body instanceof URLSearchParams);
      assert.equal(body.get("token"), "refresh-secret");
      assert.equal(body.get("token_type_hint"), "refresh_token");
      return Promise.resolve(new Response(null, { status: 200 }));
    },
    metadata: { authorization_endpoint: "https://example.test/authorize", revocation_endpoint: "https://example.test/revoke", token_endpoint: "https://example.test/token" },
    refreshToken: "refresh-secret",
  });
});
