import { expenseMcpTools, expenseOutputSchema } from "./expense-mcp.js";
import { expenseScheduleFields, expenseScheduleSortFields, expenseScheduleFrequencies } from "./expense-schedule-contract.js";

const [list, get] = expenseMcpTools;
const common = list.inputSchema.properties;
const fields = Object.freeze({ type: "array", minItems: 1, maxItems: expenseScheduleFields.length, uniqueItems: true, items: Object.freeze({ type: "string", enum: expenseScheduleFields }) });

/** Describe canonical persisted schedule reads; recurrence evaluation remains server-owned. */
export const expenseScheduleMcpTools = Object.freeze([
  Object.freeze({ ...list, name: "bizyeet_expense_schedules_list", title: "List expense schedules",
    description: "Read a bounded page of persisted expense schedules. This does not generate occurrences or calculate forecasts. Generation counters describe stored history only. Preserve currencies; notes require explicit field selection.",
    inputSchema: Object.freeze({ ...list.inputSchema, properties: Object.freeze({
      api_version: common.api_version, page_size: common.page_size, cursor: common.cursor, search: common.search,
      dir: common.dir, category: common.category, currency: common.currency, fields,
      sort: Object.freeze({ type: "string", enum: expenseScheduleSortFields }),
      frequency: Object.freeze({ type: "string", enum: expenseScheduleFrequencies }),
      active: Object.freeze({ type: "string", enum: Object.freeze(["0", "1"]) }),
    }) }), outputSchema: expenseOutputSchema(true, false),
  }),
  Object.freeze({ ...get, name: "bizyeet_expense_schedules_get", title: "Get expense schedule",
    description: "Read one persisted expense schedule by its opaque tenant-bound ID. This does not generate occurrences or evaluate due costs. Notes require explicit field selection.",
    inputSchema: Object.freeze({ ...get.inputSchema, properties: Object.freeze({ ...get.inputSchema.properties, fields }) }),
  }),
] as const);
