import { expenseDatePattern, expenseReadFields, expenseSortFields } from "./expense-contract.js";

const version = Object.freeze({ type: "string", const: "v1" });
const handle = Object.freeze({ type: "string", minLength: 1, maxLength: 512 });
const fields = Object.freeze({ type: "array", minItems: 1, maxItems: expenseReadFields.length, uniqueItems: true, items: Object.freeze({ type: "string", enum: expenseReadFields }) });
const date = Object.freeze({ type: "string", pattern: expenseDatePattern, description: "Inclusive local incurred date, YYYY-MM-DD." });
const annotations = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const);
const securitySchemes = Object.freeze([Object.freeze({ type: "oauth2", scopes: Object.freeze(["expenses.read"] as const) } as const)]);
const output = (list: boolean): Readonly<Record<string, unknown>> => Object.freeze({ type: "object", required: Object.freeze(["data", "meta"]), properties: Object.freeze({
  data: list ? Object.freeze({ type: "object", required: Object.freeze(["items", "total"]), properties: Object.freeze({ items: Object.freeze({ type: "array", maxItems: 100, items: Object.freeze({ type: "object", required: Object.freeze(["id"]) }) }), total: Object.freeze({ type: "integer", minimum: 0 }) }) }) : Object.freeze({ type: "object", required: Object.freeze(["id"]) }),
  meta: Object.freeze({ type: "object", required: Object.freeze(["contract_version", ...(list ? ["next_cursor"] : [])]), properties: Object.freeze({ contract_version: version, ...(list ? { next_cursor: Object.freeze({ type: Object.freeze(["string", "null"]), minLength: 32, maxLength: 128 }) } : {}) }) }),
}) });

/** Public descriptors mirror the server's recorded-expense-only OAuth tools. */
export const expenseMcpTools = Object.freeze([
  Object.freeze({ name: "bizyeet_expenses_list", title: "List expenses", description: "Read a bounded page of recorded operating expenses. This read never creates scheduled occurrences or changes financial records.", annotations, securitySchemes,
    inputSchema: Object.freeze({ type: "object", required: Object.freeze(["api_version"]), additionalProperties: false, properties: Object.freeze({ api_version: version, fields, page_size: Object.freeze({ type: "integer", minimum: 1, maximum: 100 }), cursor: Object.freeze({ type: "string", minLength: 32, maxLength: 128 }), search: Object.freeze({ type: "string", maxLength: 120 }), sort: Object.freeze({ type: "string", enum: expenseSortFields }), dir: Object.freeze({ type: "string", enum: Object.freeze(["asc", "desc"]) }), status: Object.freeze({ type: "string", enum: Object.freeze(["due", "paid", "skipped"]) }), category: Object.freeze({ type: "string", maxLength: 100 }), currency: Object.freeze({ type: "string", pattern: "^[A-Z]{3}$" }), start: date, end: date }) }), outputSchema: output(true),
  }),
  Object.freeze({ name: "bizyeet_expenses_get", title: "Get expense", description: "Read one recorded expense by its opaque BizYeet ID.", annotations, securitySchemes, inputSchema: Object.freeze({ type: "object", required: Object.freeze(["api_version", "id"]), additionalProperties: false, properties: Object.freeze({ api_version: version, fields, id: handle }) }), outputSchema: output(false) }),
] as const);
