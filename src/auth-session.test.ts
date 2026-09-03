import assert from "node:assert/strict";
import test from "node:test";

import { loginWithDevice } from "./auth-session.js";

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
