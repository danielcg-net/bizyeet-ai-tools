import { canonicalErrorCode, correlationReference, recordedFailureCode } from "./agent-error.js";
import { quoteResponse } from "./quote-response.js";
import { validResourceId } from "./resource-id.js";
import { isUuid } from "./uuid.js";

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value))
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value);
const meta = (body: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined =>
  record(body.meta) && body.meta.contract_version === "v1"
    ? { contract_version: "v1", request_id: correlationReference(body.meta.request_id) } : undefined;

/** Project only approved quote-create preview fields; never echo unknown upstream fields. */
export const quoteCreatePreviewResponse = (body: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (!record(body) || !record(body.data)) return undefined;
  const metadata = meta(body);
  const data = body.data;
  const changes = data.proposed_changes;
  const changeFields = ["quoteTitle", "parentType", "lineItems", "totalAmount", "pricingCurrency", "deliveryDate", "deliveryOption", "notes"];
  const requiredChanges = ["quoteTitle", "parentType", "lineItems", "totalAmount", "pricingCurrency"];
  if (!metadata || !isUuid(data.preview_id) || !hash(data.request_hash) || !timestamp(data.expires_at)
    || data.confirmation_class !== "reversible_write" || data.operation !== "quote_create"
    || !validResourceId(data.resource_id) || typeof data.resource_label !== "string"
    || !record(changes) || !requiredChanges.every((field) => Object.hasOwn(changes, field))
    || !Object.keys(changes).every((field) => changeFields.includes(field))
    || !Object.values(changes).every((value) => typeof value === "string")
    || !Array.isArray(data.side_effects) || !data.side_effects.every((value: unknown) => typeof value === "string")
    || !Array.isArray(data.warnings) || !data.warnings.every((value: unknown) => typeof value === "string")
    || data.idempotency_key_format !== "uuid"
    || data.approval_path !== `/dashboard/#/agent-approvals/${data.preview_id}`) return undefined;
  return { data: { preview_id: data.preview_id, request_hash: data.request_hash, expires_at: data.expires_at,
    confirmation_class: data.confirmation_class, operation: data.operation, resource_id: data.resource_id,
    resource_label: data.resource_label, proposed_changes: data.proposed_changes,
    side_effects: data.side_effects, warnings: data.warnings, idempotency_key_format: data.idempotency_key_format,
    approval_path: data.approval_path }, meta: metadata };
};

/** Validate a quote-create result against the public quote projection. */
export const quoteCreateExecutionResponse = (body: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (!record(body) || !record(body.data) || !record(body.data.resource) || !isUuid(body.data.audit_reference)) return undefined;
  const projected = quoteResponse({ data: body.data.resource, meta: body.meta }, {}, String(body.data.resource.id));
  return projected && record(projected.data) ? { data: { resource: projected.data, audit_reference: body.data.audit_reference }, meta: projected.meta } : undefined;
};

/** Project original outcome only; uncertain mutations must be reconciled, never replayed. */
export const quoteCreateStatusResponse = (body: unknown, previewId: string): Readonly<Record<string, unknown>> | undefined => {
  if (!record(body) || !record(body.data)) return undefined;
  const metadata = meta(body);
  const data = body.data;
  if (!metadata || data.preview_id !== previewId || data.retry_mutation !== false
    || !["pending", "unknown", "succeeded", "failed", "ambiguous"].includes(String(data.state))
    || data.reconciliation_required !== (data.state === "unknown" || data.state === "ambiguous")) return undefined;
  const common = { preview_id: previewId, state: data.state, retry_mutation: false, reconciliation_required: data.reconciliation_required };
  if (data.state === "pending" || data.state === "unknown") return data.outcome === null
    ? { data: { ...common, outcome: null }, meta: metadata } : undefined;
  if (!record(data.outcome)) return undefined;
  if (data.state === "succeeded") {
    const projected = quoteCreateExecutionResponse({ data: data.outcome.data, meta: body.meta });
    return data.outcome.status === 201 && projected && record(projected.data) && projected.data.audit_reference === previewId
      ? { data: { ...common, outcome: { status: 201, data: projected.data } }, meta: metadata } : undefined;
  }
  if (!record(data.outcome.error) || typeof data.outcome.status !== "number" || !Number.isInteger(data.outcome.status)
    || data.outcome.status < 400 || data.outcome.status > 599) return undefined;
  const code = data.state === "ambiguous" ? canonicalErrorCode(data.outcome.error.code) : recordedFailureCode(data.outcome.error.code);
  if (data.state === "ambiguous" ? code !== "execution_ambiguous" || data.outcome.status !== 503
    : code === undefined || ["execution_ambiguous", "execution_in_progress"].includes(code)) return undefined;
  return { data: { ...common, outcome: { status: data.outcome.status, error: { code } } }, meta: metadata };
};
