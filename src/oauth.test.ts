import assert from "node:assert/strict";
import test from "node:test";

import { authorizationUrl, createPkce, discoverOAuth, exchangeDeviceCode, issuerOrigin, requestDeviceAuthorization } from "./oauth.js";

const issuer = new URL("https://example.test");
const jsonResponse = (value: Readonly<Record<string, unknown>>): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(value)));

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
    authorization_endpoint: "https://example.test/authorize",
    code_challenge_methods_supported: ["S256"],
    token_endpoint: "https://example.test/token",
  }));

  assert.equal(metadata.token_endpoint, "https://example.test/token");
  await assert.rejects(discoverOAuth(issuer, (): Promise<Response> => jsonResponse({
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
