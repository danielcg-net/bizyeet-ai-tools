import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";
import { expenseScheduleFields, validExpenseScheduleListOptions } from "./expense-schedule-contract.js";
import { expenseScheduleMcpTools } from "./expense-schedule-mcp.js";
import { expenseScheduleResponse } from "./expense-schedule-response.js";

const id = "expsch1.fingerprint.schedule";
const row = Object.freeze({ id, name: "Monthly fuel", category: "Transport", vendor: null, amount: "12.50", currency: "CAD",
  frequency: "monthly", interval_count: 1, start_date: "2026-01-01", end_date: null, active: 1, generated_count: 0,
  last_generated_period_start: null, created_at: "2026-01-01 00:00:00", updated_at: "2026-01-01 00:00:00", notes: "private" });
const envelope = (data: unknown): Readonly<Record<string, unknown>> => ({ data, meta: { contract_version: "v1", next_cursor: null, request_id: "safe-reference", tenant_id: "private" } });

await test("schedule descriptors and query expose only read-only expense scope", () => {
  assert.equal(expenseScheduleFields.includes("notes" as typeof expenseScheduleFields[number]), false);
  assert.equal(validExpenseScheduleListOptions({ fields: ["notes"] }), false);
  assert.deepEqual(expenseScheduleMcpTools.map((tool) => tool.name), ["bizyeet_expense_schedules_list", "bizyeet_expense_schedules_get"]);
  assert.equal(expenseScheduleMcpTools.every((tool) => tool.securitySchemes[0]?.scopes[0] === "expenses.read" && tool.annotations.readOnlyHint), true);
  assert.doesNotMatch(JSON.stringify(expenseScheduleMcpTools), /"notes"/u);
});

await test("schedule projection excludes notes and private metadata", () => {
  const result = expenseScheduleResponse(envelope({ items: [row], total: 1 }), {}, null);
  assert.doesNotMatch(JSON.stringify(result), /private|notes|tenant_id/u);
  assert.deepEqual(Object.keys((result?.data as { items: readonly Record<string, unknown>[] }).items[0] ?? {}), [...expenseScheduleFields]);
  assert.equal(expenseScheduleResponse(envelope({ ...row, generated_count: "0" }), {}, id), undefined);
  assert.equal(expenseScheduleResponse(envelope({ ...row, active: true }), {}, id), undefined);
});

await test("schedule list and get use canonical OAuth read endpoint without policy overrides", async () => {
  const request = mock.fn((url: string, init: RequestInit) => {
    const address = new URL(url);
    assert.ok(["/api/agent/expense-schedules", `/api/agent/expense-schedules/${id}`].includes(address.pathname));
    assert.equal(init.method, "GET");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer synthetic-token");
    return Promise.resolve(Response.json(envelope(address.pathname.endsWith(`/${id}`) ? row : { items: [row], total: 1 })));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("synthetic-token"), request });
  const listed = await client.list("expense-schedules", { page_size: 10, frequency: "monthly", active: "1", fields: ["name", "amount"] });
  assert.equal(listed.status, 200);
  assert.deepEqual(Object.fromEntries(new URL(request.mock.calls[0]?.arguments[0] ?? "https://invalid.example").searchParams), {
    api_version: "v1", limit: "10", fields: "name,amount", frequency: "monthly", active: "1",
  });
  assert.deepEqual((listed.body as { data: { items: unknown[] } }).data.items, [{ id, name: "Monthly fuel", amount: "12.50" }]);
  const exact = await client.get("expense-schedules", id, { fields: ["name"] });
  assert.equal(exact.status, 200);
  assert.deepEqual((exact.body as { data: unknown }).data, { id, name: "Monthly fuel" });
  assert.equal(request.mock.callCount(), 2);
});

await test("invalid schedule filters are rejected before OAuth or transport", async () => {
  const token = mock.fn(() => Promise.resolve("synthetic-token"));
  const request = mock.fn(() => Promise.resolve(Response.json(envelope({ items: [], total: 0 }))));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token, request });
  assert.equal((await client.list("expense-schedules", { fields: ["notes"] })).status, 400);
  assert.equal((await client.list("expense-schedules", { status: "paid" })).status, 400);
  assert.equal((await client.get("expense-schedules", id, { fields: ["notes"] })).status, 400);
  assert.equal(token.mock.callCount(), 0);
  assert.equal(request.mock.callCount(), 0);
});
