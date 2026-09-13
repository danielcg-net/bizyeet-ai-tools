/** Public summary descriptor; exact parity with the canonical server is tested. */
import { paymentSummaryRanges, paymentSummaryDatePattern } from "./payment-summary-contract.js";

const date = Object.freeze({ type: "string", pattern: paymentSummaryDatePattern });
const properties = Object.freeze({
  api_version: Object.freeze({ type: "string", const: "v1" }),
  range: Object.freeze({ type: "string", enum: paymentSummaryRanges, default: "month" }),
  start_date: date, end_date: date,
});

export const paymentSummaryMcpTool = Object.freeze({
  name: "bizyeet_payments_received_summary",
  title: "Summarize received payments",
  description: "Read gross collected incoming receipts grouped by currency, not net revenue. Uses the tenant timezone and inclusive custom dates; output includes exclusive UTC end, source and read-completion time. Never combine currencies. Legacy default-currency groups are labelled. Unsupported providers return an error.",
  inputSchema: Object.freeze({ type: "object", properties, required: Object.freeze(["api_version"]), additionalProperties: false,
    allOf: Object.freeze([Object.freeze({
      if: Object.freeze({ properties: Object.freeze({ range: Object.freeze({ const: "custom" }) }), required: Object.freeze(["range"]) }),
      then: Object.freeze({ required: Object.freeze(["start_date", "end_date"]) }),
      else: Object.freeze({ not: Object.freeze({ anyOf: Object.freeze([Object.freeze({ required: Object.freeze(["start_date"]) }), Object.freeze({ required: Object.freeze(["end_date"]) })]) }) }),
    })]),
  }),
  outputSchema: Object.freeze({ type: "object", properties: Object.freeze({
    data: Object.freeze({ type: "object", required: Object.freeze(["label", "currencies", "period", "source", "start", "end"]) }),
    meta: Object.freeze({ type: "object", properties: Object.freeze({ contract_version: Object.freeze({ type: "string", const: "v1" }) }), required: Object.freeze(["contract_version"]) }),
  }), required: Object.freeze(["data", "meta"]) }),
  securitySchemes: Object.freeze([Object.freeze({ type: "oauth2" as const, scopes: Object.freeze(["payments.read"] as const) })]),
  annotations: Object.freeze({ readOnlyHint: true as const, destructiveHint: false as const, idempotentHint: true as const, openWorldHint: false as const }),
});
