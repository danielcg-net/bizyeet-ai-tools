import { correlationReference } from "./agent-error.js";
import { catalogReadFields, validCatalogReadFields } from "./catalog-read-contract.js";
import { validCursor } from "./cursor.js";
import { validResourceId } from "./resource-id.js";

const record = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const scalar = (field: string, value: unknown): boolean => field === "active" ? value === 0 || value === 1 : value === null || typeof value === "string";

/** Bound and redact canonical facts; never interpret opaque catalog IDs or choose a provider. */
export const catalogResponse = (body: unknown, options: Readonly<{ fields?: readonly string[]; page_size?: number }>, id: string | null): Readonly<Record<string, unknown>> | undefined => {
  if (!record(body) || !record(body.data) || !record(body.meta) || body.meta.contract_version !== "v1"
    || !validCatalogReadFields(options.fields ?? [])) return undefined;
  const row = (value: unknown): Readonly<Record<string, unknown>> | undefined => {
    if (!record(value) || !validResourceId(value.id)) return undefined;
    const selected = (options.fields?.length ? options.fields : catalogReadFields).filter((field) => field !== "id" && Object.hasOwn(value, field));
    if (!selected.every((field) => scalar(field, value[field]))) return undefined;
    return Object.freeze({ id: value.id, ...Object.fromEntries(selected.map((field) => [field, value[field]])) });
  };
  const meta = Object.freeze({ contract_version: "v1", request_id: correlationReference(body.meta.request_id) });
  if (id !== null) {
    const data = row(body.data);
    return data?.id === id ? Object.freeze({ data, meta }) : undefined;
  }
  const limit = options.page_size ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Array.isArray(body.data.items) || body.data.items.length > limit
    || typeof body.data.total !== "number" || !Number.isSafeInteger(body.data.total) || body.data.total < body.data.items.length
    || !(body.meta.next_cursor === null || validCursor(body.meta.next_cursor))) return undefined;
  const items = body.data.items.map(row);
  return items.some((item) => item === undefined) ? undefined : Object.freeze({ data: { items, total: body.data.total }, meta: { ...meta, next_cursor: body.meta.next_cursor } });
};
