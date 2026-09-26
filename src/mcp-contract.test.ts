import assert from "node:assert/strict";
import test from "node:test";
import { mcpInstructions, mcpReadTools } from "./mcp-contract.js";

void test("publishes only bounded, read-only MCP tools", () => {
  assert.deepEqual(mcpReadTools.map((tool) => tool.name), ["bizyeet_customers_list", "bizyeet_customers_get", "bizyeet_leads_list", "bizyeet_leads_get", "bizyeet_customers_communications", "bizyeet_leads_communications", "bizyeet_quotes_communications", "bizyeet_services_communications", "bizyeet_payments_communications", "bizyeet_payments_list", "bizyeet_payments_get", "bizyeet_payments_list_with_relationships", "bizyeet_payments_get_with_relationships", "bizyeet_payments_received_summary", "bizyeet_reports_taxes", "bizyeet_expenses_list", "bizyeet_expenses_get", "bizyeet_bookings_upcoming", "bizyeet_services_list", "bizyeet_quotes_list", "bizyeet_quotes_get", "bizyeet_services_get", "bizyeet_catalog_list", "bizyeet_catalog_get"]);
  assert.ok(mcpReadTools.every((tool) => Object.isFrozen(tool.annotations)));
  assert.deepEqual(mcpReadTools[0].annotations, { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true });
  assert.ok(mcpReadTools.every((tool) => Object.isFrozen(tool.inputSchema)));
  assert.ok(mcpReadTools.every((tool) => "api_version" in tool.inputSchema.properties));
  assert.ok(mcpReadTools.filter((tool) => !tool.name.endsWith("_communications") && !["bizyeet_payments_received_summary", "bizyeet_bookings_upcoming"].includes(tool.name)).every((tool) => "fields" in tool.inputSchema.properties));
  assert.ok(mcpReadTools.every((tool) => tool.inputSchema.required.includes("api_version")));
  assert.ok(mcpReadTools.every((tool) => tool.securitySchemes[0]?.scopes[0] === (tool.name.startsWith("bizyeet_payments_") ? "payments.read" : tool.name.startsWith("bizyeet_expense") ? "expenses.read" : tool.name === "bizyeet_reports_taxes" ? "reports.read" : tool.name === "bizyeet_bookings_upcoming" ? "bookings.read" : "customers.read")));
  assert.ok(mcpReadTools.every((tool) => Object.isFrozen(tool.outputSchema)));
  assert.match(JSON.stringify(mcpReadTools), /"page_size"/u);
});

void test("payment MCP schema bounds fields and keeps relationship authorization explicit", () => {
  const list = mcpReadTools[9];
  assert.equal(list.inputSchema.additionalProperties, false);
  assert.equal(list.inputSchema.properties.page_size.maximum, 100);
  assert.equal(list.inputSchema.properties.search.maxLength, 120);
  assert.deepEqual(list.inputSchema.properties.sort.enum, ["created_at", "sent_at", "received_at", "status", "amount"]);
  assert.deepEqual(list.inputSchema.properties.status.enum, ["sent", "received"]);
  assert.equal(new RegExp(list.inputSchema.properties.start.pattern, "u").test("yesterday"), false);
  assert.equal(new RegExp(list.inputSchema.properties.end.pattern, "u").test("2026-09-01"), false);
  assert.equal(new RegExp(list.inputSchema.properties.start.pattern, "u").test("2026-09-01T00:00:00Z"), true);
  assert.equal(new RegExp(list.inputSchema.properties.end.pattern, "u").test("2026-09-01T00:00:00.123Z"), true);
  ["2026-02-30T00:00:00Z", "2026-09-01T24:00:00Z", "1900-02-29T00:00:00Z", "2100-02-29T00:00:00Z", "2026-04-31T00:00:00Z", "2026-01-01T00:60:00Z"].forEach((value) => {
    assert.equal(new RegExp(list.inputSchema.properties.start.pattern, "u").test(value), false, value);
  });
  ["2000-02-29T00:00:00Z", "2024-02-29T23:59:59.999Z", "2400-02-29T00:00:00Z"].forEach((value) => {
    assert.equal(new RegExp(list.inputSchema.properties.start.pattern, "u").test(value), true, value);
  });
  assert.equal(list.inputSchema.properties.fields.items.enum.some((field) => field === ("customer" as string)), false);
  assert.doesNotMatch(JSON.stringify(list.inputSchema), /customer_email|customer_business|provider_ref|tenant_id/u);
  assert.match(list.description, /relationship tool/u);
  assert.deepEqual(mcpReadTools[11].securitySchemes[0]?.scopes, ["payments.read", "customers.read"]);
  assert.deepEqual(mcpReadTools[12].securitySchemes[0]?.scopes, ["payments.read", "customers.read"]);
  assert.deepEqual(mcpReadTools[11].inputSchema.required, ["api_version", "fields"]);
  assert.deepEqual(mcpReadTools[12].inputSchema.required, ["api_version", "id", "fields"]);
  assert.deepEqual(mcpReadTools[11].inputSchema.properties.fields.contains.enum, ["customer", "service"]);
  assert.deepEqual(mcpReadTools[10].inputSchema.required, ["api_version", "id"]);
});

void test("communication MCP tools advertise bounded metadata-only history with domain scopes", () => {
  ["customers", "leads", "quotes", "services", "payments"].forEach((resource, index) => {
    const tool = mcpReadTools[4 + index] as typeof mcpReadTools[4];
    assert.equal(tool.name, `bizyeet_${resource}_communications`);
    assert.deepEqual(tool.inputSchema.required, ["api_version", "id"]);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.inputSchema.properties.page.maximum, 10000);
    assert.deepEqual(tool.inputSchema.properties.page_size.enum, [10, 20, 50]);
    assert.equal(tool.outputSchema.properties.data.properties.items.maxItems, 50);
    assert.equal(tool.outputSchema.properties.data.properties.items.items.additionalProperties, false);
    assert.deepEqual(tool.outputSchema.properties.data.properties.items.items.required, ["id", "kind", "status"]);
    assert.deepEqual(Object.keys(tool.outputSchema.properties.data.properties.items.items.properties), [
      "id", "kind", "status", "source_type", "recipient_role", "trigger_mode", "from_status", "to_status",
      "last_event", "sent_at", "created_at", "scheduled_at",
    ]);
    assert.deepEqual(tool.outputSchema.properties.meta.required, ["contract_version", "page", "page_size", "total_pages"]);
    assert.deepEqual(tool.securitySchemes[0]?.scopes, [resource === "payments" ? "payments.read" : "customers.read"]);
    assert.match(tool.description, /Excludes message bodies, subjects, recipients and provider identifiers/u);
  });
});

void test("keeps essential OAuth and approval rules in the MCP instruction prefix", () => {
  assert.ok(mcpInstructions.length <= 512);
  assert.match(mcpInstructions, /OAuth-authorized/u);
  assert.match(mcpInstructions, /approval receipt/u);
  assert.doesNotMatch(mcpInstructions, /bearer token|API key setup/u);
});
