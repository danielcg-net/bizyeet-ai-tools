/** Public summary filters validate syntax only; tenant calendar policy stays server-owned. */
export const paymentSummaryRanges = Object.freeze(["today", "month", "last_month", "ytd", "custom"] as const);
/** Real Gregorian calendar dates supported by the canonical calendar resolver. */
export const paymentSummaryDatePattern = "^(?!00\\d{2})(?:\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|02-(?:0[1-9]|1\\d|2[0-8]))|(?:\\d{2}(?:0[48]|[2468][048]|[13579][26])|(?:[02468][048]|[13579][26])00)-02-29)$";
export type PaymentSummaryOptions = Readonly<{
  range?: typeof paymentSummaryRanges[number];
  start_date?: string;
  end_date?: string;
}>;

const date = (value: unknown): value is string => {
  if (typeof value !== "string" || !new RegExp(paymentSummaryDatePattern, "u").test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
};

/** Reject unknown keys and invalid dates without deriving UTC periods or financial totals. */
export const validPaymentSummaryOptions = (value: unknown): value is PaymentSummaryOptions => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !["range", "start_date", "end_date"].includes(key))) return false;
  const range = input.range ?? "month";
  if (typeof range !== "string" || !(paymentSummaryRanges as readonly string[]).includes(range) || input.range === null) return false;
  if (range !== "custom") return input.start_date === undefined && input.end_date === undefined;
  return date(input.start_date) && date(input.end_date) && input.start_date <= input.end_date;
};
