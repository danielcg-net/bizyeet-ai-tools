import assert from "node:assert/strict";
import { test } from "node:test";
import { expenseScheduleMcpTools } from "./expense-schedule-mcp.js";
import { expenseScheduleFields, expenseScheduleFrequencies, expenseScheduleSortFields } from "./expense-schedule-contract.js";

await test("schedule MCP list exposes only canonical bounded filters", () => {
  const [list] = expenseScheduleMcpTools;
  assert.deepEqual(Object.keys(list.inputSchema.properties).sort(), ["active", "api_version", "category", "currency", "cursor", "dir", "fields", "frequency", "page_size", "search", "sort"]);
  assert.equal(list.inputSchema.additionalProperties, false);
  assert.deepEqual(list.inputSchema.required, ["api_version"]);
  assert.deepEqual(list.inputSchema.properties.active.enum, ["0", "1"]);
  assert.deepEqual(list.inputSchema.properties.frequency.enum, expenseScheduleFrequencies);
  assert.deepEqual(list.inputSchema.properties.sort.enum, expenseScheduleSortFields);
  assert.equal(list.inputSchema.properties.page_size.maximum, 100);
});

await test("schedule MCP preserves explicit fields and read-only OAuth scope", () => {
  const [, get] = expenseScheduleMcpTools;
  assert.deepEqual(get.inputSchema.required, ["api_version", "id"]);
  assert.deepEqual(Object.keys(get.inputSchema.properties).sort(), ["api_version", "fields", "id"]);
  expenseScheduleMcpTools.forEach((tool) => {
    assert.deepEqual(tool.securitySchemes, [{ type: "oauth2", scopes: ["expenses.read"] }]);
    assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    assert.deepEqual(tool.inputSchema.properties.fields.items.enum, expenseScheduleFields);
    assert.equal(tool.inputSchema.properties.fields.uniqueItems, true);
    assert.match(tool.description, /Notes require explicit field selection|notes require explicit field selection/u);
  });
});

await test("schedule metadata requires persisted source without an invented query period", () => {
  const [list, get] = expenseScheduleMcpTools;
  const schema = JSON.parse(JSON.stringify(list.outputSchema)) as { readonly properties: { readonly meta: { readonly required: readonly string[]; readonly properties: Readonly<Record<string, unknown>> } } };
  assert.deepEqual(schema.properties.meta.required, ["contract_version", "source", "next_cursor"]);
  assert.equal(Object.hasOwn(schema.properties.meta.properties, "period"), false);
  assert.match(JSON.stringify(schema.properties.meta.properties.source), /"status".*"not_evaluated"/u);
  assert.equal(JSON.stringify(get.outputSchema).includes('"period"'), false);
});
