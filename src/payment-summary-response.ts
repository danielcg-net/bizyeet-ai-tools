/** Validate and project the financial summary envelope without recomputing totals. */
import { correlationReference } from "./agent-error.js";
import { paymentSummaryRanges } from "./payment-summary-contract.js";

const record = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const instant = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const label = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\p{Cc}\p{Cs}]/u.test(value);
const currency = (value: unknown): value is Readonly<{ currency: string; paymentCount: number; amount: number; usedDefaultCurrency: boolean }> => record(value)
  && typeof value.currency === "string" && /^[A-Z]{3}$/u.test(value.currency)
  && typeof value.amount === "number" && Number.isFinite(value.amount)
  && typeof value.paymentCount === "number" && Number.isSafeInteger(value.paymentCount) && value.paymentCount >= 0
  && typeof value.usedDefaultCurrency === "boolean";

/** Return only documented summary fields; malformed responses must not look like zero totals. */
export const paymentSummaryResponse = (value: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (!record(value) || !record(value.meta) || value.meta.contract_version !== "v1" || !record(value.data)) return undefined;
  const data = value.data;
  if (data.label !== "gross collected receipts" || !record(data.period) || !record(data.source)
    || !Array.isArray(data.currencies) || !data.currencies.every(currency)) return undefined;
  const period = data.period;
  const source = data.source;
  if (!instant(period.start) || !instant(period.end) || period.start >= period.end || data.start !== period.start || data.end !== period.end
    || typeof period.range !== "string" || !(paymentSummaryRanges as readonly string[]).includes(period.range)
    || !label(period.timeZone) || !label(source.provider) || !instant(source.readCompletedAt)) return undefined;
  return Object.freeze({ data: Object.freeze({
    label: data.label, start: period.start, end: period.end,
    period: Object.freeze({ range: period.range, timeZone: period.timeZone, start: period.start, end: period.end }),
    source: Object.freeze({ provider: source.provider, readCompletedAt: source.readCompletedAt }),
    currencies: Object.freeze(data.currencies.map((row) => Object.freeze({ currency: row.currency, amount: row.amount, paymentCount: row.paymentCount, usedDefaultCurrency: row.usedDefaultCurrency }))),
  }), meta: Object.freeze({ contract_version: "v1", request_id: correlationReference(value.meta.request_id) }) });
};
