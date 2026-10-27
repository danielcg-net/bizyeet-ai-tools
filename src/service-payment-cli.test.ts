import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { run } from "./cli.js";
import type { readServicePayments } from "./agent-client.js";

const forbidden = (): never => { throw new Error("Unexpected operation"); };
const credentials = Object.freeze({ profile: { issuer: "https://example.test", clientId: "client" }, accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: "2099-01-01", scope: "customers.read payments.read" });
const storage = { readCredentials: (): Promise<Readonly<{ default: typeof credentials }>> => Promise.resolve({ default: credentials }), saveCredentials: forbidden, removeCredentials: forbidden };
const runtime = { loginBrowser: forbidden, loginDevice: forbidden, listCustomers: forbidden, getCustomer: forbidden, revoke: forbidden };
type PaymentInput = Omit<Parameters<typeof readServicePayments>[0], "fetcher" | "metadata" | "now">;

void test("service payment CLI forwards one bound service and public filters", async () => {
  const read = mock.fn((input: PaymentInput) => {
    assert.equal(input.resourceId, "opaque-service");
    assert.deepEqual(input.options, { limit: 5, fields: ["amount", "status"], status: "sent", sort: "amount" });
    return Promise.resolve({ credentials, response: { data: { items: [], total: 0 }, meta: { contract_version: "v1", next_cursor: null } } });
  });
  const result = await run(["services", "payments", "opaque-service", "--limit", "5", "--fields", "amount,status", "--status", "sent", "--sort", "amount"], storage, { ...runtime, readServicePayments: read });
  assert.equal(result.exitCode, 0);
  assert.equal(read.mock.callCount(), 1);
});

void test("service payment CLI rejects private fields and malformed filters before credentials", async () => {
  const readCredentials = mock.fn(forbidden);
  await Promise.all([["opaque-service", "--fields", "service"], ["opaque-service", "--fields", "customer"],
    ["opaque-service", "--limit", "101"], ["opaque-service", "--status", "draft"],
    ["opaque-service", "--limit", "1", "--limit", "2"], ["opaque-service", "--tenant-id", "other"]].map(async (args) => {
    assert.equal((await run(["services", "payments", ...args], { ...storage, readCredentials }, runtime)).exitCode, 2);
  }));
  assert.equal(readCredentials.mock.callCount(), 0);
});
