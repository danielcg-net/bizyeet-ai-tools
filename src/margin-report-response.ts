import { correlationReference } from "./agent-error.js";
import { paymentSummaryDatePattern } from "./payment-summary-contract.js";
import { validResourceId } from "./resource-id.js";
import { marginReportDefaultFields, marginReportFields, validMarginReportOptions, type MarginReportOptions } from "./margin-report-contract.js";
import { reportAnchorMatchesCompletion, reportCalendarBoundary, reportRangeLabels } from "./report-period.js";

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const integer = (value: unknown, minimum: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const instant = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const date = (value: unknown): value is string => typeof value === "string"
  && new RegExp(paymentSummaryDatePattern, "u").test(value);
const decimal = (value: unknown): value is string => typeof value === "string"
  && /^-?(?:0|[1-9]\d*)\.\d{2}$/u.test(value) && Number.isFinite(Number(value));
const text = (value: unknown): value is string => typeof value === "string" && value.length <= 4096
  && !/[\p{Cc}\p{Cs}]/u.test(value);
const decimals = Object.freeze(["revenue", "estimated_cost", "actual_cost", "effective_cost", "margin_amount", "margin_percent"]);
const costBasis = Object.freeze(["actual", "estimated", "missing"]);
const marginId = /^margin1\.([a-f0-9]{64})\.(completed_services|active_services|sent_quotes)\.([A-Z]{3})\.(.+)$/u;

const validMarginId = (value: unknown, kind: string, currency: unknown): boolean => {
  if (!validResourceId(value)) return false;
  const parts = marginId.exec(value);
  if (parts?.[2] !== kind || parts[3] !== currency) return false;
  try {
    const rawId = decodeURIComponent(parts[4] ?? "");
    return rawId.length >= 1 && rawId.length <= 128 && encodeURIComponent(rawId) === parts[4]
      && !/[\p{Cc}\p{Cs}]/u.test(rawId);
  } catch { return false; }
};

const validField = (field: string, value: unknown): boolean => {
  if (field === "id") return validResourceId(value) && value.startsWith("margin1.");
  if (field === "currency") return typeof value === "string" && /^[A-Z]{3}$/u.test(value);
  if (field === "source") return value === "quote" || value === "service";
  if (field === "cost_basis") return typeof value === "string" && costBasis.includes(value);
  if (field === "missing_cost_count") return integer(value, 0);
  if (decimals.includes(field)) return value === null && (field === "margin_amount" || field === "margin_percent") || decimal(value);
  if (field === "created_at" || field === "updated_at") return value === null || text(value);
  return text(value);
};

const validPeriod = (period: Readonly<Record<string, unknown>>, requested: MarginReportOptions, completedAt: string): boolean => {
  if (typeof period.range !== "string" || period.range !== (requested.range ?? "month") || !instant(period.start) || !instant(period.end)
    || period.start >= period.end || !date(period.startDate) || !date(period.endDate)
    || !date(period.endDateExclusive) || !date(period.todayDate)
    || period.startDate > period.endDate || period.endDate >= period.endDateExclusive
    || Date.parse(`${period.endDateExclusive}T00:00:00.000Z`) - Date.parse(`${period.endDate}T00:00:00.000Z`) !== 86_400_000
    || period.startInclusive !== true || period.endInclusive !== false
    || typeof period.timeZone !== "string" || period.timeZone.length < 1 || period.timeZone.length > 128
    || requested.range === "custom" && (period.startDate !== requested.start_date || period.endDate !== requested.end_date)) return false;
  return reportCalendarBoundary(period.start, period.startDate, period.timeZone)
    && reportCalendarBoundary(period.end, period.endDateExclusive, period.timeZone)
    && reportRangeLabels(period.range, period.startDate, period.endDate, period.endDateExclusive, period.todayDate)
    && (period.range === "custom" || reportAnchorMatchesCompletion(period.todayDate, completedAt, period.timeZone));
};

const validTotal = (value: unknown): value is Readonly<Record<string, unknown>> => record(value)
  && validField("currency", value.currency) && integer(value.count, 1) && integer(value.missing_cost_count, 0)
  && value.cost_data_complete === (value.missing_cost_count === 0)
  && decimals.every((field) => field === "margin_percent" && value[field] === null || decimal(value[field]));

/** Validate the canonical tenant-bound margin report and emit only requested public fields. */
export const marginReportResponse = (value: unknown, requested: MarginReportOptions): Readonly<Record<string, unknown>> | undefined => {
  if (!validMarginReportOptions(requested) || !record(value) || !record(value.data) || !record(value.meta)) return undefined;
  const { data, meta } = value;
  const kind = requested.kind ?? "completed_services";
  const fields = Object.freeze(["id", ...(requested.fields ?? marginReportDefaultFields).filter((field) => field !== "id")]);
  const { period, source } = meta;
  if (data.kind !== kind || !record(period) || !record(source)
    || source.provider !== "d1" || source.view !== kind || !instant(source.readCompletedAt)
    || !validPeriod(period, requested, source.readCompletedAt)
    || meta.contract_version !== "v1" || !integer(meta.page, 1) || !integer(meta.page_size, 1)
    || meta.page_size !== (requested.page_size ?? 25) || !integer(meta.total_pages, 1)
    || !integer(data.total, 0) || meta.total_pages !== Math.max(1, Math.ceil(data.total / meta.page_size))
    || meta.page !== Math.min(requested.page ?? 1, meta.total_pages)
    || !Array.isArray(data.items) || data.items.length !== Math.min(meta.page_size, Math.max(0, data.total - (meta.page - 1) * meta.page_size))
    || meta.returned !== data.items.length || !Array.isArray(data.totals)) return undefined;
  const totals = data.totals.map((group: unknown) => validTotal(group) ? Object.freeze({ currency: group.currency, count: group.count,
    missing_cost_count: group.missing_cost_count, cost_data_complete: group.cost_data_complete,
    ...Object.fromEntries(decimals.map((field) => [field, group[field]])) }) : undefined);
  if (totals.some((group) => group === undefined)
    || new Set(totals.map((group) => group?.currency)).size !== totals.length
    || totals.reduce((sum, group) => sum + Number(group?.count), 0) !== data.total) return undefined;
  const currencies = new Set(totals.map((group) => group?.currency));
  const items = data.items.map((item: unknown) => {
    if (!record(item) || ![...new Set([...fields, "currency", "missing_cost_count", "cost_basis", "margin_amount", "margin_percent"])].every((field) =>
      (marginReportFields as readonly string[]).includes(field) && Object.hasOwn(item, field) && validField(field, item[field]))
      || !currencies.has(item.currency) || !validMarginId(item.id, kind, item.currency)
      || item.source !== (kind === "sent_quotes" ? "quote" : "service")
      || (Number(item.missing_cost_count) > 0) !== (item.cost_basis === "missing")
      || Number(item.missing_cost_count) > 0 && (item.margin_amount !== null || item.margin_percent !== null)) return undefined;
    return Object.freeze(Object.fromEntries(fields.map((field) => [field, item[field]])));
  });
  if (items.some((item) => item === undefined) || new Set(items.map((item) => item?.id)).size !== items.length) return undefined;
  return Object.freeze({ data: Object.freeze({ kind, items: Object.freeze(items), totals: Object.freeze(totals), total: data.total }),
    meta: Object.freeze({ contract_version: "v1", request_id: correlationReference(meta.request_id), page: meta.page,
      page_size: meta.page_size, total_pages: meta.total_pages, returned: meta.returned,
      period: Object.freeze({ range: period.range, timeZone: period.timeZone, start: period.start, end: period.end,
        startDate: period.startDate, endDate: period.endDate, endDateExclusive: period.endDateExclusive,
        todayDate: period.todayDate, startInclusive: true, endInclusive: false }),
      source: Object.freeze({ provider: "d1", view: kind, readCompletedAt: source.readCompletedAt }) }),
  });
};
