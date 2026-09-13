import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { run } from "./cli.js";
import type { AgentResult, PaymentListOptions } from "./agent-client.js";

const forbidden = (): never => { throw new Error("Unexpected operation"); };
const credentials = { profile: { issuer: "https://example.test", clientId: "public-client" },
  accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: "2099-01-01", scope: "payments.read" };
const storage = { readCredentials: (): Promise<Readonly<{ default: typeof credentials }>> => Promise.resolve({ default: credentials }), saveCredentials: forbidden, removeCredentials: forbidden };
const runtime = { loginBrowser: forbidden, loginDevice: forbidden, listCustomers: forbidden, getCustomer: forbidden, revoke: forbidden };

await Promise.all(["--status", "--date-field", "--start", "--end", "--sort", "--dir"].map((option) => test(`repeated payment ${option} is invalid input`, async () => {
  const readCredentials = mock.fn(forbidden);
  const result = await run(["payments", "list", option, "value", option, "value"], { ...storage, readCredentials }, runtime);
  assert.equal(result.exitCode, 2);
  assert.match(result.message, /invalid_request/u);
  assert.equal(readCredentials.mock.callCount(), 0);
})));

await test("payment list forwards explicit filters without choosing a provider", async () => {
  const listPayments = mock.fn((input: Readonly<{ options: PaymentListOptions }>): Promise<AgentResult> => {
    assert.deepEqual(input.options, { limit: 2, fields: ["id", "amount"], status: "received", date_field: "received_at", start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z", sort: "amount", dir: "asc" });
    return Promise.resolve({ credentials, response: { data: { items: [], total: 0 }, meta: { contract_version: "v1", next_cursor: null } } });
  });
  const result = await run(["payments", "list", "--limit", "2", "--fields", "id,amount", "--status", "received", "--date-field", "received_at", "--start", "2026-09-01T00:00:00Z", "--end", "2026-10-01T00:00:00Z", "--sort", "amount", "--dir", "asc"], storage, { ...runtime, listPayments });
  assert.equal(result.exitCode, 0);
  assert.equal(listPayments.mock.callCount(), 1);
  assert.doesNotMatch(result.message, /synthetic-access|synthetic-refresh/u);
});

await Promise.all([
  ["list", "--fields", "customer_email"], ["list", "--sort", "customer_business"],
  ["list", "--status", "paid"], ["list", "--start", "2026-02-30T00:00:00Z"],
  ["list", "--tenant-id", "other"], ["get", "pay1.opaque.id", "--fields", "provider_ref"],
].map((args) => test(`payment CLI rejects invalid arguments before credentials: ${args.join(" ")}`, async () => {
  const readCredentials = mock.fn(forbidden);
  const result = await run(["payments", ...args], { ...storage, readCredentials }, runtime);
  assert.equal(result.exitCode, 2);
  assert.equal(readCredentials.mock.callCount(), 0);
})));

await test("payment get preserves a literal option-shaped ID and projection", async () => {
  const getPayment = mock.fn((input: Readonly<{ resourceId: string; options?: Readonly<{ fields?: readonly string[] }> }>): Promise<AgentResult> => {
    assert.equal(input.resourceId, "--opaque-id");
    assert.deepEqual(input.options, { fields: ["id", "amount"] });
    return Promise.resolve({ credentials, response: { data: { id: input.resourceId, amount: 12 } } });
  });
  const result = await run(["payments", "get", "--fields", "id,amount", "--", "--opaque-id"], storage, { ...runtime, getPayment });
  assert.equal(result.exitCode, 0);
  assert.equal(getPayment.mock.callCount(), 1);
});
