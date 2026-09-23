import { correlationReference } from "./agent-error.js";
import { validResourceId } from "./resource-id.js";

export type CommunicationResource = "customers" | "leads" | "quotes" | "services" | "payments";
export type CommunicationOptions = Readonly<{ page?: number; page_size?: 10 | 20 | 50 }>;
const record = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);

/** Select a canonical resource family, never a provider-specific endpoint. */
export const validCommunicationResource = (value: unknown): value is CommunicationResource =>
  typeof value === "string" && ["customers", "leads", "quotes", "services", "payments"].includes(value);

/** Validate bounded history pagination before OAuth credential access. */
export const validCommunicationOptions = (value: unknown): value is CommunicationOptions => record(value)
  && Object.keys(value).every((key) => key === "page" || key === "page_size")
  && (value.page === undefined || (integer(value.page) && value.page >= 1 && value.page <= 10000))
  && (value.page_size === undefined || (integer(value.page_size) && [10, 20, 50].includes(value.page_size)));

const fields = Object.freeze(["id", "kind", "status", "source_type", "recipient_role", "trigger_mode", "from_status", "to_status", "last_event", "sent_at", "created_at", "scheduled_at"]);
const metadataRow = (value: unknown): value is Readonly<Record<string, unknown>> => record(value) && validResourceId(value.id)
  && typeof value.kind === "string" && typeof value.status === "string"
  && Object.keys(value).every((key) => fields.includes(key))
  && Object.values(value).every((entry) => entry === null || (typeof entry === "string" && entry.length <= 1024));

/** Reject widened records and inconsistent pages; never expose private delivery fields. */
export const communicationResponse = (body: unknown, options: CommunicationOptions): Readonly<Record<string, unknown>> | undefined => {
  if (!record(body) || !record(body.data) || !record(body.meta) || body.meta.contract_version !== "v1") return undefined;
  const { data, meta } = body;
  const size = options.page_size ?? 10;
  if (!integer(data.total) || data.total < 0 || !integer(meta.page) || !integer(meta.total_pages)
    || meta.page_size !== size || meta.total_pages !== Math.max(1, Math.ceil(data.total / size))
    || meta.page !== Math.min(options.page ?? 1, meta.total_pages)
    || !Array.isArray(data.items) || !data.items.every(metadataRow)
    || data.items.length > Math.min(size, Math.max(0, data.total - (meta.page - 1) * size))) return undefined;
  return { data: { items: data.items, total: data.total }, meta: { contract_version: "v1", request_id: correlationReference(meta.request_id),
    page: meta.page, page_size: size, total_pages: meta.total_pages } };
};
