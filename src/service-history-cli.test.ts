import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { run } from "./cli.js";
import type { readServiceHistory } from "./agent-client.js";

const forbidden = (): never => { throw new Error("Unexpected operation"); };
const credentials = Object.freeze({ profile: { issuer: "https://example.test", clientId: "client" }, accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: "2099-01-01", scope: "customers.read" });
const storage = { readCredentials: (): Promise<Readonly<{ default: typeof credentials }>> => Promise.resolve({ default: credentials }), saveCredentials: forbidden, removeCredentials: forbidden };
const runtime = { loginBrowser: forbidden, loginDevice: forbidden, listCustomers: forbidden, getCustomer: forbidden, revoke: forbidden };
type HistoryInput = Omit<Parameters<typeof readServiceHistory>[0], "fetcher" | "metadata" | "now">;

void test("service history CLI forwards one bound service and cursor", async () => {
  const read = mock.fn((input: HistoryInput) => {
    assert.equal(input.resourceId, "opaque-service");
    assert.deepEqual(input.options, { limit: 5, cursor: "opaque-cursor" });
    return Promise.resolve({ credentials, response: { data: { items: [], total: 0 }, meta: { contract_version: "v1", next_cursor: null } } });
  });
  const result = await run(["services", "history", "opaque-service", "--limit", "5", "--cursor", "opaque-cursor"], storage, { ...runtime, readServiceHistory: read });
  assert.equal(result.exitCode, 0);
  assert.equal(read.mock.callCount(), 1);
});

void test("service history CLI rejects malformed arguments before credentials", async () => {
  const readCredentials = mock.fn(forbidden);
  await Promise.all([["opaque-service", "--limit", "101"], ["opaque-service", "--limit", "1.5"],
    ["opaque-service", "--cursor", ""], ["opaque-service", "--fields", "private_note"]].map(async (args) => {
    assert.equal((await run(["services", "history", ...args], { ...storage, readCredentials }, runtime)).exitCode, 2);
  }));
  assert.equal(readCredentials.mock.callCount(), 0);
});
