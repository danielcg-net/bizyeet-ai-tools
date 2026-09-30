import { canonicalErrorCode, correlationReference, recordedFailureCode } from "./agent-error.js";
import { quoteResponse } from "./quote-response.js";
import { serviceResponse } from "./service-response.js";
import { validResourceId } from "./resource-id.js";
import { isUuid } from "./uuid.js";

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const timestamp = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) && !Number.isNaN(Date.parse(value));
const metadata = (body: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined =>
  record(body.meta) && body.meta.contract_version === "v1"
    ? { contract_version: "v1", request_id: correlationReference(body.meta.request_id) } : undefined;

/** Project only the bound human approval summary, never upstream private fields. */
export const quoteAcceptPreviewResponse = (body: unknown, resourceId: string): Readonly<Record<string, unknown>> | undefined => {
  if (!record(body) || !record(body.data)) return undefined;
  const meta = metadata(body);
  const data = body.data;
  const changes = data.proposed_changes;
  if (!meta || !isUuid(data.preview_id) || !/^[A-Za-z0-9_-]{43}$/u.test(String(data.request_hash))
    || !timestamp(data.expires_at) || data.confirmation_class !== "lifecycle_transition"
    || data.operation !== "quote_accept" || data.resource_id !== resourceId || !validResourceId(data.resource_id)
    || typeof data.resource_label !== "string" || !record(changes)
    || !["quoteTitle", "lifecycleAction", "notification"].every((field) => typeof changes[field] === "string")
    || Object.keys(changes).length !== 3
    || !Array.isArray(data.side_effects) || !data.side_effects.every((value: unknown) => typeof value === "string")
    || !Array.isArray(data.warnings) || !data.warnings.every((value: unknown) => typeof value === "string")
    || data.idempotency_key_format !== "uuid"
    || data.approval_path !== `/dashboard/#/agent-approvals/${data.preview_id}`) return undefined;
  return { data: { preview_id: data.preview_id, request_hash: data.request_hash, expires_at: data.expires_at,
    confirmation_class: data.confirmation_class, operation: data.operation, resource_id: data.resource_id,
    resource_label: data.resource_label, proposed_changes: { quoteTitle: changes.quoteTitle,
      lifecycleAction: changes.lifecycleAction, notification: changes.notification },
    side_effects: data.side_effects, warnings: data.warnings, idempotency_key_format: data.idempotency_key_format,
    approval_path: data.approval_path }, meta };
};

/** Validate and redact the canonical quote-to-service execution outcome. */
export const quoteAcceptExecutionResponse = (body: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (!record(body) || !record(body.data)) return undefined;
  const meta = metadata(body);
  const data = body.data;
  if (!meta || !record(data.quote) || !validResourceId(data.quote.id)
    || !(data.service === null || record(data.service) && validResourceId(data.service.id))
    || typeof data.already_accepted !== "boolean" || !isUuid(data.audit_reference)
    || !record(data.notification) || typeof data.notification.attempted !== "boolean"
    || typeof data.notification.sent !== "boolean" || typeof data.notification.reconciliation_required !== "boolean") return undefined;
  const quote = quoteResponse({ data: data.quote, meta: body.meta }, {}, data.quote.id);
  const service = data.service === null ? null
    : serviceResponse({ data: data.service, meta: body.meta }, {}, String(data.service.id));
  if (!quote || !record(quote.data) || (data.service !== null && (!service || !record(service.data)))) return undefined;
  return { data: { quote: quote.data, service: service === null ? null : service?.data,
    already_accepted: data.already_accepted, notification: { attempted: data.notification.attempted,
      sent: data.notification.sent, reconciliation_required: data.notification.reconciliation_required },
    audit_reference: data.audit_reference }, meta };
};

/** Reconcile one prior acceptance without retrying its irreversible effects. */
export const quoteAcceptStatusResponse = (body: unknown, previewId: string): Readonly<Record<string, unknown>> | undefined => {
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
    const projected = quoteAcceptExecutionResponse({ data: data.outcome.data, meta: body.meta });
    return data.outcome.status === 200 && projected && record(projected.data)
      ? { data: { ...common, outcome: { status: 200, data: projected.data } }, meta } : undefined;
  }
  if (!record(data.outcome.error) || typeof data.outcome.status !== "number"
    || !Number.isInteger(data.outcome.status) || data.outcome.status < 400 || data.outcome.status > 599) return undefined;
  const code = data.state === "ambiguous" ? canonicalErrorCode(data.outcome.error.code)
    : recordedFailureCode(data.outcome.error.code);
  if (data.state === "ambiguous" ? code !== "execution_ambiguous" || data.outcome.status !== 503
    : code === undefined || ["execution_ambiguous", "execution_in_progress"].includes(code)) return undefined;
  return { data: { ...common, outcome: { status: data.outcome.status, error: { code } } }, meta };
};
