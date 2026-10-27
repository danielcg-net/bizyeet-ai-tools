import { correlationReference } from "./agent-error.js";
import { validCursor } from "./cursor.js";
import { paymentReadFields, validPaymentQuery, type PaymentFilters } from "./payment-contract.js";

export const servicePaymentFields = Object.freeze(paymentReadFields.filter((field) => field !== "customer" && field !== "service"));
export type ServicePaymentOptions = PaymentFilters & Readonly<{
  limit?: number;
  cursor?: string;
  fields?: readonly string[];
  search?: string;
}>;

const record = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const optionKeys = new Set(["limit", "cursor", "fields", "search", "status", "date_field", "start", "end", "sort", "dir"]);
const paymentHandle = (value: unknown): value is string => typeof value === "string" && /^pay1\.[a-f0-9]{64}\.[A-Za-z0-9._~%-]{1,512}$/u.test(value);

/** Validate only documented, bounded service-linked payment filters and public fields. */
export const validServicePaymentOptions = (value: unknown): value is ServicePaymentOptions => record(value)
  && Object.keys(value).every((key) => optionKeys.has(key))
  && (value.limit === undefined || (Number.isSafeInteger(value.limit) && Number(value.limit) >= 1 && Number(value.limit) <= 100))
  && (value.cursor === undefined || validCursor(value.cursor))
  && (value.fields === undefined || (Array.isArray(value.fields) && value.fields.length <= servicePaymentFields.length
    && value.fields.every((field: unknown) => typeof field === "string" && (servicePaymentFields as readonly string[]).includes(field))))
  && validPaymentQuery(value);

/** Project a canonical service-linked page without reflecting provider/private fields. */
export const servicePaymentResponse = (body: unknown, options: ServicePaymentOptions): Readonly<Record<string, unknown>> | undefined => {
  if (!validServicePaymentOptions(options) || !record(body) || !record(body.data) || !record(body.meta)
    || body.meta.contract_version !== "v1" || !Array.isArray(body.data.items)
    || body.data.items.length > (options.limit ?? 25) || !Number.isSafeInteger(body.data.total)
    || Number(body.data.total) < body.data.items.length
    || !(body.meta.next_cursor === null || validCursor(body.meta.next_cursor))) return undefined;
  const selected = servicePaymentFields.filter((field) => field === "id" || options.fields === undefined || options.fields.includes(field));
  if (!body.data.items.every((item: unknown) => record(item) && paymentHandle(item.id)
    && selected.every((field) => field === "id" || !Object.hasOwn(item, field)
      || item[field] === null || typeof item[field] === "string" || typeof item[field] === "number"))) return undefined;
  const items = body.data.items.map((item: Readonly<Record<string, unknown>>) =>
    Object.freeze(Object.fromEntries(selected.filter((field) => Object.hasOwn(item, field)).map((field) => [field, item[field]]))));
  return Object.freeze({
    data: Object.freeze({ items: Object.freeze(items), total: body.data.total }),
    meta: Object.freeze({ contract_version: "v1", request_id: correlationReference(body.meta.request_id), next_cursor: body.meta.next_cursor }),
  });
};
