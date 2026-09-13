/** Public payment-read schema. Provider routing and authorization remain server-owned. */
export const paymentReadFields = Object.freeze([
  "id", "direction", "status", "amount", "currency", "subtotal_minor", "tax_total_minor", "total_minor", "tax_mode",
  "created_at", "updated_at", "due_at", "requested_at", "sent_at", "received_at", "customer", "service",
] as const);
export const paymentSortFields = Object.freeze(["created_at", "sent_at", "received_at", "status", "amount"] as const);
export const paymentDateFields = Object.freeze(["created_at", "sent_at", "received_at", "due_at"] as const);
export type PaymentFilters = Readonly<{
  status?: "sent" | "received";
  date_field?: typeof paymentDateFields[number];
  start?: string;
  end?: string;
  sort?: typeof paymentSortFields[number];
  dir?: "asc" | "desc";
}>;
type PaymentQuery = Readonly<{ fields?: readonly string[]; search?: string; status?: string; date_field?: string; start?: string; end?: string; sort?: string; dir?: string }>;
const member = (values: readonly string[], value: string | undefined): boolean => value === undefined || values.includes(value);
const timestamp = (value: string | undefined): boolean => {
  if (value === undefined) return true;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === (value.length === 20 ? value.replace("Z", ".000Z") : value);
};

/** Reject malformed filters locally without inferring provider support or live permissions. */
export const validPaymentQuery = (query: PaymentQuery): query is PaymentFilters & Pick<PaymentQuery, "fields" | "search"> =>
  member(["sent", "received"], query.status) && member(paymentDateFields, query.date_field)
  && member(paymentSortFields, query.sort) && member(["asc", "desc"], query.dir)
  && timestamp(query.start) && timestamp(query.end)
  && (query.start === undefined || query.end === undefined || Date.parse(query.start) < Date.parse(query.end))
  && (query.search === undefined || query.search.length <= 120)
  && (query.fields === undefined || (query.fields.length <= paymentReadFields.length && query.fields.every((field) => (paymentReadFields as readonly string[]).includes(field))));
