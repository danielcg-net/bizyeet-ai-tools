import { paymentSummaryDatePattern } from "./payment-summary-contract.js";

/** Public expense transport syntax only; provider policy and roles stay server-owned. */
export const expenseDatePattern = paymentSummaryDatePattern;
export const expenseReadFields = Object.freeze(["id", "name", "category", "vendor", "amount", "currency", "incurred_on", "paid_on", "status", "scheduled", "period_start", "created_at", "updated_at"] as const);
export const expenseSortFields = Object.freeze(["incurred_on", "paid_on", "created_at", "updated_at", "name", "category", "vendor", "amount", "currency", "status"] as const);
export type ExpenseListOptions = Readonly<{
  fields?: readonly string[];
  page_size?: number;
  cursor?: string;
  search?: string;
  sort?: typeof expenseSortFields[number];
  dir?: "asc" | "desc";
  status?: "due" | "paid" | "skipped";
  category?: string;
  currency?: string;
  start?: string;
  end?: string;
}>;
const optionalText = (value: unknown, maximum: number): boolean => value === undefined
  || (typeof value === "string" && value.isWellFormed() && Array.from(value).length <= maximum && !/[\p{Cc}\p{Cs}]/u.test(value));
const member = (values: readonly string[], value: unknown): boolean => value === undefined || (typeof value === "string" && values.includes(value));
const calendarDate = (value: unknown): value is string | undefined => value === undefined
  || (typeof value === "string" && new RegExp(expenseDatePattern, "u").test(value));

/** Validate a closed bounded query without resolving categories, tenants or schedules locally. */
export const validExpenseListOptions = (value: unknown): value is ExpenseListOptions => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !["fields", "page_size", "cursor", "search", "sort", "dir", "status", "category", "currency", "start", "end"].includes(key))) return false;
  return (input.page_size === undefined || (typeof input.page_size === "number" && Number.isInteger(input.page_size) && input.page_size >= 1 && input.page_size <= 100))
    && (input.cursor === undefined || (typeof input.cursor === "string" && /^[A-Za-z0-9_-]{32,128}$/u.test(input.cursor)))
    && (input.fields === undefined || (Array.isArray(input.fields) && input.fields.length > 0 && input.fields.length <= expenseReadFields.length
      && new Set(input.fields).size === input.fields.length && input.fields.every((field: unknown) => typeof field === "string" && (expenseReadFields as readonly string[]).includes(field))))
    && optionalText(input.search, 120) && optionalText(input.category, 32)
    && member(expenseSortFields, input.sort) && member(["asc", "desc"], input.dir) && member(["due", "paid", "skipped"], input.status)
    && (input.currency === undefined || (typeof input.currency === "string" && /^[A-Z]{3}$/u.test(input.currency)))
    && calendarDate(input.start) && calendarDate(input.end)
    && (input.start === undefined || input.end === undefined || input.start <= input.end);
};
