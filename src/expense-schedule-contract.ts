import { validExpenseListOptions, type ExpenseListOptions } from "./expense-contract.js";

export const expenseScheduleFields = Object.freeze(["id", "name", "category", "vendor", "amount", "currency", "frequency", "interval_count", "start_date", "end_date", "notes", "generated_count", "last_generated_period_start", "active", "created_at", "updated_at"] as const);
export const expenseScheduleSortFields = Object.freeze(["name", "category", "vendor", "amount", "currency", "frequency", "start_date", "end_date", "active", "created_at", "updated_at"] as const);
export const expenseScheduleFrequencies = Object.freeze(["daily", "weekly", "monthly", "quarterly", "yearly"] as const);
export type ExpenseScheduleListOptions = Omit<ExpenseListOptions, "status" | "schedule" | "start_date" | "end_date" | "sort"> & Readonly<{
  sort?: typeof expenseScheduleSortFields[number];
  frequency?: typeof expenseScheduleFrequencies[number];
  active?: "0" | "1";
}>;
const member = (values: readonly string[], value: unknown): boolean => value === undefined || (typeof value === "string" && values.includes(value));

/** Validate transport syntax only; recurrence, tenancy and category policy remain server-owned. */
export const validExpenseScheduleListOptions = (value: unknown): value is ExpenseScheduleListOptions => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !["page_size", "cursor", "fields", "search", "category", "currency", "sort", "dir", "frequency", "active"].includes(key))) return false;
  const common = Object.fromEntries(Object.entries(input).filter(([key]) => !["fields", "sort", "frequency", "active"].includes(key)));
  return validExpenseListOptions(common) && member(expenseScheduleSortFields, input.sort)
    && member(expenseScheduleFrequencies, input.frequency) && member(["0", "1"], input.active)
    && (input.fields === undefined || (Array.isArray(input.fields) && input.fields.length > 0 && input.fields.length <= expenseScheduleFields.length
      && new Set(input.fields).size === input.fields.length && input.fields.every((field: unknown) => typeof field === "string" && (expenseScheduleFields as readonly string[]).includes(field))));
};
