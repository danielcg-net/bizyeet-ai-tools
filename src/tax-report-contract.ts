import { validPaymentSummaryOptions } from "./payment-summary-contract.js";

export const taxReportRanges = Object.freeze(["today", "7d", "30d", "month", "last_month", "ytd", "custom"] as const);
export const taxReportAuthorities = Object.freeze(["GST_HST", "BC_PST", "SK_PST", "MB_RST", "QC_QST"] as const);
export const taxReportEntryTypes = Object.freeze(["collected", "reversal", "adjustment"] as const);
export const taxReportFields = Object.freeze(["id", "entry_type", "authority", "label", "province", "rate_ppm", "taxable_base_minor", "amount_minor", "currency", "registration_number", "reason", "effective_at", "received_at", "linked_entry_id"] as const);
export const taxReportDefaultFields = Object.freeze(["id", "entry_type", "authority", "taxable_base_minor", "amount_minor", "currency", "received_at"] as const);

export type TaxReportOptions = Readonly<{
  range?: typeof taxReportRanges[number];
  start_date?: string;
  end_date?: string;
  authority?: typeof taxReportAuthorities[number];
  province?: string;
  currency?: string;
  entry_type?: typeof taxReportEntryTypes[number];
  page?: number;
  page_size?: number;
  fields?: readonly typeof taxReportFields[number][];
}>;

const member = (values: readonly string[], value: unknown): boolean => value === undefined || (typeof value === "string" && values.includes(value));
const integer = (value: unknown, maximum: number): boolean => value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= maximum);
const code = (value: unknown, pattern: RegExp): boolean => value === undefined || (typeof value === "string" && pattern.test(value));

/** Validate public transport syntax without resolving tenant periods, providers or financial totals. */
export const validTaxReportOptions = (value: unknown): value is TaxReportOptions => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !["range", "start_date", "end_date", "authority", "province", "currency", "entry_type", "page", "page_size", "fields"].includes(key))) return false;
  // Rolling ranges share the existing non-custom date syntax. This does not
  // change the transmitted range or calculate its server-owned boundaries.
  const dates = { range: input.range === "7d" || input.range === "30d" ? "month" : input.range,
    start_date: input.start_date, end_date: input.end_date };
  return member(taxReportRanges, input.range) && validPaymentSummaryOptions(dates)
    && member(taxReportAuthorities, input.authority) && member(taxReportEntryTypes, input.entry_type)
    && code(input.province, /^[A-Z]{2}$/u) && code(input.currency, /^[A-Z]{3}$/u)
    && integer(input.page, 1_000_000) && integer(input.page_size, 100)
    && (input.fields === undefined || (Array.isArray(input.fields) && input.fields.length > 0 && input.fields.length <= taxReportFields.length
      && new Set(input.fields).size === input.fields.length && input.fields.every((field: unknown) => typeof field === "string" && (taxReportFields as readonly string[]).includes(field))));
};
