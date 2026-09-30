import { expenseDatePattern } from "./expense-contract.js";
import { expenseResponse, expenseFieldValue } from "./expense-response.js";
import { expenseScheduleFields, expenseScheduleFrequencies, type ExpenseScheduleListOptions } from "./expense-schedule-contract.js";
import type { ExpenseResponseContract } from "./expense-response.js";

const calendarDate = (value: unknown): boolean => typeof value === "string" && new RegExp(expenseDatePattern, "u").test(value);
const count = (value: unknown, minimum: number): boolean => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;

/** Validate documented schedule scalars without exposing internal notes or coercing server facts. */
export const expenseScheduleFieldValue = (field: string, value: unknown): boolean => {
  if (field === "id" || field === "amount" || field === "currency") return expenseFieldValue(field, value);
  if (field === "frequency") return typeof value === "string" && (expenseScheduleFrequencies as readonly string[]).includes(value);
  if (field === "interval_count") return count(value, 1);
  if (field === "generated_count") return count(value, 0);
  if (field === "active") return value === 0 || value === 1;
  if (field === "start_date") return calendarDate(value);
  if (field === "end_date" || field === "last_generated_period_start") return value === null || calendarDate(value);
  return value === null || typeof value === "string";
};

const contract: ExpenseResponseContract = Object.freeze({
  fields: expenseScheduleFields,
  defaults: expenseScheduleFields,
  fieldValue: expenseScheduleFieldValue,
});

/** Project only the explicit public schedule shape from a canonical OAuth response. */
export const expenseScheduleResponse = (value: unknown, requested: Pick<ExpenseScheduleListOptions, "fields" | "page_size">, id: string | null): Readonly<Record<string, unknown>> | undefined =>
  expenseResponse(value, requested, id, contract);
