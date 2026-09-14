import { taxReportRanges, taxReportAuthorities, taxReportEntryTypes, taxReportFields } from "./tax-report-contract.js";
import { paymentSummaryDatePattern } from "./payment-summary-contract.js";

const date = Object.freeze({ type: "string", pattern: paymentSummaryDatePattern });
const object = Object.freeze({ type: "object" });
const version = Object.freeze({ type: "string", const: "v1" });

/** Public descriptor for the canonical OAuth tax report, verified against the server in integration tests. */
export const taxReportMcpTool = Object.freeze({
  name: "bizyeet_reports_taxes", title: "Read tax collection report",
  description: "Read the current tenant's immutable tax ledger as a tenant administrator. Amounts use integer minor units and separate currency totals. Month means month-to-date; 30d means thirty calendar days. Custom dates include both calendar dates in the tenant timezone. This is not a filing-ready tax return. Private reason and registration fields require explicit selection.",
  inputSchema: Object.freeze({ type: "object", required: Object.freeze(["api_version"]), additionalProperties: false, properties: Object.freeze({
    api_version: version, range: Object.freeze({ type: "string", enum: taxReportRanges }),
    start_date: date, end_date: date, authority: Object.freeze({ type: "string", enum: taxReportAuthorities }),
    province: Object.freeze({ type: "string", pattern: "^[A-Z]{2}$" }), currency: Object.freeze({ type: "string", pattern: "^[A-Z]{3}$" }),
    entry_type: Object.freeze({ type: "string", enum: taxReportEntryTypes }),
    page: Object.freeze({ type: "integer", minimum: 1, maximum: 1_000_000 }), page_size: Object.freeze({ type: "integer", minimum: 1, maximum: 100 }),
    fields: Object.freeze({ type: "array", items: Object.freeze({ type: "string", enum: taxReportFields }), minItems: 1, maxItems: 14, uniqueItems: true }),
  }),
  if: Object.freeze({ required: Object.freeze(["range"]), properties: Object.freeze({ range: Object.freeze({ const: "custom" }) }) }),
  then: Object.freeze({ required: Object.freeze(["start_date", "end_date"]) }),
  else: Object.freeze({ not: Object.freeze({ anyOf: Object.freeze([
    Object.freeze({ required: Object.freeze(["start_date"]) }), Object.freeze({ required: Object.freeze(["end_date"]) }),
  ]) }) }),
  }),
  outputSchema: Object.freeze({ type: "object", required: Object.freeze(["data", "meta"]), properties: Object.freeze({
    data: Object.freeze({ type: "object", required: Object.freeze(["items", "totals", "total"]), properties: Object.freeze({
      items: Object.freeze({ type: "array", items: object, maxItems: 100 }), totals: Object.freeze({ type: "array", items: object }), total: Object.freeze({ type: "integer", minimum: 0 }),
    }) }),
    meta: Object.freeze({ type: "object", required: Object.freeze(["contract_version", "period", "source", "filing_ready"]), properties: Object.freeze({
      contract_version: version, period: object, source: object, filing_ready: Object.freeze({ type: "boolean", const: false }),
    }) }),
  }) }),
  securitySchemes: Object.freeze([Object.freeze({ type: "oauth2" as const, scopes: Object.freeze(["reports.read"] as const) })]),
  annotations: Object.freeze({ readOnlyHint: true as const, destructiveHint: false as const, idempotentHint: true as const, openWorldHint: false as const }),
});
