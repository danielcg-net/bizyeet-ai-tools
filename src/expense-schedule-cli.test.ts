import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { run } from "./cli.js";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";
import type { AgentResult } from "./agent-client.js";
import type { ExpenseScheduleListOptions } from "./expense-schedule-contract.js";

const forbidden = (): never => { throw new Error("Unexpected operation"); };
const credentials = { profile: { issuer: "https://example.test", clientId: "public" }, accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: "2099-01-01", scope: "expenses.read" };
const storage = { readCredentials: (): Promise<Readonly<{ default: typeof credentials }>> => Promise.resolve({ default: credentials }), saveCredentials: forbidden, removeCredentials: forbidden };
const runtime = { loginBrowser: forbidden, loginDevice: forbidden, listCustomers: forbidden, getCustomer: forbidden, revoke: forbidden };
await Promise.all([["--active", "0", "--frequency", "monthly"], ["--active=0", "--frequency=monthly"]].map((args) => test(`schedule filters forward identically ${args.join(" ")}`, async () => {
  const listExpenseSchedules = mock.fn((input: Readonly<{ options: ExpenseScheduleListOptions }>): Promise<AgentResult> => {
    assert.deepEqual(input.options, { page_size: 25, active: "0", frequency: "monthly" });
    return Promise.resolve({ credentials, response: { data: { items: [] } } });
  });
  assert.equal((await run(["expenses", "schedules", "list", ...args], storage, { ...runtime, listExpenseSchedules })).exitCode, 0);
  assert.equal(listExpenseSchedules.mock.callCount(), 1);
})));
await Promise.all([["--active=true"], ["--active=0", "--active", "1"], ["--start-date=2026-01-01"], ["--fields=schedule_id"], ["--provider=d1"], ["--fields=id,id"]].map((args) => test(`invalid schedule argv ${args.join(" ")}`, async () => {
  const readCredentials = mock.fn(forbidden);
  assert.equal((await run(["expenses", "schedules", "list", ...args], { ...storage, readCredentials }, runtime)).exitCode, 2);
  assert.equal(readCredentials.mock.callCount(), 0);
})));
await test("schedule exact read preserves opaque identity and notes-only projection", async () => {
  const getExpenseSchedule = mock.fn((input: Readonly<{ resourceId: string; options?: Readonly<{ fields?: readonly string[] }> }>): Promise<AgentResult> => {
    assert.equal(input.resourceId, "--opaque");
    assert.deepEqual(input.options, { fields: ["notes"] });
    return Promise.resolve({ credentials, response: { data: { id: input.resourceId } } });
  });
  assert.equal((await run(["expenses", "schedules", "get", "--fields=notes", "--", "--opaque"], storage, { ...runtime, getExpenseSchedule })).exitCode, 0);
});
await test("schedule transport uses canonical OAuth endpoint and preserves active=0", async () => {
  const request = mock.fn((url: string, init: RequestInit) => {
    assert.equal(new URL(url).pathname, "/api/agent/expense-schedules");
    assert.equal(new URL(url).searchParams.get("active"), "0");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer synthetic");
    return Promise.resolve(Response.json({ data: { items: [], total: 0 }, meta: { contract_version: "v1", next_cursor: null,
      source: { provider: "d1", view: "persisted", readCompletedAt: "2026-09-13T00:00:00.000Z", materialization: { performed: false, status: "not_evaluated" } } } }));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("synthetic"), request });
  assert.equal((await client.list("expense-schedules", { active: "0" })).status, 200);
  assert.equal((await client.list("expenses", { active: "0" })).status, 400);
  assert.equal(request.mock.callCount(), 1);
});
