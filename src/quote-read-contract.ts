/** Public quote facts exposed by the canonical OAuth sales endpoint. */
export const quoteReadFields = Object.freeze([
  "id", "title", "public_reference", "status", "delivery_option", "delivery_date", "total_amount",
  "pricing_currency", "pricing_revision", "sent_count", "last_sent_at", "created_at", "updated_at", "recipient_name", "items",
] as const);

/** Validate field names only; pricing, permissions, and routing belong to the server. */
export const validQuoteReadFields = (value: unknown): value is readonly typeof quoteReadFields[number][] =>
  Array.isArray(value) && value.length <= quoteReadFields.length
  && value.every((field: unknown) => quoteReadFields.some((known) => known === field));
