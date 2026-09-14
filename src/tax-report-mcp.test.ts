import assert from "node:assert/strict";
import { test } from "node:test";
import { taxReportMcpTool } from "./tax-report-mcp.js";
import { taxReportRanges } from "./tax-report-contract.js";

void test("tax descriptor preserves bounded OAuth-only admin-report semantics", () => {
  assert.deepEqual(taxReportMcpTool.securitySchemes, [{ type: "oauth2", scopes: ["reports.read"] }]);
  assert.deepEqual(taxReportMcpTool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.equal(taxReportMcpTool.inputSchema.additionalProperties, false);
  assert.deepEqual(taxReportMcpTool.inputSchema.properties.range.enum, taxReportRanges);
  assert.equal(taxReportMcpTool.inputSchema.properties.page_size.maximum, 100);
  assert.equal(taxReportMcpTool.outputSchema.properties.meta.properties.filing_ready.const, false);
  assert.match(taxReportMcpTool.description, /tenant administrator/u);
});
