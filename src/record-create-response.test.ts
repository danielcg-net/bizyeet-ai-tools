import assert from "node:assert/strict";
import { test } from "node:test";
import { recordCreateExecutionResponse, recordCreatePreviewResponse, recordCreateStatusResponse } from "./record-create-response.js";

const id = "11111111-1111-4111-8111-111111111111";
const handle = `crm1.${"a".repeat(64)}.customers.123`;
const meta = { contract_version: "v1", request_id: "synthetic", private_hint: "never-return" };
const preview = { preview_id: id, request_hash: "h".repeat(43), expires_at: "2099-01-01T00:00:00.000Z",
  confirmation_class: "reversible_write", operation: "customers.create", resource_id: "new@example.invalid",
  resource_label: "New customer", proposed_changes: { business: "New customer", email: "New@Example.Invalid", birthday: null },
  side_effects: ["Create one customer"], warnings: [], idempotency_key_format: "uuid",
  approval_path: `/dashboard/#/agent-approvals/${id}` };
const resource = { id: handle, business: "New customer", company: "New customer", contact_name: null,
  updated_at: "2026-09-28T00:00:00.000Z" };
const outcome = { resource, audit_reference: id };

await test("projects a bounded customer-create preview without upstream metadata or private fields", () => {
  const projected = recordCreatePreviewResponse({ data: { ...preview, internal_secret: "never-return" }, meta }, "customers");
  assert.deepEqual(projected, { data: preview, meta: { contract_version: "v1", request_id: "synthetic" } });
  assert.equal(recordCreatePreviewResponse({ data: { ...preview, proposed_changes: { ...preview.proposed_changes,
    provider_payload: "private" } }, meta }, "customers"), undefined);
  assert.equal(recordCreatePreviewResponse({ data: { ...preview, resource_id: "other@example.invalid" }, meta }, "customers"), undefined);
});

await test("validates the lead-create identity and never exposes hidden resource fields", () => {
  const leadPreview = { ...preview, operation: "leads.create", proposed_changes: { business: "New lead", email: "new@example.invalid",
    pipelineStage: "New Lead" } };
  assert.ok(recordCreatePreviewResponse({ data: leadPreview, meta }, "leads"));
  assert.equal(recordCreatePreviewResponse({ data: leadPreview, meta }, "customers"), undefined);
  const leadResource = { ...resource, id: `crm1.${"a".repeat(64)}.leads.123`, pipeline_stage: "New Lead" };
  assert.deepEqual(recordCreateExecutionResponse({ data: { resource: leadResource, audit_reference: id }, meta }, "leads")?.data,
    { resource: leadResource, audit_reference: id });
  assert.equal(recordCreateExecutionResponse({ data: { resource: { ...leadResource, notes: "private" }, audit_reference: id }, meta }, "leads"), undefined);
});

await test("requires a 201 success and projects the original durable outcome", () => {
  const body = { data: { preview_id: id, state: "succeeded", retry_mutation: false,
    reconciliation_required: false, outcome: { status: 201, data: outcome } }, meta };
  assert.deepEqual(recordCreateStatusResponse(body, "customers", id), { data: body.data,
    meta: { contract_version: "v1", request_id: "synthetic" } });
  assert.equal(recordCreateStatusResponse({ ...body, data: { ...body.data,
    outcome: { status: 200, data: outcome } } }, "customers", id), undefined);
  assert.equal(recordCreateStatusResponse({ ...body, data: { ...body.data,
    outcome: { status: 201, data: { ...outcome, resource: { ...resource, notes: "private" } } } } }, "customers", id), undefined);
  assert.deepEqual(recordCreateStatusResponse({ data: { preview_id: id, state: "unknown", retry_mutation: false,
    reconciliation_required: true, outcome: null }, meta }, "customers", id)?.data,
  { preview_id: id, state: "unknown", retry_mutation: false, reconciliation_required: true, outcome: null });
});
