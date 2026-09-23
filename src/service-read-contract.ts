/** Public service fields; private cost and customer data are never selectable. */
export const serviceReadFields = Object.freeze([
  "id", "name", "description", "public_reference", "amount", "status", "delivery_type", "scheduled_at",
  "delivered_at", "duration_minutes", "pricing_currency", "pricing_revision", "created_at", "updated_at", "items",
] as const);

export type ServiceReadField = typeof serviceReadFields[number];
export type ServiceRevision = Readonly<{
  pricing_revision: number;
  items: readonly Readonly<{ id: string; description: string; quantity: string; unit_price: string }>[];
}>;

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const boundedString = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length <= maximum;
const item = (value: unknown): value is ServiceRevision["items"][number] => record(value)
  && boundedString(value.id, 512) && value.id.length > 0
  && boundedString(value.description, 4096)
  && boundedString(value.quantity, 64) && boundedString(value.unit_price, 64);

/** Validate projection selection without interpreting provider or tenant routing. */
export const validServiceReadFields = (value: unknown, detail: boolean): value is readonly ServiceReadField[] =>
  Array.isArray(value) && value.length <= serviceReadFields.length
  && value.every((field: unknown) => typeof field === "string"
    && serviceReadFields.some((known) => known === field) && (detail || field !== "items"));

/** Retain only the public concurrency token and opaque line handles needed by a later update. */
export const serviceRevision = (value: unknown): ServiceRevision | undefined => {
  if (!record(value) || typeof value.pricing_revision !== "number" || !Number.isSafeInteger(value.pricing_revision)
    || value.pricing_revision < 1 || !Array.isArray(value.items) || value.items.length > 1000 || !value.items.every(item)) return undefined;
  return Object.freeze({ pricing_revision: value.pricing_revision,
    items: Object.freeze(value.items.map((line: ServiceRevision["items"][number]) => Object.freeze({
      id: line.id, description: line.description, quantity: line.quantity, unit_price: line.unit_price,
    }))),
  });
};
