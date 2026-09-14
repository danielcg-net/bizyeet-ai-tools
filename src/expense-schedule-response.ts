import { expenseDatePattern } from "./expense-contract.js";
import { expenseFieldValue, expenseResponse, type ExpenseResponseContract } from "./expense-response.js";
import { expenseScheduleFields, expenseScheduleFrequencies, type ExpenseScheduleListOptions } from "./expense-schedule-contract.js";

const fieldValue = (field: string, value: unknown): boolean => {
  if (field === "active") return value === 0 || value === 1;
  if (field === "frequency") return typeof value === "string" && (expenseScheduleFrequencies as readonly string[]).includes(value);
  if (field === "interval_count") return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 365;
  if (field === "generated_count") return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (["start_date", "end_date", "last_generated_period_start"].includes(field)) return (value === null && field !== "start_date")
    || (typeof value === "string" && new RegExp(expenseDatePattern, "u").test(value));
  return expenseFieldValue(field, value);
};
const contract: ExpenseResponseContract = Object.freeze({ fields: expenseScheduleFields,
  defaults: Object.freeze(["id", "name", "category", "amount", "currency", "frequency", "interval_count", "start_date", "end_date", "active"]), period: false, fieldValue });

/** Validate persisted schedule facts without evaluating recurrence or inventing a query period. */
export const expenseScheduleResponse = (value: unknown, requested: ExpenseScheduleListOptions, id: string | null): Readonly<Record<string, unknown>> | undefined =>
  expenseResponse(value, requested, id, contract);
