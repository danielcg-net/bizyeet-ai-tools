import { correlationReference } from "./agent-error.js";
import { validResourceId } from "./resource-id.js";
import { isUuid } from "./uuid.js";
import { serviceUpdateExecutionResponse, serviceUpdateStatusResponse } from "./service-update-response.js";

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const timestamp = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) && !Number.isNaN(Date.parse(value));
const statuses = new Set(["backlog", "in_progress", "executed", "cancelled"]);

/** Project only the approved non-delivery status transition summary. */
export const serviceTransitionPreviewResponse = (body: unknown, serviceId: string, status: string): Readonly<Record<string, unknown>> | undefined => {
  if (!record(body) || !record(body.meta) || body.meta.contract_version !== "v1" || !record(body.data)) return undefined;
  const data = body.data;
  const changes = data.proposed_changes;
  if (!isUuid(data.preview_id) || typeof data.request_hash !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(data.request_hash)
    || !timestamp(data.expires_at) || data.confirmation_class !== "lifecycle_transition"
    || data.operation !== "service_transition" || !validResourceId(data.resource_id) || data.resource_id !== serviceId
    || typeof data.resource_label !== "string" || !record(changes) || changes.status !== status || !statuses.has(status)
    || typeof changes.serviceName !== "string" || typeof changes.notification !== "string"
    || Object.keys(changes).length !== 3
    || !Array.isArray(data.side_effects) || !data.side_effects.every((value: unknown) => typeof value === "string")
    || !Array.isArray(data.warnings) || !data.warnings.every((value: unknown) => typeof value === "string")
    || data.idempotency_key_format !== "uuid"
    || data.approval_path !== `/dashboard/#/agent-approvals/${data.preview_id}`) return undefined;
  return { data: { preview_id: data.preview_id, request_hash: data.request_hash, expires_at: data.expires_at,
    confirmation_class: data.confirmation_class, operation: data.operation, resource_id: data.resource_id,
    resource_label: data.resource_label, proposed_changes: { serviceName: changes.serviceName, status: changes.status,
      notification: changes.notification }, side_effects: data.side_effects, warnings: data.warnings,
    idempotency_key_format: data.idempotency_key_format, approval_path: data.approval_path },
  meta: { contract_version: "v1", request_id: correlationReference(body.meta.request_id) } };
};

/** Redact the canonical service and notification outcome, including status reconciliation. */
export const serviceTransitionExecutionResponse = serviceUpdateExecutionResponse;
export const serviceTransitionStatusResponse = serviceUpdateStatusResponse;
