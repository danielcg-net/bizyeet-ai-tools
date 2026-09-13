import { correlationReference } from "./agent-error.js";
import { expenseDatePattern, expenseReadFields, type ExpenseListOptions } from "./expense-contract.js";

const defaults = Object.freeze(["id", "name", "category", "amount", "currency", "incurred_on", "paid_on", "status"]);
const record = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const identity = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\p{Cc}\p{Cs}]/u.test(value);
const instant = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const fieldValue = (field: string, value: unknown): boolean => {
  if (field === "id") return identity(value);
  if (field === "schedule_id") return value === null || identity(value);
  if (field === "amount") return typeof value === "string" && /^-?\d+(?:\.\d+)?$/u.test(value) && Number.isFinite(Number(value));
  if (field === "currency") return typeof value === "string" && /^[A-Z]{3}$/u.test(value);
  if (field === "status") return typeof value === "string" && ["due", "paid", "skipped"].includes(value);
  if (["incurred_on", "paid_on", "period_start"].includes(field)) return value === null || (typeof value === "string" && new RegExp(expenseDatePattern, "u").test(value));
  return value === null || typeof value === "string";
};

/** Preserve amounts/currencies and requested fields; never reinterpret a persisted view as a live total. */
export const expenseResponse = (value: unknown, requested: ExpenseListOptions, id: string | null): Readonly<Record<string, unknown>> | undefined => {
  if (!record(value) || !record(value.meta) || value.meta.contract_version !== "v1" || !record(value.data)) return undefined;
  const meta = value.meta;
  const source = meta.source;
  if (!record(source) || source.provider !== "d1" || source.view !== "persisted" || !instant(source.readCompletedAt)
    || !record(source.materialization) || source.materialization.performed !== false || source.materialization.status !== "not_evaluated") return undefined;
  const fields = Object.freeze(["id", ...(requested.fields ?? defaults).filter((field) => field !== "id")]);
  if (!fields.every((field) => (expenseReadFields as readonly string[]).includes(field))) return undefined;
  const row = (item: unknown): Readonly<Record<string, unknown>> | undefined => record(item) && fields.every((field) => Object.hasOwn(item, field) && fieldValue(field, item[field]))
    ? Object.freeze(Object.fromEntries(fields.map((field) => [field, item[field]]))) : undefined;
  const projectedSource = Object.freeze({ provider: source.provider, view: source.view, readCompletedAt: source.readCompletedAt,
    materialization: Object.freeze({ performed: false, status: "not_evaluated" }) });
  const commonMeta = Object.freeze({ contract_version: "v1", request_id: correlationReference(meta.request_id), source: projectedSource });
  if (id !== null) {
    const data = row(value.data);
    return data?.id === id ? Object.freeze({ data, meta: commonMeta }) : undefined;
  }
  const period = meta.period;
  if (!record(period) || period.kind !== "calendar_dates" || period.startInclusive !== true || period.endInclusive !== true
    || period.startDate !== (requested.start_date ?? null) || period.endDate !== (requested.end_date ?? null)
    || !(meta.next_cursor === null || (typeof meta.next_cursor === "string" && /^[A-Za-z0-9_-]{32,128}$/u.test(meta.next_cursor)))
    || !Array.isArray(value.data.items) || value.data.items.length > (requested.page_size ?? 25)
    || typeof value.data.total !== "number" || !Number.isSafeInteger(value.data.total) || value.data.total < value.data.items.length) return undefined;
  const items = value.data.items.map(row);
  if (items.some((item) => item === undefined)) return undefined;
  return Object.freeze({ data: Object.freeze({ items: Object.freeze(items), total: value.data.total }), meta: Object.freeze({ ...commonMeta,
    next_cursor: meta.next_cursor, period: Object.freeze({ kind: period.kind, startDate: period.startDate, endDate: period.endDate, startInclusive: true, endInclusive: true }),
  }) });
};
