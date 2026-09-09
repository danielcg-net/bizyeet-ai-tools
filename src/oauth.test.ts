import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { authorizationUrl, createPkce, discoverOAuth, exchangeAuthorizationCode, exchangeDeviceCode, issuerOrigin, refreshAccessToken, registerPublicClient, requestDeviceAuthorization, revokeRefreshToken, type FetchLike } from "./oauth.js";

const issuer = new URL("https://example.test");
const jsonResponse = (value: Readonly<Record<string, unknown>>): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(value)));

await Promise.all(["", " ", "token\n", "token value"].map((accessToken, index) => test(`rejects unusable access tokens at every exchange ${String(index)}`, async () => {
  const metadata = { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token" };
  const fetcher = (): Promise<Response> => jsonResponse({ access_token: accessToken, expires_in: 300, token_type: "Bearer" });
  await assert.rejects(exchangeAuthorizationCode({ clientId: "client", code: "code", verifier: "verifier", redirectUri: "http://127.0.0.1:43123/callback", resource: issuer, metadata, fetcher }), /exchange failed/u);
  await assert.rejects(refreshAccessToken({ clientId: "client", refreshToken: "refresh", resource: issuer, metadata, fetcher }), /refresh failed/u);
  await assert.rejects(exchangeDeviceCode({ clientId: "client", resource: issuer, metadata, fetcher,
    device: { deviceCode: "device", userCode: "CODE", expiresIn: 900, interval: 5, verificationUri: "https://example.test/verify" } }));
})));

await Promise.all([901, 9_000_000, Number.MAX_VALUE].map((expiresIn) => test(`bounds advertised and direct device lifetimes ${String(expiresIn)}`, async () => {
  const metadata = { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token", device_authorization_endpoint: "https://example.test/device" };
  await assert.rejects(requestDeviceAuthorization({ clientId: "client", resource: issuer, scope: "customers.read", metadata,
    fetcher: () => jsonResponse({ device_code: "device", user_code: "CODE", expires_in: expiresIn, verification_uri: "https://example.test/verify" }) }), /could not be started/u);
  const fetcher = mock.fn(() => Promise.reject(new Error("Must not poll")));
  await assert.rejects(exchangeDeviceCode({ clientId: "client", resource: issuer, metadata, fetcher,
    device: { deviceCode: "device", userCode: "CODE", expiresIn, interval: 5, verificationUri: "https://example.test/verify" } }), /unsupported timing/u);
  assert.equal(fetcher.mock.callCount(), 0);
})));

void test("rejects unrepresentable token expirations at every token exchange boundary", async () => {
  const metadata = { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token" };
  const operations: readonly ((fetcher: FetchLike) => Promise<unknown>)[] = [
    (fetcher): Promise<unknown> => exchangeAuthorizationCode({ fetcher, metadata, clientId: "client", code: "code", verifier: "verifier", redirectUri: "http://127.0.0.1:1234/callback", resource: issuer }),
    (fetcher): Promise<unknown> => refreshAccessToken({ fetcher, metadata, clientId: "client", refreshToken: "old-refresh", resource: issuer }),
    (fetcher): Promise<unknown> => exchangeDeviceCode({ fetcher, metadata, clientId: "client", resource: issuer,
      device: { deviceCode: "device", expiresIn: 900, interval: 5, userCode: "CODE", verificationUri: "https://example.test/verify" },
      dependencies: { now: () => 1000, sleep: () => Promise.reject(new Error("Unexpected retry")) } }),
  ];
  await Promise.all(operations.map(async (operation) => {
    await Promise.all([1e20, Number.MAX_VALUE, 8_640_000_000_000].map(async (expiresIn) => {
      const fetcher = mock.fn(() => jsonResponse({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: expiresIn, token_type: "Bearer" }));
      await assert.rejects(operation(fetcher), (error: unknown) => error instanceof Error
        && /OAuth|Device/u.test(error.message) && !error.message.includes("synthetic-") && !(error instanceof RangeError));
      assert.equal(fetcher.mock.callCount(), 1);
    }));
    const fetcher = mock.fn(() => jsonResponse({ access_token: "synthetic-access", expires_in: 1_000_000_000, token_type: "Bearer" }));
    await operation(fetcher);
    assert.equal(fetcher.mock.callCount(), 1);
  }));
});

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

void test("preserves advertised authorization query parameters without overriding generated OAuth fields", (): void => {
  const endpoint = "https://example.test/authorize?tenant=acme&hint=a%2Bb+team&empty=&state=stale&%73tate=duplicate&client_id=wrong&code_challenge_method=plain&resource=https%3A%2F%2Fother.test";
  const metadata = { authorization_endpoint: endpoint, token_endpoint: "https://example.test/token" };
  const target = new URL(authorizationUrl({ clientId: "public-client", metadata,
    pkce: { challenge: "proof", verifier: "verifier" }, redirectUri: "http://127.0.0.1:40000/callback",
    resource: issuer, scope: "customers.read", state: "generated-state",
  }));
  assert.equal(target.origin, issuer.origin);
  assert.equal(target.pathname, "/authorize");
  assert.equal(target.searchParams.get("tenant"), "acme");
  assert.equal(target.searchParams.get("hint"), "a+b team");
  assert.equal(target.searchParams.get("empty"), "");
  assert.deepEqual(target.searchParams.getAll("state"), ["generated-state"]);
  assert.deepEqual(target.searchParams.getAll("client_id"), ["public-client"]);
  assert.deepEqual(target.searchParams.getAll("code_challenge_method"), ["S256"]);
  assert.deepEqual(target.searchParams.getAll("resource"), [issuer.origin]);
  assert.equal(metadata.authorization_endpoint, endpoint);
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
  await Promise.all([undefined, 1, 10, 2_147_483.647].map(async (interval) => {
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
  await Promise.all([null, 0, -1, 0.001, 0.5, 0.999, "5", true, Number.NaN, Number.POSITIVE_INFINITY, 3_000_000, 2_147_483.648].map(async (interval) => {
    await assert.rejects(requestDeviceAuthorization({
      clientId: "public-client",
      fetcher: () => jsonResponse({ device_code: "device-code", expires_in: 900, interval, user_code: "ABCD-EFGH", verification_uri: "https://example.test/verify" }),
      metadata: { authorization_endpoint: "https://example.test/authorize", device_authorization_endpoint: "https://example.test/device", token_endpoint: "https://example.test/token" },
      resource: issuer,
      scope: "customers.read",
    }), /OAuth device authorization could not be started/u);
  }));
});

void test("rejects timer-overflow inputs before polling and slow_down overflow before sleeping", async () => {
  const device = { deviceCode: "device", expiresIn: 900, interval: 2_147_483.647, userCode: "CODE", verificationUri: "https://example.test/verify" };
  const metadata = { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token" };
  const fetcher = mock.fn(() => jsonResponse({ error: "slow_down" }));
  const sleep = mock.fn(() => Promise.reject(new Error("Unsafe timer must not be scheduled")));
  await Promise.all([3_000_000, Number.POSITIVE_INFINITY, Number.NaN, 0, 0.001, 0.5, 0.999].map(async (interval) => {
    await assert.rejects(exchangeDeviceCode({ clientId: "client", device: { ...device, interval }, metadata, resource: issuer, fetcher,
      dependencies: { now: () => 1000, sleep },
    }), /unsupported timing/u);
  }));
  assert.equal(fetcher.mock.callCount(), 0);
  await assert.rejects(exchangeDeviceCode({ clientId: "client", device, metadata, resource: issuer, fetcher,
    dependencies: { now: () => 1000, sleep },
  }), /exceeds supported timer limits/u);
  assert.equal(fetcher.mock.callCount(), 1);
  assert.equal(sleep.mock.callCount(), 0);
});

void test("waits only until expiry when the next poll would be too late", async () => {
  const fetcher = mock.fn(() => jsonResponse({ error: "authorization_pending" }));
  const sleep = mock.fn((milliseconds: number) => {
    assert.equal(milliseconds, 2000);
    return Promise.resolve();
  });
  await assert.rejects(exchangeDeviceCode({ clientId: "client",
    device: { deviceCode: "device", expiresIn: 2, interval: 5, userCode: "CODE", verificationUri: "https://example.test/verify" },
    metadata: { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token" }, resource: issuer, fetcher,
    dependencies: { now: () => 1000, sleep },
  }), /authorization expired/u);
  assert.equal(fetcher.mock.callCount(), 1);
  assert.equal(sleep.mock.callCount(), 1);
});

void test("rounds fractional millisecond intervals up rather than polling early", async () => {
  const responses = [
    { error: "authorization_pending" },
    { access_token: "access", expires_in: 300, token_type: "Bearer" },
  ].values();
  const sleep = mock.fn((milliseconds: number) => {
    assert.equal(milliseconds, 1001);
    return Promise.resolve();
  });
  await exchangeDeviceCode({ clientId: "client",
    device: { deviceCode: "device", expiresIn: 2, interval: 1.0005, userCode: "CODE", verificationUri: "https://example.test/verify" },
    metadata: { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token" }, resource: issuer,
    fetcher: () => jsonResponse(responses.next().value ?? {}), dependencies: { now: () => 1000, sleep },
  });
  assert.equal(sleep.mock.callCount(), 1);
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
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      });
      return jsonResponse({ client_id: "registered-client", token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] });
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

void test("requests the device grant explicitly during public registration", async () => {
  const registered = await registerPublicClient({ deviceGrant: true, redirectUri: "http://127.0.0.1:43123/callback",
    metadata: { authorization_endpoint: "https://example.test/authorize", registration_endpoint: "https://example.test/register", token_endpoint: "https://example.test/token" },
    fetcher: (_url, request) => {
      if (typeof request?.body !== "string") throw new Error("Expected registration JSON");
      assert.deepEqual(JSON.parse(request.body), { redirect_uris: ["http://127.0.0.1:43123/callback"],
        token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"], response_types: ["code"] });
      return jsonResponse({ client_id: "device-client", token_endpoint_auth_method: "none", grant_types: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"], response_types: [] });
    } });
  assert.equal(registered.clientId, "device-client");
});

await Promise.all([false, true].flatMap((deviceGrant) => [
  { grant_types: undefined }, { grant_types: null }, { grant_types: "refresh_token" },
  { grant_types: [] }, { grant_types: [42, "refresh_token"] },
  { grant_types: ["authorization_code"] },
  { grant_types: ["refresh_token"] },
  { grant_types: [deviceGrant ? "authorization_code" : "urn:ietf:params:oauth:grant-type:device_code", "refresh_token"] },
  { token_endpoint_auth_method: undefined },
  { client_secret: "must-not-appear-in-error" },
  { response_types: null }, { response_types: "code" },
].map((override, index) => test(`rejects insufficient registration metadata ${String(deviceGrant)}/${String(index)}`, async () => {
  await assert.rejects(registerPublicClient({ deviceGrant, redirectUri: "http://127.0.0.1:43123/callback",
    metadata: { authorization_endpoint: "https://example.test/authorize", registration_endpoint: "https://example.test/register", token_endpoint: "https://example.test/token" },
    fetcher: () => jsonResponse({ client_id: "client", token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"], ...override }),
  }), { message: "OAuth registration does not permit secretless login with the selected flow and refresh tokens. Contact your tenant administrator before retrying." });
}))));

await Promise.all([false, true].map((deviceGrant) => test(`accepts a server-assigned grant superset for ${String(deviceGrant)}`, async () => {
  assert.deepEqual(await registerPublicClient({ deviceGrant, redirectUri: "http://127.0.0.1:43123/callback",
    metadata: { authorization_endpoint: "https://example.test/authorize", registration_endpoint: "https://example.test/register", token_endpoint: "https://example.test/token" },
    fetcher: () => jsonResponse({ client_id: "client", token_endpoint_auth_method: "none", response_types: ["code"],
      grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"] }),
  }), { clientId: "client" });
})));

void test("rejects browser registration without a code response", async () => {
  await assert.rejects(registerPublicClient({ redirectUri: "http://127.0.0.1:43123/callback",
    metadata: { authorization_endpoint: "https://example.test/authorize", registration_endpoint: "https://example.test/register", token_endpoint: "https://example.test/token" },
    fetcher: () => jsonResponse({ client_id: "client", token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"], response_types: [] }),
  }), /does not permit secretless login/u);
});

await Promise.all(["verification_uri", "verification_uri_complete"].flatMap((field) => [
  "http://example.test/verify", "https://attacker.invalid/verify", "https://user:password@example.test/verify",
  "javascript:alert(1)", "/relative", "https://example.test/verify#fragment", "",
].map((url) => test(`rejects unsafe device ${field} ${url}`, async () => {
  await assert.rejects(requestDeviceAuthorization({ clientId: "client", resource: new URL("https://example.test"), scope: "customers.read",
    metadata: { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token", device_authorization_endpoint: "https://example.test/device" },
    fetcher: () => jsonResponse({ device_code: "synthetic-device", user_code: "ABCD-EFGH", expires_in: 900,
      verification_uri: "https://example.test/verify", verification_uri_complete: "https://example.test/verify?user_code=ABCD-EFGH", [field]: url }),
  }), /OAuth device authorization could not be started/u);
}))));

void test("preserves trusted complete device verification URL and user code", async () => {
  const result = await requestDeviceAuthorization({ clientId: "client", resource: new URL("https://example.test"), scope: "customers.read",
    metadata: { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token", device_authorization_endpoint: "https://example.test/device" },
    fetcher: () => jsonResponse({ device_code: "synthetic-device", user_code: "ABCD-EFGH", expires_in: 900,
      verification_uri: "https://example.test/verify", verification_uri_complete: "https://example.test/verify?user_code=ABCD-EFGH" }),
  });
  assert.equal(result.verificationUriComplete, "https://example.test/verify?user_code=ABCD-EFGH");
  assert.equal(result.userCode, "ABCD-EFGH");
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
