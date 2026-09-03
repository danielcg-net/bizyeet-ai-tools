import assert from "node:assert/strict";
import test from "node:test";
import { mcpInstructions, mcpReadTools } from "./mcp-contract.js";

void test("publishes only bounded, read-only MCP tools", () => {
  assert.deepEqual(mcpReadTools.map((tool) => tool.name), ["bizyeet_customers_list", "bizyeet_customers_get", "bizyeet_leads_list", "bizyeet_leads_get"]);
  assert.ok(mcpReadTools.every((tool) => Object.isFrozen(tool.annotations)));
  assert.deepEqual(mcpReadTools[0]?.annotations, { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true });
  assert.ok(mcpReadTools.every((tool) => Object.isFrozen(tool.inputSchema)));
  assert.ok(mcpReadTools.every((tool) => "api_version" in tool.inputSchema.properties));
  assert.ok(mcpReadTools.every((tool) => "fields" in tool.inputSchema.properties));
  assert.match(JSON.stringify(mcpReadTools), /"page_size"/u);
});

void test("keeps essential OAuth and approval rules in the MCP instruction prefix", () => {
  assert.ok(mcpInstructions.length <= 512);
  assert.match(mcpInstructions, /OAuth-authorized/u);
  assert.match(mcpInstructions, /approval receipt/u);
  assert.doesNotMatch(mcpInstructions, /bearer token|API key setup/u);
});
