import type { BookingSummaryOptions } from "./booking-contract.js";

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Project a booking summary to its documented provider-safe envelope. */
export const bookingSummaryResponse = (body: unknown, options: BookingSummaryOptions): Readonly<Record<string, unknown>> | undefined => {
  if (!record(body) || !record(body.data) || !record(body.meta) || body.meta.contract_version !== "v1") return undefined;
  const { data } = body;
  const hours = options.hours ?? 168;
  if (data.hours !== hours || typeof data.booking_provider !== "string" || typeof data.available !== "boolean" || typeof data.ok !== "boolean") return undefined;
  if (data.ok) {
    if (!data.available || typeof data.provider !== "string" || typeof data.count !== "number" || !Number.isSafeInteger(data.count) || data.count < 0) return undefined;
    return { data: { hours, booking_provider: data.booking_provider, ok: true, available: true, provider: data.provider, count: data.count }, meta: { contract_version: "v1" } };
  }
  if (data.available && typeof data.provider !== "string") return undefined;
  if (typeof data.error !== "string" || typeof data.code !== "string") return undefined;
  return { data: { hours, booking_provider: data.booking_provider, ok: false, available: data.available,
    ...(data.available ? { provider: data.provider } : {}), error: data.error, code: data.code }, meta: { contract_version: "v1" } };
};
