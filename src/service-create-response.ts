import { canonicalErrorCode, correlationReference, recordedFailureCode } from "./agent-error.js";
import { validResourceId } from "./resource-id.js";
import { serviceResponse } from "./service-response.js";
import { isUuid } from "./uuid.js";

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const timestamp = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) && !Number.isNaN(Date.parse(value));
const metadata = (body: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined =>
  record(body.meta) && body.meta.contract_version === "v1"
    ? { contract_version: "v1", request_id: correlationReference(body.meta.request_id) } : undefined;
const summaryFields = Object.freeze(["serviceName", "description", "lineItems", "grossAmount", "discountAmount", "totalAmount",
  "discountTerms", "pricingCurrency", "status", "customerDocuments", "notification"]);

/** Project the reviewed service-create summary without exposing provider/private fields. */
export const serviceCreatePreviewResponse = (body: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (!record(body) || !record(body.data)) return undefined;
  const meta = metadata(body);
  const data = body.data;
  const changes = data.proposed_changes;
  if (!meta || !isUuid(data.preview_id) || !/^[A-Za-z0-9_-]{43}$/u.test(String(data.request_hash))
    || !timestamp(data.expires_at) || data.confirmation_class !== "lifecycle_transition"
    || data.operation !== "service_create" || !validResourceId(data.resource_id)
    || typeof data.resource_label !== "string" || !record(changes)
    || !summaryFields.every((field) => typeof changes[field] === "string")
    || changes.status !== "backlog" || !(changes.durationMinutes === undefined || changes.durationMinutes === null
      || Number.isSafeInteger(changes.durationMinutes) && Number(changes.durationMinutes) >= 0)
    || (changes.deliveryType !== undefined && typeof changes.deliveryType !== "string")
    || (changes.scheduledAt !== undefined && typeof changes.scheduledAt !== "string")
    || Object.keys(changes).some((field) => ![...summaryFields, "durationMinutes", "deliveryType", "scheduledAt"].includes(field))
    || !Array.isArray(data.side_effects) || !data.side_effects.every((value: unknown) => typeof value === "string")
    || !Array.isArray(data.warnings) || !data.warnings.every((value: unknown) => typeof value === "string")
    || data.idempotency_key_format !== "uuid"
    || data.approval_path !== `/dashboard/#/agent-approvals/${data.preview_id}`) return undefined;
  const proposedChanges = Object.fromEntries(summaryFields.map((field) => [field, changes[field]]));
  return { data: { preview_id: data.preview_id, request_hash: data.request_hash, expires_at: data.expires_at,
    confirmation_class: data.confirmation_class, operation: data.operation, resource_id: data.resource_id,
    resource_label: data.resource_label, proposed_changes: { ...proposedChanges,
      ...(changes.durationMinutes === undefined ? {} : { durationMinutes: changes.durationMinutes }),
      ...(changes.deliveryType === undefined ? {} : { deliveryType: changes.deliveryType }),
      ...(changes.scheduledAt === undefined ? {} : { scheduledAt: changes.scheduledAt }) },
    side_effects: data.side_effects, warnings: data.warnings, idempotency_key_format: data.idempotency_key_format,
    approval_path: data.approval_path }, meta };
};

/** Validate and redact one canonical backlog service-create outcome. */
export const serviceCreateExecutionResponse = (body: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (!record(body) || !record(body.data)) return undefined;
  const meta = metadata(body);
  const data = body.data;
  if (!meta || !record(data.service) || !validResourceId(data.service.id) || data.service.status !== "backlog"
    || !isUuid(data.audit_reference) || !record(data.notification)
    || typeof data.notification.attempted !== "boolean" || typeof data.notification.sent !== "boolean"
    || typeof data.notification.reconciliation_required !== "boolean") return undefined;
  const service = serviceResponse({ data: data.service, meta: body.meta }, {}, data.service.id);
  return service && record(service.data) ? { data: { service: service.data,
    notification: { attempted: data.notification.attempted, sent: data.notification.sent,
      reconciliation_required: data.notification.reconciliation_required }, audit_reference: data.audit_reference }, meta } : undefined;
};

/** Read one stored service-create outcome without retrying creation or external effects. */
export const serviceCreateStatusResponse = (body: unknown, previewId: string): Readonly<Record<string, unknown>> | undefined => {
  if (!record(body) || !record(body.data)) return undefined;
  const meta = metadata(body);
  const data = body.data;
  if (!meta || data.preview_id !== previewId || data.retry_mutation !== false
    || !["pending", "unknown", "succeeded", "failed", "ambiguous"].includes(String(data.state))
    || data.reconciliation_required !== (data.state === "unknown" || data.state === "ambiguous")) return undefined;
  const common = { preview_id: previewId, state: data.state, retry_mutation: false,
    reconciliation_required: data.reconciliation_required };
  if (data.state === "pending" || data.state === "unknown") return data.outcome === null
    ? { data: { ...common, outcome: null }, meta } : undefined;
  if (!record(data.outcome)) return undefined;
  if (data.state === "succeeded") {
    const projected = serviceCreateExecutionResponse({ data: data.outcome.data, meta: body.meta });
    return data.outcome.status === 201 && projected && record(projected.data)
      ? { data: { ...common, outcome: { status: 201, data: projected.data } }, meta } : undefined;
  }
  if (!record(data.outcome.error) || typeof data.outcome.status !== "number"
    || !Number.isInteger(data.outcome.status) || data.outcome.status < 400 || data.outcome.status > 599) return undefined;
  const code = data.state === "ambiguous" ? canonicalErrorCode(data.outcome.error.code)
    : recordedFailureCode(data.outcome.error.code);
  if (data.state === "ambiguous" ? code !== "execution_ambiguous" || data.outcome.status !== 503
    : code === undefined || ["execution_ambiguous", "execution_in_progress"].includes(code)) return undefined;
  return { data: { ...common, outcome: { status: data.outcome.status, error: { code } } }, meta };
};
