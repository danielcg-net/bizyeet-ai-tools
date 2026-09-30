import assert from "node:assert/strict";
import test from "node:test";

import { serviceUpdateExecutionResponse, serviceUpdatePreviewResponse, serviceUpdateStatusResponse } from "./service-update-response.js";

const previewId = "11111111-1111-4111-8111-111111111111";
const serviceId = "opaque-service";
const meta = Object.freeze({ contract_version: "v1", request_id: "request-1", private_key: "hidden" });
const preview = (): Readonly<Record<string, unknown>> => ({ data: { preview_id: previewId, request_hash: "a".repeat(43),
  expires_at: "2026-09-30T02:00:00.000Z", confirmation_class: "reversible_write", operation: "service_update",
  resource_id: serviceId, resource_label: "Transfer", proposed_changes: { serviceName: "Revised transfer",
    lineItems: "2 × Transfer — 25.00", totalAmount: "50.00", pricingCurrency: "CAD", notification: "No customer communication is configured for this service." },
  side_effects: ["Update one service without changing its lifecycle status."], warnings: [], idempotency_key_format: "uuid",
  approval_path: `/dashboard/#/agent-approvals/${previewId}`, private_key: "hidden" }, meta });
const executed = (): Readonly<Record<string, unknown>> => ({ data: { service: { id: serviceId, name: "Revised transfer",
  pricing_revision: 4, private_key: "hidden", items: [{ id: "opaque-line", description: "Transfer", quantity: "2", unit_price: "25.00", unit_cost: "hidden" }] },
notification: { attempted: false, sent: false, reconciliation_required: false, private_key: "hidden" },
audit_reference: previewId, private_key: "hidden" }, meta });

void test("service-update preview stays bound to the exact service and redacts private fields", (): void => {
  const projected = serviceUpdatePreviewResponse(preview(), serviceId);
  assert.ok(projected);
  assert.equal(JSON.stringify(projected).includes("private_key"), false);
  assert.equal(serviceUpdatePreviewResponse(preview(), "other-service"), undefined);
  assert.equal(serviceUpdatePreviewResponse({ ...preview(), data: { ...(preview().data as object),
    proposed_changes: { serviceName: "Revised transfer", lineItems: "x", totalAmount: "50.00", pricingCurrency: "CAD",
      notification: "none", private_cost: "hidden" } } }, serviceId), undefined);
  assert.ok(serviceUpdatePreviewResponse({ ...preview(), data: { ...(preview().data as object),
    confirmation_class: "externally_visible_send" } }, serviceId));
});

void test("service-update execution redacts nested costs and status requires the original outcome", (): void => {
  const projected = serviceUpdateExecutionResponse(executed());
  assert.ok(projected);
  assert.equal(JSON.stringify(projected).includes("hidden"), false);
  const status = { data: { preview_id: previewId, state: "succeeded", retry_mutation: false,
    reconciliation_required: false, outcome: { status: 200, data: executed().data } }, meta };
  assert.ok(serviceUpdateStatusResponse(status, previewId));
  assert.equal(serviceUpdateStatusResponse({ ...status, data: { ...status.data,
    outcome: { status: 201, data: executed().data } } }, previewId), undefined);
  assert.equal(serviceUpdateStatusResponse(status, "22222222-2222-4222-8222-222222222222"), undefined);
  assert.deepEqual(serviceUpdateStatusResponse({ data: { preview_id: previewId, state: "unknown", retry_mutation: false,
    reconciliation_required: true, outcome: null }, meta }, previewId)?.data,
  { preview_id: previewId, state: "unknown", retry_mutation: false, reconciliation_required: true, outcome: null });
});
