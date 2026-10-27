import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { run } from "./cli.js";
import type { getExpenseSchedule, listExpenseSchedules } from "./agent-client.js";

const forbidden = (): never => { throw new Error("Unexpected operation"); };
const credentials = Object.freeze({ profile: { issuer: "https://tenant.example", clientId: "client" }, accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: "2099-01-01", scope: "expenses.read" });
const storage = { readCredentials: (): Promise<Readonly<{ default: typeof credentials }>> => Promise.resolve({ default: credentials }), saveCredentials: forbidden, removeCredentials: forbidden };
const runtime = { loginBrowser: forbidden, loginDevice: forbidden, listCustomers: forbidden, getCustomer: forbidden, revoke: forbidden };
type ListInput = Omit<Parameters<typeof listExpenseSchedules>[0], "fetcher" | "metadata" | "now">;
type GetInput = Omit<Parameters<typeof getExpenseSchedule>[0], "fetcher" | "metadata" | "now">;

await test("schedule list forwards bounded filters through the selected OAuth profile", async () => {
  const read = mock.fn((input: ListInput) => {
    assert.deepEqual(input.options, { page_size: 10, fields: ["id", "amount"], frequency: "monthly", active: "1" });
    return Promise.resolve({ credentials, response: { data: { items: [], total: 0 }, meta: { contract_version: "v1", next_cursor: null } } });
  });
  const result = await run(["expenses", "schedules", "list", "--limit", "10", "--fields", "id,amount", "--frequency", "monthly", "--active", "1"], storage, { ...runtime, listExpenseSchedules: read });
  assert.equal(result.exitCode, 0);
  assert.equal(read.mock.callCount(), 1);
});

await test("schedule get preserves opaque identity and field selection", async () => {
  const read = mock.fn((input: GetInput) => {
    assert.equal(input.resourceId, "expsch1.fingerprint.schedule");
    assert.deepEqual(input.options, { fields: ["name"] });
    return Promise.resolve({ credentials, response: { data: { id: input.resourceId, name: "Fuel" }, meta: { contract_version: "v1" } } });
  });
  const result = await run(["expenses", "schedules", "get", "expsch1.fingerprint.schedule", "--fields", "name"], storage, { ...runtime, getExpenseSchedule: read });
  assert.equal(result.exitCode, 0);
  assert.equal(read.mock.callCount(), 1);
});

await test("invalid schedule arguments do not read local credentials", async () => {
  const readCredentials = mock.fn(forbidden);
  await Promise.all([["--fields", "notes"], ["--active", "true"], ["--provider", "local"], ["--frequency", "hourly"]].map(async (args) => {
    const result = await run(["expenses", "schedules", "list", ...args], { ...storage, readCredentials }, runtime);
    assert.equal(result.exitCode, 2);
  }));
  assert.equal(readCredentials.mock.callCount(), 0);
});
