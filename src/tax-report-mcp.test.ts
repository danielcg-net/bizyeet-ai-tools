import assert from "node:assert/strict";
import { test } from "node:test";
import { taxReportMcpTool } from "./tax-report-mcp.js";
import { taxReportFields } from "./tax-report-contract.js";

void test("tax MCP schema requires custom dates and forbids dates for other ranges", () => {
  const schema = taxReportMcpTool.inputSchema;
  assert.deepEqual(schema.if, { required: ["range"], properties: { range: { const: "custom" } } });
  assert.deepEqual(schema.then, { required: ["start_date", "end_date"] });
  assert.deepEqual(schema.else, { not: { anyOf: [{ required: ["start_date"] }, { required: ["end_date"] }] } });
  assert.deepEqual(schema.properties.fields.items.enum, taxReportFields);
});

await Promise.all(["yesterday", "2026-02-30", "1900-02-29", "0099-01-01"].map((value) => test(`tax schema rejects invalid calendar date ${value}`, () => {
  assert.equal(new RegExp(taxReportMcpTool.inputSchema.properties.start_date.pattern, "u").test(value), false);
})));

void test("tax schema accepts real leap dates and bounds currency and province codes", () => {
  const properties = taxReportMcpTool.inputSchema.properties;
  assert.equal(new RegExp(properties.end_date.pattern, "u").test("2000-02-29"), true);
  assert.equal(new RegExp(properties.currency.pattern, "u").test("CAD"), true);
  assert.equal(new RegExp(properties.currency.pattern, "u").test("cad"), false);
  assert.equal(new RegExp(properties.province.pattern, "u").test("Alberta"), false);
});
