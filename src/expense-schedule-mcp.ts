import { expenseScheduleFields, expenseScheduleFrequencies, expenseScheduleSortFields } from "./expense-schedule-contract.js";

const version = Object.freeze({ type: "string", const: "v1" });
const handle = Object.freeze({ type: "string", minLength: 1, maxLength: 512 });
const fields = Object.freeze({ type: "array", minItems: 1, maxItems: expenseScheduleFields.length, uniqueItems: true,
  items: Object.freeze({ type: "string", enum: expenseScheduleFields }) });
const annotations = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const);
const securitySchemes = Object.freeze([Object.freeze({ type: "oauth2", scopes: Object.freeze(["expenses.read"] as const) } as const)]);
const output = (list: boolean): Readonly<Record<string, unknown>> => Object.freeze({ type: "object", required: Object.freeze(["data", "meta"]), properties: Object.freeze({
  data: list ? Object.freeze({ type: "object", required: Object.freeze(["items", "total"]), properties: Object.freeze({ items: Object.freeze({ type: "array", maxItems: 100, items: Object.freeze({ type: "object", required: Object.freeze(["id"]) }) }), total: Object.freeze({ type: "integer", minimum: 0 }) }) }) : Object.freeze({ type: "object", required: Object.freeze(["id"]) }),
  meta: Object.freeze({ type: "object", required: Object.freeze(["contract_version", ...(list ? ["next_cursor"] : [])]), properties: Object.freeze({ contract_version: version, ...(list ? { next_cursor: Object.freeze({ type: Object.freeze(["string", "null"]), minLength: 32, maxLength: 128 }) } : {}) }) }),
}) });

/** Read-only recurring schedule descriptors; these tools never materialize expense rows. */
export const expenseScheduleMcpTools = Object.freeze([
  Object.freeze({ name: "bizyeet_expense_schedules_list", title: "List expense schedules", description: "Read a bounded page of recurring expense schedules. Internal notes are excluded; this read never creates expense occurrences.", annotations, securitySchemes,
    inputSchema: Object.freeze({ type: "object", required: Object.freeze(["api_version"]), additionalProperties: false, properties: Object.freeze({ api_version: version, fields, page_size: Object.freeze({ type: "integer", minimum: 1, maximum: 100 }), cursor: Object.freeze({ type: "string", minLength: 32, maxLength: 128 }), search: Object.freeze({ type: "string", maxLength: 120 }), category: Object.freeze({ type: "string", maxLength: 100 }), currency: Object.freeze({ type: "string", pattern: "^[A-Z]{3}$" }), frequency: Object.freeze({ type: "string", enum: expenseScheduleFrequencies }), active: Object.freeze({ type: "string", enum: Object.freeze(["0", "1"]) }), sort: Object.freeze({ type: "string", enum: expenseScheduleSortFields }), dir: Object.freeze({ type: "string", enum: Object.freeze(["asc", "desc"]) }) }) }), outputSchema: output(true),
  }),
  Object.freeze({ name: "bizyeet_expense_schedules_get", title: "Get expense schedule", description: "Read one recurring expense schedule by its opaque BizYeet ID. Internal notes are excluded.", annotations, securitySchemes,
    inputSchema: Object.freeze({ type: "object", required: Object.freeze(["api_version", "id"]), additionalProperties: false, properties: Object.freeze({ api_version: version, fields, id: handle }) }), outputSchema: output(false),
  }),
] as const);
