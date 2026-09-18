import assert from "node:assert/strict";
import { test } from "node:test";
import { validExpenseListOptions } from "./expense-contract.js";
import { expenseMcpTools } from "./expense-mcp.js";
import { expenseResponse } from "./expense-response.js";

await test("expense client mirrors the recorded-only server contract", () => {
  assert.equal(validExpenseListOptions({ status: "paid", start: "2026-09-01", end: "2026-09-30", fields: ["amount", "scheduled"] }), true);
  assert.equal(validExpenseListOptions({ notes: true }), false);
  assert.equal(validExpenseListOptions({ schedule: "private" }), false);
  assert.equal(expenseMcpTools.every((tool) => tool.securitySchemes.at(0)?.scopes.at(0) === "expenses.read"), true);
  assert.equal(expenseMcpTools.at(0)?.description.includes("never creates scheduled occurrences"), true);
});

await test("expense response strips unrequested data and accepts no materialization metadata", () => {
  const response = expenseResponse({ data: { items: [{ id: "exp1.fingerprint.expense", amount: "12.50", currency: "CAD", notes: "never public" }], total: 1 }, meta: { contract_version: "v1", next_cursor: null } }, { fields: ["amount", "currency"] }, null);
  assert.deepEqual(response?.data, { items: [{ id: "exp1.fingerprint.expense", amount: "12.50", currency: "CAD" }], total: 1 });
  assert.equal(JSON.stringify(response).includes("never public"), false);
});
