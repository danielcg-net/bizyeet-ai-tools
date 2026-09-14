import { correlationReference } from "./agent-error.js";
import { validResourceId as identity } from "./resource-id.js";
import { expenseDatePattern, expenseReadFields, type ExpenseListOptions } from "./expense-contract.js";

const defaults = Object.freeze(["id", "name", "category", "amount", "currency", "incurred_on", "paid_on", "status"]);
const record = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const instant = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
/** Validate shared persisted expense scalar fields without coercing their values. */
export const expenseFieldValue = (field: string, value: unknown): boolean => {
  if (field === "id") return identity(value);
  if (field === "schedule_id") return value === null || identity(value);
  if (field === "amount") return typeof value === "string" && /^-?\d+(?:\.\d+)?$/u.test(value) && Number.isFinite(Number(value));
  if (field === "currency") return typeof value === "string" && /^[A-Z]{3}$/u.test(value);
  if (field === "status") return typeof value === "string" && ["due", "paid", "skipped"].includes(value);
  if (["incurred_on", "paid_on", "period_start"].includes(field)) return value === null || (typeof value === "string" && new RegExp(expenseDatePattern, "u").test(value));
  return value === null || typeof value === "string";
};
export type ExpenseResponseContract = Readonly<{ fields: readonly string[]; defaults: readonly string[]; period: boolean; fieldValue: (field: string, value: unknown) => boolean }>;
const expenseContract: ExpenseResponseContract = Object.freeze({ fields: expenseReadFields, defaults, period: true, fieldValue: expenseFieldValue });

/** Preserve amounts/currencies and requested fields; never reinterpret a persisted view as a live total. */
export const expenseResponse = (value: unknown, requested: Pick<ExpenseListOptions, "fields" | "page_size" | "start_date" | "end_date">, id: string | null,
  contract: ExpenseResponseContract = expenseContract): Readonly<Record<string, unknown>> | undefined => {
  if (!record(value) || !record(value.meta) || value.meta.contract_version !== "v1" || !record(value.data)) return undefined;
  const meta = value.meta;
  const source = meta.source;
  if (!record(source) || source.provider !== "d1" || source.view !== "persisted" || !instant(source.readCompletedAt)
    || !record(source.materialization) || source.materialization.performed !== false || source.materialization.status !== "not_evaluated") return undefined;
  const fields = Object.freeze(["id", ...(requested.fields ?? contract.defaults).filter((field) => field !== "id")]);
  if (!fields.every((field) => contract.fields.includes(field))) return undefined;
  const row = (item: unknown): Readonly<Record<string, unknown>> | undefined => record(item) && fields.every((field) => Object.hasOwn(item, field) && contract.fieldValue(field, item[field]))
    ? Object.freeze(Object.fromEntries(fields.map((field) => [field, item[field]]))) : undefined;
  const projectedSource = Object.freeze({ provider: source.provider, view: source.view, readCompletedAt: source.readCompletedAt,
    materialization: Object.freeze({ performed: false, status: "not_evaluated" }) });
  const commonMeta = Object.freeze({ contract_version: "v1", request_id: correlationReference(meta.request_id), source: projectedSource });
  if (id !== null) {
    const data = row(value.data);
    return data?.id === id ? Object.freeze({ data, meta: commonMeta }) : undefined;
  }
  const period = contract.period && record(meta.period) ? meta.period : undefined;
  if (contract.period && (period?.kind !== "calendar_dates" || period.startInclusive !== true || period.endInclusive !== true
    || period.startDate !== (requested.start_date ?? null) || period.endDate !== (requested.end_date ?? null))) return undefined;
  if (!(meta.next_cursor === null || (typeof meta.next_cursor === "string" && /^[A-Za-z0-9_-]{32,128}$/u.test(meta.next_cursor)))
    || !Array.isArray(value.data.items) || value.data.items.length > (requested.page_size ?? 25)
    || typeof value.data.total !== "number" || !Number.isSafeInteger(value.data.total) || value.data.total < value.data.items.length) return undefined;
  const items = value.data.items.map(row);
  if (items.some((item) => item === undefined)) return undefined;
  return Object.freeze({ data: Object.freeze({ items: Object.freeze(items), total: value.data.total }), meta: Object.freeze({ ...commonMeta,
    next_cursor: meta.next_cursor, ...(period ? { period: Object.freeze({ kind: period.kind, startDate: period.startDate, endDate: period.endDate, startInclusive: true, endInclusive: true }) } : {}),
  }) });
};
