import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { run } from "./cli.js";
import { agentFailure } from "./agent-error.js";

const id = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const receipt = "r".repeat(43);
const record = { business: "New record", email: "new@example.invalid" };
const credentials = { profile: { clientId: "client", issuer: "https://tenant.example" }, accessToken: "access-secret", refreshToken: "refresh-secret",
  expiresAt: "2099-01-01T00:00:00.000Z", scope: "customers.write" };
const storage: NonNullable<Parameters<typeof run>[1]> = {
  readCredentials: () => Promise.resolve({ default: credentials }), saveCredentials: () => Promise.resolve(), removeCredentials: () => Promise.resolve(),
};
const unexpected = (): never => { throw new Error("Unexpected operation"); };
const runtime: NonNullable<Parameters<typeof run>[2]> = {
  getCustomer: unexpected, listCustomers: unexpected, loginBrowser: unexpected, loginDevice: unexpected, revoke: unexpected,
};
const envelope = (data: unknown): Readonly<Record<string, unknown>> => ({ data, meta: { contract_version: "v1", request_id: "synthetic" } });

await Promise.all((["customers", "leads"] as const).map((kind) => test(`${kind} CLI routes create preview, execute and status with private input`, async () => {
  const preview = mock.fn((input: Parameters<NonNullable<typeof runtime.previewCustomerCreate>>[0]) => {
    assert.deepEqual(input.proposal, { record });
    return Promise.resolve({ credentials, response: envelope({ preview_id: id, approval_path: `/dashboard/#/agent-approvals/${id}` }) });
  });
  const execute = mock.fn((input: Parameters<NonNullable<typeof runtime.executeCustomerCreate>>[0]) => {
    assert.deepEqual(input.approval, { preview_id: id, approval_receipt: receipt, idempotency_key: key });
    return Promise.resolve({ credentials, response: envelope({ resource: { id: "opaque" }, audit_reference: id }) });
  });
  const status = mock.fn((input: Parameters<NonNullable<typeof runtime.customerCreateStatus>>[0]) => {
    assert.deepEqual(input.query, { preview_id: id, idempotency_key: key });
    return Promise.resolve({ credentials, response: envelope({ state: "succeeded", retry_mutation: false }) });
  });
  const execution = { ...runtime, ...(kind === "customers" ? {
    previewCustomerCreate: preview, executeCustomerCreate: execute, customerCreateStatus: status,
  } : { previewLeadCreate: preview, executeLeadCreate: execute, leadCreateStatus: status }),
    readRecordProposal: (resource: "customers" | "leads"): Promise<Readonly<Record<string, string | null>>> => {
      assert.equal(resource, kind);
      return Promise.resolve(record);
    },
    readApprovalReceipt: (): Promise<string> => Promise.resolve(receipt) };
  assert.equal((await run([kind, "create", "preview", "--input-stdin"], storage, execution)).exitCode, 0);
  assert.equal((await run([kind, "create", "execute", id, "--idempotency-key", key, "--receipt-stdin"], storage, execution)).exitCode, 0);
  const result = await run(["--json", kind, "create", "status", id, "--idempotency-key", key], storage,
    { ...execution, readRecordProposal: unexpected, readApprovalReceipt: unexpected });
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(JSON.stringify(result), /access-secret|refresh-secret|rrrrrrrr/u);
  assert.equal(preview.mock.callCount(), 1);
  assert.equal(execute.mock.callCount(), 1);
  assert.equal(status.mock.callCount(), 1);
})));

await Promise.all([
  ["preview", "id", "--input-stdin"], ["execute", id, "--idempotency-key", "invalid"],
  ["execute", id, "--idempotency-key", key, "--approval-receipt", "secret"],
  ["status", id, "--idempotency-key", key, "--receipt-stdin"],
].map((args, index) => test(`rejects unsafe create CLI options before credential access ${String(index)}`, async () => {
  const result = await run(["customers", "create", ...args], { ...storage, readCredentials: unexpected }, runtime);
  assert.equal(result.exitCode, 2);
})));

await test("ambiguous record creation names both create status commands without exposing upstream details", async () => {
  const execute = mock.fn(() => Promise.reject(new Error("Agent request failed", { cause: agentFailure(503,
    { error: { code: "execution_ambiguous", message: "private-provider-detail" } }) })));
  const result = await run(["customers", "create", "execute", id, "--idempotency-key", key, "--receipt-stdin"], storage,
    { ...runtime, executeCustomerCreate: execute, readApprovalReceipt: () => Promise.resolve(receipt) });
  assert.equal(result.exitCode, 1);
  assert.equal(execute.mock.callCount(), 1);
  assert.match(JSON.stringify(result), /customers create status for a customer/u);
  assert.match(JSON.stringify(result), /leads create status for a lead/u);
  assert.doesNotMatch(JSON.stringify(result), /private-provider-detail|access-secret|refresh-secret|rrrrrrrr/u);
});
