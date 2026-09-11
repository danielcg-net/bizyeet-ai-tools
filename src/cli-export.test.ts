import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./cli.js";

const credentials = { profile: { issuer: "https://example.test", clientId: "public-client" }, accessToken: "secret-access", refreshToken: "secret-refresh", scope: "customers.read", expiresAt: "2099-01-01" };
const forbidden = (): Promise<never> => Promise.reject(new Error("Unexpected operation"));
const storage = { readCredentials: (): Promise<Readonly<{ default: typeof credentials }>> => Promise.resolve({ default: credentials }), saveCredentials: forbidden, removeCredentials: forbidden };
const baseRuntime = { loginBrowser: forbidden, loginDevice: forbidden, revoke: forbidden, getCustomer: forbidden, listCustomers: forbidden };

await Promise.all(["explicit", "automatic", "inline", "failure"].map((mode) =>
  test(`bounded CLI read output: ${mode}`, async (context) => {
    const response = { data: { items: [{ id: "synthetic", note: mode === "automatic" ? "x".repeat(33_000) : "private-customer-data" }] }, meta: { contract_version: "v1", next_cursor: "opaque-next" } };
    const list = context.mock.fn(() => Promise.resolve({ credentials, response }));
    const exporter = context.mock.fn((serialized: string) => {
      assert.deepEqual(JSON.parse(serialized) as unknown, response);
      assert.doesNotMatch(serialized, /secret-access|secret-refresh/u);
      if (mode === "failure") return Promise.reject(new Error("secret-export-failure"));
      return Promise.resolve({ path: "/private/generated.json", bytes: Buffer.byteLength(serialized) + 1 });
    });
    const result = await run(["customers", "list", ...(["explicit", "failure"].includes(mode) ? ["--export"] : [])], storage,
      { ...baseRuntime, listCustomers: list, exportReadResponse: exporter });
    assert.equal(list.mock.callCount(), 1);
    assert.equal(exporter.mock.callCount(), mode === "inline" ? 0 : 1);
    assert.equal(result.exitCode, mode === "failure" ? 1 : 0);
    if (mode === "inline") assert.deepEqual(JSON.parse(result.message) as unknown, response);
    else {
      assert.doesNotMatch(result.message, /private-customer-data|secret-export-failure|secret-access|secret-refresh|"items"/u);
      assert.ok(result.message.length < 1024);
      if (mode !== "failure") assert.match(result.message, /"next_cursor":"opaque-next"/u);
      else assert.equal(result.stream, "stderr");
    }
  })));

void test("separated opaque export-like IDs are not flags", async (context) => {
  const exporter = context.mock.fn(forbidden);
  const result = await run(["customers", "get", "--", "--export"], storage, { ...baseRuntime, exportReadResponse: exporter,
    getCustomer: (input) => { assert.equal(input.resourceId, "--export"); return Promise.resolve({ credentials, response: { data: { id: input.resourceId } } }); },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(exporter.mock.callCount(), 0);
});

await Promise.all([
  ["customers", "list", "--export", "--export"],
  ["customers", "list", "--export=/tmp/file"],
  ["customers", "get", "synthetic", "--export", "/tmp/file"],
  ["auth", "status", "--export"],
  ["customers", "update", "preview", "synthetic", "--export"],
].map((args) => test(`rejects unsupported export input: ${args.join(" ")}`, async () => {
  const result = await run(args, storage, baseRuntime);
  assert.equal(result.exitCode, 2);
})));
