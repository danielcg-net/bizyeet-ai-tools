import { paymentSummaryDatePattern } from "./payment-summary-contract.js";

export const marginReportKinds = Object.freeze(["completed_services", "active_services", "sent_quotes"] as const);
export const marginReportRanges = Object.freeze(["today", "7d", "30d", "month", "last_month", "ytd", "custom"] as const);
export const marginReportFields = Object.freeze(["id", "source", "title", "status", "currency", "revenue", "estimated_cost",
  "actual_cost", "effective_cost", "missing_cost_count", "cost_basis", "margin_amount", "margin_percent", "created_at", "updated_at"] as const);
export const marginReportDefaultFields = Object.freeze(["id", "source", "status", "currency", "revenue",
  "missing_cost_count", "cost_basis", "margin_amount", "margin_percent"] as const);
export const marginReportEvidenceFields = Object.freeze(["source", "currency", "missing_cost_count", "cost_basis", "margin_amount", "margin_percent"] as const);

export type MarginReportOptions = Readonly<{
  kind?: typeof marginReportKinds[number];
  range?: typeof marginReportRanges[number];
  start_date?: string;
  end_date?: string;
  page?: number;
  page_size?: number;
  fields?: readonly typeof marginReportFields[number][];
}>;

const member = (values: readonly string[], value: unknown): boolean => value === undefined
  || typeof value === "string" && values.includes(value);
const page = (value: unknown, maximum: number): boolean => value === undefined
  || typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= maximum;
const validDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !new RegExp(paymentSummaryDatePattern, "u").test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
};

/** Validate only public transport syntax; the tenant calendar and provider stay server-owned. */
export const validMarginReportOptions = (value: unknown): value is MarginReportOptions => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !["kind", "range", "start_date", "end_date", "page", "page_size", "fields"].includes(key))) return false;
  const range = input.range ?? "month";
  const datesValid = range === "custom"
    ? validDate(input.start_date) && validDate(input.end_date) && input.start_date <= input.end_date
    : input.start_date === undefined && input.end_date === undefined;
  return member(marginReportKinds, input.kind) && member(marginReportRanges, input.range)
    && datesValid && page(input.page, 1_000_000) && page(input.page_size, 50)
    && (input.fields === undefined || Array.isArray(input.fields) && input.fields.length >= 1
      && input.fields.length <= marginReportFields.length && new Set(input.fields).size === input.fields.length
      && input.fields.every((field: unknown) => typeof field === "string" && (marginReportFields as readonly string[]).includes(field)));
};
