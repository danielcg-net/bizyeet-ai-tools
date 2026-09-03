import assert from "node:assert/strict";
import test from "node:test";

import { loginWithBrowser, loginWithDevice } from "./auth-session.js";
import type { LoopbackCallback } from "./loopback.js";

const response = (value: Readonly<Record<string, unknown>>): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(value)));

void test("stores the device-flow result without exposing tokens through the verification callback", async (): Promise<void> => {
  const responseStream = (function* (): Generator<Promise<Response>, undefined, undefined> {
    yield response({
      authorization_endpoint: "https://example.test/authorize",
      code_challenge_methods_supported: ["S256"],
      device_authorization_endpoint: "https://example.test/device",
      registration_endpoint: "https://example.test/register",
      token_endpoint: "https://example.test/token",
    });
    yield response({ client_id: "public-client", token_endpoint_auth_method: "none" });
    yield response({ device_code: "device-secret", expires_in: 900, interval: 5, user_code: "ABCD-EFGH", verification_uri: "https://example.test/verify" });
    yield response({ access_token: "access-secret", expires_in: 300, refresh_token: "refresh-secret", scope: "customers.read", token_type: "Bearer" });
  })();
  const result = await loginWithDevice({ issuer: "https://example.test", scope: "customers.read" }, {
    fetcher: () => responseStream.next().value ?? Promise.reject(new Error("Unexpected request.")),
    now: () => 1000,
    onVerification: (device) => {
      assert.equal(device.userCode, "ABCD-EFGH");
    },
  });

  assert.equal(result.profile.clientId, "public-client");
  assert.equal(result.credentials.expiresAt, "1970-01-01T00:05:01.000Z");
  assert.equal(result.credentials.accessToken, "access-secret");
});

void test("uses a fresh PKCE browser authorization and exact callback code exchange", async (): Promise<void> => {
  const responseStream = (function* (): Generator<Promise<Response>, undefined, undefined> {
    yield response({ authorization_endpoint: "https://example.test/authorize", code_challenge_methods_supported: ["S256"], registration_endpoint: "https://example.test/register", token_endpoint: "https://example.test/token" });
    yield response({ client_id: "public-client", token_endpoint_auth_method: "none" });
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
});
