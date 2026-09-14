import { correlationReference } from "./agent-error.js";
import { validResourceId } from "./resource-id.js";
import { paymentSummaryDatePattern } from "./payment-summary-contract.js";
import { paymentTimestampPattern } from "./payment-contract.js";
import { taxReportAuthorities, taxReportEntryTypes, taxReportDefaultFields, taxReportFields, validTaxReportOptions, type TaxReportOptions } from "./tax-report-contract.js";

const record = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const integer = (value: unknown, minimum = Number.MIN_SAFE_INTEGER): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const instant = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const date = (value: unknown): value is string => typeof value === "string" && new RegExp(paymentSummaryDatePattern, "u").test(value);
const rangeLabels = (range: string, start: string, end: string, exclusive: string, today: string): boolean => {
  if (range === "custom") return true;
  if (range === "last_month") {
    const monthIndex = (value: string): number => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));
    return start.endsWith("-01") && exclusive === `${today.slice(0, 7)}-01` && monthIndex(exclusive) - monthIndex(start) === 1;
  }
  if (end !== today) return false;
  if (range === "today") return start === today;
  if (range === "month") return start === `${today.slice(0, 7)}-01`;
  if (range === "ytd") return start === `${today.slice(0, 4)}-01-01`;
  const days = (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000;
  return (range === "7d" && days === 6) || (range === "30d" && days === 29);
};
const calendarBoundary = (value: string, label: string, timeZone: string): boolean => {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, calendar: "iso8601", numberingSystem: "latn",
      year: "numeric", month: "2-digit", day: "2-digit" });
    const localDate = (timestamp: number): string => {
      const parts = formatter.formatToParts(timestamp);
      return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value.padStart(type === "year" ? 4 : 2, "0") ?? "").join("-");
    };
    const timestamp = Date.parse(value);
    // Check the supplied boundary, without calculating a replacement period or assuming 24-hour days.
    return localDate(timestamp) === label && localDate(timestamp - 1) !== label;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
};
const totalFields = Object.freeze(["taxable_sales_minor", "collected_tax_minor", "reversals_minor", "adjustments_minor", "net_collected_minor", "entry_count"]);
const fieldValue = (field: string, value: unknown): boolean => {
  if (field === "id") return validResourceId(value);
  if (field === "linked_entry_id") return value === null || validResourceId(value);
  if (field === "rate_ppm") return integer(value, 0);
  if (["taxable_base_minor", "amount_minor"].includes(field)) return integer(value);
  if (field === "currency") return typeof value === "string" && /^[A-Z]{3}$/u.test(value);
  if (field === "entry_type") return typeof value === "string" && (taxReportEntryTypes as readonly string[]).includes(value);
  if (field === "authority") return typeof value === "string" && (taxReportAuthorities as readonly string[]).includes(value);
  if (field === "province") return typeof value === "string" && /^(?:[A-Z]{2})?$/u.test(value);
  if (field === "effective_at") return date(value);
  if (field === "received_at") return typeof value === "string" && new RegExp(paymentTimestampPattern, "u").test(value);
  // Ledger text has no smaller business limit; retain the transport's 1 MiB ceiling.
  if (["label", "registration_number", "reason"].includes(field)) return typeof value === "string"
    && value.length <= 1_048_576 && value.trim() === value
    && !/[\p{Cc}\p{Cs}]/u.test(value.replaceAll("\n", "").replaceAll("\r", "").replaceAll("\t", ""));
  return false;
};

/** Validate and allowlist canonical output without deriving financial totals or tenant date boundaries. */
export const taxReportResponse = (value: unknown, requested: TaxReportOptions): Readonly<Record<string, unknown>> | undefined => {
  if (!validTaxReportOptions(requested) || !record(value) || !record(value.data) || !record(value.meta)) return undefined;
  const { data, meta } = value;
  const { period, source } = meta;
  if (meta.contract_version !== "v1" || meta.filing_ready !== false || !record(period) || !record(source)
    || source.provider !== "d1" || source.view !== "immutable_tax_ledger" || !instant(source.readCompletedAt)
    || typeof period.range !== "string" || period.range !== (requested.range ?? "month") || !instant(period.start) || !instant(period.end) || period.start >= period.end
    || typeof period.timeZone !== "string" || period.timeZone.length < 1 || period.timeZone.length > 128
    || !date(period.startDate) || !date(period.endDate) || !date(period.endDateExclusive) || !date(period.todayDate)
    || period.startDate > period.endDate
    || Date.parse(`${period.endDateExclusive}T00:00:00.000Z`) - Date.parse(`${period.endDate}T00:00:00.000Z`) !== 86_400_000
    || period.startInclusive !== true || period.endInclusive !== false) return undefined;
  if (!calendarBoundary(period.start, period.startDate, period.timeZone)
    || !calendarBoundary(period.end, period.endDateExclusive, period.timeZone)) return undefined;
  if (!rangeLabels(period.range, period.startDate, period.endDate, period.endDateExclusive, period.todayDate)) return undefined;
  if (requested.range === "custom" && (period.startDate !== requested.start_date || period.endDate !== requested.end_date)) return undefined;
  if (!integer(meta.page, 1) || !integer(meta.page_size, 1) || meta.page_size !== (requested.page_size ?? 25)
    || !integer(meta.total_pages, 1) || meta.page !== Math.min(requested.page ?? 1, meta.total_pages)
    || !integer(data.total, 0) || !Array.isArray(data.items) || data.items.length > meta.page_size || data.total < data.items.length
    || meta.returned !== data.items.length || !Array.isArray(data.totals)) return undefined;
  const fields = Object.freeze(["id", ...(requested.fields ?? taxReportDefaultFields).filter((field) => field !== "id")]);
  const items = data.items.map((item: unknown) => record(item) && fields.every((field) => (taxReportFields as readonly string[]).includes(field)
    && Object.hasOwn(item, field) && fieldValue(field, item[field])) ? Object.freeze(Object.fromEntries(fields.map((field) => [field, item[field]]))) : undefined);
  const totals = data.totals.map((group: unknown) => record(group) && typeof group.currency === "string" && /^[A-Z]{3}$/u.test(group.currency)
    && totalFields.every((field) => integer(group[field], field === "entry_count" ? 0 : Number.MIN_SAFE_INTEGER))
    ? Object.freeze({ currency: group.currency, ...Object.fromEntries(totalFields.map((field) => [field, group[field]])) }) : undefined);
  if (items.some((item) => item === undefined) || totals.some((group) => group === undefined)
    || new Set(totals.map((group) => group?.currency)).size !== totals.length) return undefined;
  return Object.freeze({ data: Object.freeze({ items: Object.freeze(items), totals: Object.freeze(totals), total: data.total }),
    meta: Object.freeze({ contract_version: "v1", request_id: correlationReference(meta.request_id), page: meta.page, page_size: meta.page_size,
      total_pages: meta.total_pages, returned: meta.returned, filing_ready: false,
      period: Object.freeze({ range: period.range, timeZone: period.timeZone, start: period.start, end: period.end, startDate: period.startDate,
        endDate: period.endDate, endDateExclusive: period.endDateExclusive, todayDate: period.todayDate, startInclusive: true, endInclusive: false }),
      source: Object.freeze({ provider: source.provider, view: source.view, readCompletedAt: source.readCompletedAt }),
    }),
  });
};
