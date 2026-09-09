import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { loginWithBrowser, loginWithDevice } from "./auth-session.js";
import { openLoopbackCallback, type LoopbackCallback } from "./loopback.js";

const response = (value: Readonly<Record<string, unknown>>): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(value)));

await Promise.all(["transport", "malformed"].map((scenario) => test(`closes the real callback listener after ${scenario} registration failure`, async () => {
  const openCallback = mock.fn(openLoopbackCallback);
  const launchBrowser = mock.fn((): Promise<void> => Promise.reject(new Error("Must not launch")));
  const fetcher = mock.fn((url: string): Promise<Response> => url.endsWith("oauth-authorization-server")
    ? response({ issuer: "https://example.test", authorization_endpoint: "https://example.test/authorize", code_challenge_methods_supported: ["S256"], registration_endpoint: "https://example.test/register", token_endpoint: "https://example.test/token" })
    : scenario === "transport" ? Promise.reject(new Error("Registration unavailable")) : response({ client_id: 42 }));
  await assert.rejects(loginWithBrowser({ issuer: "https://example.test", scope: "customers.read" }, { fetcher, launchBrowser, now: Date.now, openCallback }));
  assert.equal(openCallback.mock.callCount(), 1);
  assert.equal(launchBrowser.mock.callCount(), 0);
  const callback = await openCallback.mock.calls[0]?.result;
  assert.ok(callback);
  await assert.rejects(fetch(callback.redirectUri, { signal: AbortSignal.timeout(1000) }));
})));

void test("stores the device-flow result without exposing tokens through the verification callback", async (): Promise<void> => {
  const responseStream = (function* (): Generator<Promise<Response>, undefined, undefined> {
    yield response({
      authorization_endpoint: "https://example.test/authorize",
      issuer: "https://example.test",
      code_challenge_methods_supported: ["S256"],
      device_authorization_endpoint: "https://example.test/device",
      registration_endpoint: "https://example.test/register",
      token_endpoint: "https://example.test/token",
    });
    yield response({ client_id: "public-client", token_endpoint_auth_method: "none", grant_types: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"] });
    yield response({ device_code: "device-secret", expires_in: 900, interval: 5, user_code: "ABCD-EFGH", verification_uri: "https://example.test/verify" });
    yield response({ access_token: "access-secret", expires_in: 300, refresh_token: "refresh-secret", scope: "customers.read", token_type: "Bearer" });
  })();
  const result = await loginWithDevice({ issuer: "https://example.test", scope: "customers.read" }, {
    fetcher: (url, init) => {
      if (url.endsWith("/register")) {
        if (typeof init?.body !== "string") throw new Error("Expected registration JSON");
        assert.match(init.body, /urn:ietf:params:oauth:grant-type:device_code/u);
      }
      return responseStream.next().value ?? Promise.reject(new Error("Unexpected request."));
    },
    now: () => 1000,
    onVerification: (device) => {
      assert.equal(device.userCode, "ABCD-EFGH");
    },
  });

  assert.equal(result.profile.clientId, "public-client");
  assert.equal(result.profile.deviceGrantVerified, true);
  assert.equal(result.credentials.expiresAt, "1970-01-01T00:05:01.000Z");
  assert.equal(result.credentials.accessToken, "access-secret");
  assert.deepEqual(result.credentials.profile, result.profile);
});

void test("uses a fresh PKCE browser authorization and exact callback code exchange", async (): Promise<void> => {
  const responseStream = (function* (): Generator<Promise<Response>, undefined, undefined> {
    yield response({ issuer: "https://example.test", authorization_endpoint: "https://example.test/authorize", code_challenge_methods_supported: ["S256"], registration_endpoint: "https://example.test/register", token_endpoint: "https://example.test/token" });
    yield response({ client_id: "public-client", token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] });
    yield response({ access_token: "access-secret", expires_in: 300, refresh_token: "refresh-secret", scope: "customers.read", token_type: "Bearer" });
  })();
  const callback: LoopbackCallback = { awaitCode: (): Promise<string> => Promise.resolve("one-time-code"), close: (): Promise<void> => Promise.resolve(), redirectUri: "http://127.0.0.1:43123/callback" };
  const result = await loginWithBrowser({ issuer: "https://example.test", scope: "customers.read" }, {
    fetcher: () => responseStream.next().value ?? Promise.reject(new Error("Unexpected request.")),
    launchBrowser: (url) => {
      const target = new URL(url);
      assert.equal(target.searchParams.get("code_challenge_method"), "S256");
      assert.equal(target.searchParams.get("redirect_uri"), callback.redirectUri);
      assert.ok(target.searchParams.get("state"));
      return Promise.resolve();
    },
    now: () => 1000,
    openCallback: (state) => {
      assert.match(state, /^[0-9a-f-]{36}$/u);
      return Promise.resolve(callback);
    },
  });

  assert.equal(result.profile.clientId, "public-client");
  assert.equal(result.credentials.refreshToken, "refresh-secret");
  assert.deepEqual(result.credentials.profile, result.profile);
});
