import { correlationReference } from "./agent-error.js";
import { validResourceId as identity } from "./resource-id.js";
import { expenseDatePattern, expenseReadFields, type ExpenseListOptions } from "./expense-contract.js";

const defaults = Object.freeze(["id", "name", "category", "vendor", "amount", "currency", "incurred_on", "paid_on", "status", "scheduled", "period_start", "created_at", "updated_at"]);
const record = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const calendarDate = (value: unknown): boolean => value === null || (typeof value === "string" && new RegExp(expenseDatePattern, "u").test(value));

/** Validate documented public expense scalars without coercing server facts. */
export const expenseFieldValue = (field: string, value: unknown): boolean => {
  if (field === "id") return identity(value);
  if (field === "amount") return typeof value === "string" && /^-?\d+(?:\.\d+)?$/u.test(value) && Number.isFinite(Number(value));
  if (field === "currency") return typeof value === "string" && /^[A-Z]{3}$/u.test(value);
  if (field === "status") return typeof value === "string" && ["due", "paid", "skipped"].includes(value);
  if (field === "scheduled") return typeof value === "boolean";
  if (["incurred_on", "paid_on", "period_start"].includes(field)) return calendarDate(value);
  return value === null || typeof value === "string";
};
export type ExpenseResponseContract = Readonly<{ fields: readonly string[]; defaults: readonly string[]; fieldValue: (field: string, value: unknown) => boolean }>;
const expenseContract: ExpenseResponseContract = Object.freeze({ fields: expenseReadFields, defaults, fieldValue: expenseFieldValue });

/** Retain only the documented projection from the canonical OAuth expense response. */
export const expenseResponse = (value: unknown, requested: Pick<ExpenseListOptions, "fields" | "page_size">, id: string | null,
  contract: ExpenseResponseContract = expenseContract): Readonly<Record<string, unknown>> | undefined => {
  if (!record(value) || !record(value.meta) || value.meta.contract_version !== "v1" || !record(value.data)) return undefined;
  const fields = Object.freeze(["id", ...(requested.fields ?? contract.defaults).filter((field) => field !== "id")]);
  if (!fields.every((field) => contract.fields.includes(field))) return undefined;
  const row = (item: unknown): Readonly<Record<string, unknown>> | undefined => record(item) && fields.every((field) => Object.hasOwn(item, field) && contract.fieldValue(field, item[field]))
    ? Object.freeze(Object.fromEntries(fields.map((field) => [field, item[field]]))) : undefined;
  const commonMeta = Object.freeze({ contract_version: "v1", request_id: correlationReference(value.meta.request_id) });
  if (id !== null) {
    const data = row(value.data);
    return data?.id === id ? Object.freeze({ data, meta: commonMeta }) : undefined;
  }
  if (!(value.meta.next_cursor === null || (typeof value.meta.next_cursor === "string" && /^[A-Za-z0-9_-]{32,128}$/u.test(value.meta.next_cursor)))
    || !Array.isArray(value.data.items) || value.data.items.length > (requested.page_size ?? 25)
    || typeof value.data.total !== "number" || !Number.isSafeInteger(value.data.total) || value.data.total < value.data.items.length) return undefined;
  const items = value.data.items.map(row);
  if (items.some((item) => item === undefined)) return undefined;
  return Object.freeze({ data: Object.freeze({ items: Object.freeze(items), total: value.data.total }), meta: Object.freeze({ ...commonMeta, next_cursor: value.meta.next_cursor }) });
};
