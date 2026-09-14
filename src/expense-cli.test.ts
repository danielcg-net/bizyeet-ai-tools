import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { run } from "./cli.js";
import type { AgentResult } from "./agent-client.js";
import type { ExpenseListOptions } from "./expense-contract.js";

const forbidden = (): never => { throw new Error("Unexpected operation"); };
const credentials = { profile: { issuer: "https://example.test", clientId: "public-client" }, accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: "2099-01-01", scope: "expenses.read" };
const storage = { readCredentials: (): Promise<Readonly<{ default: typeof credentials }>> => Promise.resolve({ default: credentials }), saveCredentials: forbidden, removeCredentials: forbidden };
const runtime = { loginBrowser: forbidden, loginDevice: forbidden, listCustomers: forbidden, getCustomer: forbidden, revoke: forbidden };
await test("expense CLI forwards calendar filters without provider selection", async () => {
  const listExpenses = mock.fn((input: Readonly<{ options: ExpenseListOptions }>): Promise<AgentResult> => {
    assert.deepEqual(input.options, { page_size: 2, fields: ["amount", "currency"], currency: "CAD", start_date: "2026-09-01", end_date: "2026-09-01" });
    return Promise.resolve({ credentials, response: { data: { items: [], total: 0 } } });
  });
  const result = await run(["expenses", "list", "--limit", "2", "--fields", "amount,currency", "--currency", "CAD", "--start-date", "2026-09-01", "--end-date", "2026-09-01"], storage, { ...runtime, listExpenses });
  assert.equal(result.exitCode, 0);
  assert.equal(listExpenses.mock.callCount(), 1);
  assert.doesNotMatch(result.message, /synthetic-access|synthetic-refresh/u);
});
await Promise.all([
  ["list", "--fields", "id,,amount"], ["list", "--fields", "id,id"], ["list", "--fields", ""],
  ["list", "--tenant-id", "other"], ["list", "--start-date", "2026-02-29"],
  ["list", "--currency", "CAD", "--currency", "USD"], ["list", "--limit", "101"],
  ["get", "id", "--status", "paid"], ["get", "id", "--fields", "tenant_id"],
].map((args, index) => test(`expense argv fails before credentials ${String(index)}`, async () => {
  const readCredentials = mock.fn(forbidden);
  assert.equal((await run(["expenses", ...args], { ...storage, readCredentials }, runtime)).exitCode, 2);
  assert.equal(readCredentials.mock.callCount(), 0);
})));
await test("expense get preserves option-shaped identity after separator", async () => {
  const getExpense = mock.fn((input: Readonly<{ resourceId: string }>): Promise<AgentResult> => {
    assert.equal(input.resourceId, "--opaque-id");
    return Promise.resolve({ credentials, response: { data: { id: input.resourceId } } });
  });
  assert.equal((await run(["expenses", "get", "--", "--opaque-id"], storage, { ...runtime, getExpense })).exitCode, 0);
  assert.equal(getExpense.mock.callCount(), 1);
});

await test("equals-form expense options preserve every filter and selected field", async () => {
  const cursor = "a".repeat(43);
  const listExpenses = mock.fn((input: Readonly<{ options: ExpenseListOptions }>): Promise<AgentResult> => {
    assert.deepEqual(input.options, { page_size: 1, fields: ["notes"], cursor, search: "target", sort: "amount", dir: "asc", status: "paid", category: "hosting", currency: "CAD", schedule: "opaque", start_date: "2026-09-01", end_date: "2026-09-02" });
    return Promise.resolve({ credentials, response: { data: { items: [] } } });
  });
  const args = ["expenses", "list", "--limit=1", "--fields=notes", `--cursor=${cursor}`, "--search=target", "--sort=amount", "--dir=asc", "--status=paid", "--category=hosting", "--currency=CAD", "--schedule=opaque", "--start-date=2026-09-01", "--end-date=2026-09-02"];
  assert.equal((await run(args, storage, { ...runtime, listExpenses })).exitCode, 0);
  assert.equal(listExpenses.mock.callCount(), 1);
});
await test("equals-form exact fields never fall back to the default projection", async () => {
  const getExpense = mock.fn((input: Readonly<{ options?: Readonly<{ fields?: readonly string[] }> }>): Promise<AgentResult> => {
    assert.deepEqual(input.options, { fields: ["notes"] });
    return Promise.resolve({ credentials, response: { data: { id: "opaque", notes: "selected" } } });
  });
  assert.equal((await run(["expenses", "get", "opaque", "--fields=notes"], storage, { ...runtime, getExpense })).exitCode, 0);
});
