import assert from "node:assert/strict";
import test from "node:test";
import { registerPublicClient } from "./oauth.js";

const metadata = { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token", registration_endpoint: "https://example.test/register" };
const assigned = (scope: unknown): Response => new Response(JSON.stringify({ client_id: "test-client", scope,
  token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"], response_types: ["code"] }));

await Promise.all([false, true].map((deviceGrant) => test(`requests and verifies exact registration scopes: device=${String(deviceGrant)}`, async () => {
  const result = await registerPublicClient({ metadata, deviceGrant, scope: "payments.read customers.read", redirectUri: "http://127.0.0.1:1234/callback",
    fetcher: (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected registration JSON");
      const request: unknown = JSON.parse(init.body);
      assert.ok(typeof request === "object" && request !== null && "scope" in request);
      assert.equal(request.scope, "customers.read payments.read");
      return Promise.resolve(assigned("payments.read customers.read"));
    } });
  assert.equal(result.clientId, "test-client");
})));

await Promise.all([undefined, null, "", "customers.write", "customers.read customers.write", "customers.read\n", ["customers.read"]].map((scope, index) =>
  test(`rejects missing, malformed or widened assigned scopes ${String(index)}`, async () => {
    await assert.rejects(registerPublicClient({ metadata, scope: "customers.read", redirectUri: "http://127.0.0.1:1234/callback",
      fetcher: () => Promise.resolve(assigned(scope)) }), /exactly the requested scopes/u);
  })));
