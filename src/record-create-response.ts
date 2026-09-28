import { canonicalErrorCode, correlationReference, recordedFailureCode } from "./agent-error.js";
import { validResourceId } from "./resource-id.js";
import { isUuid } from "./uuid.js";

export type CreateResource = "customers" | "leads";

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value))
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value);
const email = (value: unknown): value is string => typeof value === "string" && value.length > 3 && value.length <= 320
  && !/\s/u.test(value) && /^[^@]+@[^@]+\.[^@]+$/u.test(value);
const metadata = (body: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined =>
  record(body.meta) && body.meta.contract_version === "v1"
    ? { contract_version: "v1", request_id: correlationReference(body.meta.request_id) } : undefined;
const customerFields = Object.freeze(["business", "company", "contactName", "email", "phone", "birthday", "preferredLocale",
  "communicationLocaleSource", "service", "notes", "billingAddressLine1", "billingAddressLine2", "billingCity",
  "billingProvince", "billingPostalCode", "billingCountry", "serviceAddressLine1", "serviceAddressLine2",
  "serviceCity", "serviceProvince", "servicePostalCode", "serviceCountry"]);
const leadFields = Object.freeze(["business", "company", "contactName", "email", "phone", "birthday", "service",
  "serviceType", "pain", "urgency", "location", "consultationType", "qualification", "nextAction",
  "pipelineStage", "leadSource", "notes", "preferredLocale", "communicationLocaleSource"]);
const resultFields = Object.freeze(["id", "business", "company", "contact_name", "updated_at", "pipeline_stage"]);

/** Accept only documented create fields before credentials or the network are touched. */
export const validRecordCreateInput = (value: unknown, kind: CreateResource): boolean => record(value)
  && typeof value.business === "string" && value.business.trim().length > 0 && value.business.length <= 160
  && email(value.email) && Object.keys(value).length <= 30
  && Object.entries(value).every(([field, entry]) => (kind === "customers" ? customerFields : leadFields).includes(field)
    && ((typeof entry === "string" && entry.length <= 8192) || (field === "birthday" && entry === null)));

/** Project only the documented create preview, never unknown private fields. */
export const recordCreatePreviewResponse = (body: unknown, kind: CreateResource): Readonly<Record<string, unknown>> | undefined => {
  if (!record(body) || !record(body.data)) return undefined;
  const meta = metadata(body);
  const data = body.data;
  const changes = data.proposed_changes;
  const fields = kind === "customers" ? customerFields : leadFields;
  if (!meta || !isUuid(data.preview_id) || !hash(data.request_hash) || !timestamp(data.expires_at)
    || data.confirmation_class !== "reversible_write" || data.operation !== `${kind}.create`
    || !email(data.resource_id) || typeof data.resource_label !== "string" || !data.resource_label
    || !record(changes) || !Object.keys(changes).every((field) => fields.includes(field))
    || typeof changes.business !== "string" || !changes.business || !email(changes.email)
    || changes.email.trim().toLowerCase() !== data.resource_id
    || !Object.entries(changes).every(([field, value]) => typeof value === "string" || (field === "birthday" && value === null))
    || !Array.isArray(data.side_effects) || !data.side_effects.every((value: unknown) => typeof value === "string")
    || !Array.isArray(data.warnings) || !data.warnings.every((value: unknown) => typeof value === "string")
    || data.idempotency_key_format !== "uuid"
    || data.approval_path !== `/dashboard/#/agent-approvals/${data.preview_id}`) return undefined;
  return { data: { preview_id: data.preview_id, request_hash: data.request_hash, expires_at: data.expires_at,
    confirmation_class: data.confirmation_class, operation: data.operation, resource_id: data.resource_id,
    resource_label: data.resource_label, proposed_changes: changes, side_effects: data.side_effects,
    warnings: data.warnings, idempotency_key_format: data.idempotency_key_format, approval_path: data.approval_path }, meta };
};

/** Project only the safe canonical identity and summary returned by a create effect. */
export const recordCreateExecutionResponse = (body: unknown, kind: CreateResource): Readonly<Record<string, unknown>> | undefined => {
  if (!record(body) || !record(body.data)) return undefined;
  const meta = metadata(body);
  const data = body.data;
  if (!record(data.resource)) return undefined;
  const resource = data.resource;
  if (!meta || !isUuid(data.audit_reference) || !validResourceId(resource.id)
    || !Object.keys(resource).every((field) => resultFields.includes(field))
    || Object.values(resource).some((value) => value !== null && typeof value !== "string")
    || typeof resource.business !== "string" || !resource.business
    || (resource.updated_at !== null && !timestamp(resource.updated_at))
    || (kind === "customers" && Object.hasOwn(resource, "pipeline_stage"))) return undefined;
  const safe = Object.fromEntries(["id", "business", "company", "contact_name", "updated_at",
    ...(kind === "leads" ? ["pipeline_stage"] : [])].filter((field) => Object.hasOwn(resource, field)).map((field) => [field, resource[field]]));
  return { data: { resource: safe, audit_reference: data.audit_reference }, meta };
};

/** Reconcile the original create key without authorizing or repeating a mutation. */
export const recordCreateStatusResponse = (body: unknown, kind: CreateResource, previewId: string): Readonly<Record<string, unknown>> | undefined => {
  if (!record(body) || !record(body.data)) return undefined;
  const meta = metadata(body);
  const data = body.data;
  if (!meta || data.preview_id !== previewId || data.retry_mutation !== false
    || !["pending", "unknown", "succeeded", "failed", "ambiguous"].includes(String(data.state))
    || data.reconciliation_required !== (data.state === "unknown" || data.state === "ambiguous")) return undefined;
  const common = { preview_id: previewId, state: data.state, retry_mutation: false, reconciliation_required: data.reconciliation_required };
  if (data.state === "pending" || data.state === "unknown") return data.outcome === null
    ? { data: { ...common, outcome: null }, meta } : undefined;
  if (!record(data.outcome)) return undefined;
  if (data.state === "succeeded") {
    const projected = recordCreateExecutionResponse({ data: data.outcome.data, meta: body.meta }, kind);
    return data.outcome.status === 201 && projected && record(projected.data)
      ? { data: { ...common, outcome: { status: 201, data: projected.data } }, meta } : undefined;
  }
  if (!record(data.outcome.error) || !Number.isInteger(data.outcome.status)
    || Number(data.outcome.status) < 400 || Number(data.outcome.status) > 599) return undefined;
  const code = data.state === "ambiguous" ? canonicalErrorCode(data.outcome.error.code) : recordedFailureCode(data.outcome.error.code);
  if (data.state === "ambiguous" ? code !== "execution_ambiguous" || data.outcome.status !== 503
    : code === undefined || ["execution_ambiguous", "execution_in_progress"].includes(code)) return undefined;
  return { data: { ...common, outcome: { status: data.outcome.status, error: { code } } }, meta };
};
