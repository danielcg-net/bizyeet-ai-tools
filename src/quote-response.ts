import { correlationReference } from "./agent-error.js";
import { validCursor } from "./cursor.js";
import { validResourceId } from "./resource-id.js";
import { quoteReadFields } from "./quote-read-contract.js";

const record = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const publicItems = (value: unknown): readonly unknown[] | undefined => {
  if (!Array.isArray(value) || value.length > 1000 || !value.every((line: unknown) => record(line) && validResourceId(line.id)
    && [line.description, line.quantity, line.unit_price].every((field) => typeof field === "string"))) return undefined;
  return Object.freeze(value.map((line: Readonly<Record<string, unknown>>) => Object.freeze({
    id: line.id, description: line.description, quantity: line.quantity, unit_price: line.unit_price,
  })));
};
const fieldValue = (field: string, value: unknown): boolean => {
  if (field === "id") return validResourceId(value);
  if (field === "items") return publicItems(value) !== undefined;
  if (field === "pricing_revision" || field === "sent_count") return typeof value === "number"
    && Number.isSafeInteger(value) && value >= (field === "pricing_revision" ? 1 : 0);
  return value === null || typeof value === "string";
};

/** Retain public quote facts and opaque edit handles, excluding nested cost and contact metadata. */
export const quoteResponse = (body: unknown, options: Readonly<{ fields?: readonly string[]; page_size?: number }>, id: string | null): Readonly<Record<string, unknown>> | undefined => {
  if (!record(body) || !record(body.data) || !record(body.meta) || body.meta.contract_version !== "v1") return undefined;
  const row = (value: unknown): Readonly<Record<string, unknown>> | undefined => {
    if (!record(value)) return undefined;
    const fields = Object.freeze(["id", ...(options.fields?.length ? options.fields : quoteReadFields.filter((field) => Object.hasOwn(value, field)))
      .filter((field) => field !== "id")]);
    if (!fields.every((field) => quoteReadFields.some((known) => known === field) && Object.hasOwn(value, field)
      && fieldValue(field, value[field]))) return undefined;
    return Object.freeze(Object.fromEntries(fields.map((field) => [field, field === "items" ? publicItems(value[field]) : value[field]])));
  };
  const meta = Object.freeze({ contract_version: "v1", request_id: correlationReference(body.meta.request_id) });
  if (id !== null) {
    const data = row(body.data);
    return data?.id === id ? Object.freeze({ data, meta }) : undefined;
  }
  if (!Array.isArray(body.data.items) || body.data.items.length > (options.page_size ?? 25)
    || typeof body.data.total !== "number" || !Number.isSafeInteger(body.data.total) || body.data.total < body.data.items.length
    || !(body.meta.next_cursor === null || validCursor(body.meta.next_cursor))) return undefined;
  const items = body.data.items.map(row);
  return items.some((value) => value === undefined) ? undefined : Object.freeze({ data: { items, total: body.data.total },
    meta: { ...meta, next_cursor: body.meta.next_cursor } });
};
