import { correlationReference } from "./agent-error.js";
import { validCursor } from "./cursor.js";

export type ServiceHistoryOptions = Readonly<{ limit?: number; cursor?: string }>;

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const utcTimestamp = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/** Validate the only supported service-history pagination arguments. */
export const validServiceHistoryOptions = (value: unknown): value is ServiceHistoryOptions => record(value)
  && Object.keys(value).every((key) => key === "limit" || key === "cursor")
  && (value.limit === undefined || (Number.isSafeInteger(value.limit) && Number(value.limit) >= 1 && Number(value.limit) <= 100))
  && (value.cursor === undefined || validCursor(value.cursor));

const historyRow = (value: unknown): value is Readonly<Record<string, unknown>> => record(value)
  && (value.from_status === null || (typeof value.from_status === "string" && value.from_status.length <= 80))
  && typeof value.to_status === "string" && value.to_status.length > 0 && value.to_status.length <= 80
  && utcTimestamp(value.created_at);

/** Project only the immutable lifecycle facts from the canonical response. */
export const serviceHistoryResponse = (body: unknown, options: ServiceHistoryOptions): Readonly<Record<string, unknown>> | undefined => {
  if (!validServiceHistoryOptions(options) || !record(body) || !record(body.data) || !record(body.meta)
    || body.meta.contract_version !== "v1" || !Array.isArray(body.data.items)
    || body.data.items.length > (options.limit ?? 25)
    || !body.data.items.every(historyRow) || !Number.isSafeInteger(body.data.total)
    || Number(body.data.total) < body.data.items.length
    || !(body.meta.next_cursor === null || validCursor(body.meta.next_cursor))) return undefined;
  return Object.freeze({
    data: Object.freeze({ items: Object.freeze(body.data.items.map((item: Readonly<Record<string, unknown>>) => Object.freeze({
      from_status: item.from_status, to_status: item.to_status, created_at: item.created_at,
    }))), total: body.data.total }),
    meta: Object.freeze({ contract_version: "v1", request_id: correlationReference(body.meta.request_id), next_cursor: body.meta.next_cursor }),
  });
};
