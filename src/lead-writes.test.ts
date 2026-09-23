import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";
import { run } from "./cli.js";

const id = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const resource = `crm1.${"a".repeat(64)}.leads.123`;
const approval = { preview_id: id, approval_receipt: "r".repeat(43), idempotency_key: key };
const proposal = { resource_id: resource, changes: { business: "Revised" } };
const envelope = (data: unknown): Readonly<Record<string, unknown>> => ({ data, meta: { contract_version: "v1", request_id: "synthetic" } });
const outcome = { resource: { id: resource, business: "Revised", company: "Revised", pipeline_stage: "New Lead", updated_at: null }, audit_reference: id };
const preview = { preview_id: id, request_hash: "a".repeat(43), expires_at: "2099-01-01T00:00:00.000Z", confirmation_class: "reversible_write",
  resource_id: resource, proposed_changes: { business: "Revised", company: "Revised", birthday: null },
  side_effects: ["Update lead without conversion"], warnings: [], idempotency_key_format: "uuid", approval_path: `/dashboard/#/agent-approvals/${id}` };

await Promise.all([
  {}, { business: "" }, { business: "Revised", notes: { private: "secret" } },
  ...["tenant_id", "write_version", "access_token", "provider_payload"].map((field) => ({ business: "Revised", [field]: "secret" })),
].map((proposed_changes, index) => test(`rejects widened or malformed lead preview fields ${String(index)}`, async () => {
  const request = mock.fn(() => Promise.resolve(Response.json(envelope({ ...preview, proposed_changes }))));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  assert.deepEqual(await client.previewLeadUpdate(proposal), { status: 502, body: { error: { code: "invalid_response" } } });
  assert.equal(request.mock.callCount(), 1);
})));

await test("preserves the complete canonical lead preview contract including locale provenance", async () => {
  const proposed_changes = { business: "Revised", company: "Revised", contactName: "Contact", email: "", phone: "", birthday: null,
    service: "", serviceType: "", pain: "", urgency: "", location: "", consultationType: "", qualification: "", nextAction: "",
    pipelineStage: "New Lead", leadSource: "", notes: "Review this note", preferredLocale: "en", communicationLocaleSource: "default" };
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"),
    request: () => Promise.resolve(Response.json(envelope({ ...preview, proposed_changes }))) });
  assert.deepEqual((await client.previewLeadUpdate(proposal)).body, envelope({ ...preview, proposed_changes }));
});

await test("lead writes use only canonical endpoints and preserve nullable approved values", async () => {
  const request = mock.fn((url: string, init: RequestInit): Promise<Response> => {
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer oauth-token");
    assert.equal(init.redirect, "error");
    const path = new URL(url).pathname;
    assert.ok(path.startsWith("/api/agent/leads/update-"));
    if (path.endsWith("preview")) {
      assert.equal(init.body, JSON.stringify(proposal));
      return Promise.resolve(Response.json(envelope(preview)));
    }
    if (path.endsWith("execute")) {
      assert.equal(init.body, JSON.stringify(approval));
      return Promise.resolve(Response.json(envelope(outcome)));
    }
    assert.equal(init.method, "GET");
    assert.equal(new URL(url).searchParams.get("idempotency_key"), key);
    return Promise.resolve(Response.json(envelope({ preview_id: id, state: "succeeded", retry_mutation: false,
      reconciliation_required: false, outcome: { status: 200, data: outcome } })));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  assert.equal((await client.previewLeadUpdate(proposal)).status, 200);
  assert.deepEqual((await client.executeLeadUpdate(approval)).body, envelope(outcome));
  assert.equal((await client.leadUpdateStatus({ preview_id: id, idempotency_key: key })).status, 200);
  assert.equal(request.mock.callCount(), 3);
});

await Promise.all(["network", "private", "server"].map((scenario) => test(`lead execution ${scenario} is ambiguous and never retried`, async () => {
  const request = mock.fn((): Promise<Response> => scenario === "network" ? Promise.reject(new Error("secret"))
    : Promise.resolve(Response.json(envelope({ ...outcome, resource: { ...outcome.resource, notes: "secret" } }), { status: scenario === "server" ? 503 : 200 })));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  assert.deepEqual((await client.executeLeadUpdate(approval)).body, { error: { code: "execution_ambiguous" } });
  assert.equal(request.mock.callCount(), 1);
})));

const credentials = { profile: { clientId: "client", issuer: "https://tenant.example" }, accessToken: "access-secret", refreshToken: "refresh-secret",
  expiresAt: "2099-01-01T00:00:00.000Z", scope: "customers.write" };
const storage: NonNullable<Parameters<typeof run>[1]> = {
  readCredentials: () => Promise.resolve({ default: credentials }), saveCredentials: () => Promise.resolve(), removeCredentials: () => Promise.resolve(),
};
const unexpected = (): never => { throw new Error("Unexpected operation"); };
const runtime: NonNullable<Parameters<typeof run>[2]> = {
  getCustomer: unexpected, listCustomers: unexpected, loginBrowser: unexpected, loginDevice: unexpected, revoke: unexpected,
  previewCustomerUpdate: unexpected, executeCustomerUpdate: unexpected, customerUpdateStatus: unexpected,
};

await test("lead CLI routes preview, execute and status without selecting customer mutations", async () => {
  const proposed = mock.fn((input: Parameters<NonNullable<typeof runtime.previewLeadUpdate>>[0]) => {
    assert.deepEqual(input.proposal, proposal);
    return Promise.resolve({ credentials, response: envelope(preview) });
  });
  const execute = mock.fn((input: Parameters<NonNullable<typeof runtime.executeLeadUpdate>>[0]) => {
    assert.deepEqual(input.approval, approval);
    return Promise.resolve({ credentials, response: envelope(outcome) });
  });
  const status = mock.fn((input: Parameters<NonNullable<typeof runtime.leadUpdateStatus>>[0]) => {
    assert.deepEqual(input.query, { preview_id: id, idempotency_key: key });
    return Promise.resolve({ credentials, response: envelope({ state: "succeeded", retry_mutation: false }) });
  });
  const execution = { ...runtime, previewLeadUpdate: proposed, executeLeadUpdate: execute, leadUpdateStatus: status,
    readChanges: (): Promise<Readonly<Record<string, string>>> => Promise.resolve(proposal.changes),
    readApprovalReceipt: (): Promise<string> => Promise.resolve(approval.approval_receipt) };
  assert.equal((await run(["leads", "update", "preview", resource, "--input-stdin"], storage, execution)).exitCode, 0);
  assert.equal((await run(["leads", "update", "execute", id, "--idempotency-key", key, "--receipt-stdin"], storage, execution)).exitCode, 0);
  const result = await run(["--json", "leads", "update", "status", id, "--idempotency-key", key], storage,
    { ...execution, readChanges: unexpected, readApprovalReceipt: unexpected });
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(JSON.stringify(result), /access-secret|refresh-secret|rrrrrrrr/u);
  assert.equal(proposed.mock.callCount(), 1);
  assert.equal(execute.mock.callCount(), 1);
  assert.equal(status.mock.callCount(), 1);
});

await Promise.all([
  ["preview", resource], ["execute", id, "--idempotency-key", "invalid"],
  ["execute", id, "--idempotency-key", key, "--approval-receipt", "secret"],
  ["status", id, "--idempotency-key", key, "--receipt-stdin"],
].map((args, index) => test(`rejects unsafe lead CLI options before credential access ${String(index)}`, async () => {
  const result = await run(["leads", "update", ...args], { ...storage, readCredentials: unexpected }, runtime);
  assert.equal(result.exitCode, 2);
})));
