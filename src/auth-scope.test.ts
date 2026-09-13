import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { loginWithBrowser, loginWithDevice } from "./auth-session.js";

const requestedScope = "customers.read customers.write";

await Promise.all(["browser", "device"].flatMap((mode) => [undefined, "customers.read"].map((grantedScope) =>
  test(`${mode} login preserves ${grantedScope === undefined ? "omitted" : "narrowed"} scope`, async () => {
    const fetcher = mock.fn((url: string): Promise<Response> => {
      if (url.endsWith("oauth-authorization-server")) return Promise.resolve(Response.json({ issuer: "https://example.test",
        authorization_endpoint: "https://example.test/authorize", code_challenge_methods_supported: ["S256"],
        registration_endpoint: "https://example.test/register", token_endpoint: "https://example.test/token",
        device_authorization_endpoint: "https://example.test/device" }));
      if (url.endsWith("/register")) return Promise.resolve(Response.json({ client_id: "synthetic-client", token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"], response_types: ["code"] }));
      if (url.endsWith("/device")) return Promise.resolve(Response.json({ device_code: "synthetic", expires_in: 900, interval: 5,
        user_code: "ABCD-EFGH", verification_uri: "https://example.test/verify" }));
      if (url.endsWith("/token")) return Promise.resolve(Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh",
        expires_in: 300, token_type: "Bearer", ...(grantedScope === undefined ? {} : { scope: grantedScope }) }));
      return Promise.reject(new Error("Unexpected request"));
    });
    const input = { issuer: "https://example.test", scope: requestedScope };
    const result = mode === "device"
      ? await loginWithDevice(input, { fetcher, now: Date.now, onVerification: (): void => undefined })
      : await loginWithBrowser(input, { fetcher, now: Date.now, launchBrowser: (): Promise<void> => Promise.resolve(),
        openCallback: () => Promise.resolve({ redirectUri: "http://127.0.0.1:43123/callback",
          awaitCode: (): Promise<string> => Promise.resolve("synthetic-code"), close: (): Promise<void> => Promise.resolve() }) });
    assert.equal(result.credentials.scope, grantedScope ?? requestedScope);
    assert.equal(fetcher.mock.callCount(), mode === "device" ? 4 : 3);
  }))));
