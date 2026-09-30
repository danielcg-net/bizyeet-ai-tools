import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { run } from "./cli.js";

const leadId = `crm1.${"a".repeat(64)}.leads.123`;
const previewId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const receipt = "r".repeat(43);
const credentials = { profile: { clientId: "client", issuer: "https://tenant.example" }, accessToken: "access-secret",
  refreshToken: "refresh-secret", expiresAt: "2099-01-01T00:00:00.000Z", scope: "leads.promote" };
const storage: NonNullable<Parameters<typeof run>[1]> = {
  readCredentials: () => Promise.resolve({ default: credentials }), saveCredentials: () => Promise.resolve(), removeCredentials: () => Promise.resolve(),
};
const unexpected = (): never => { throw new Error("Unexpected operation"); };
const runtime: NonNullable<Parameters<typeof run>[2]> = {
  getCustomer: unexpected, listCustomers: unexpected, loginBrowser: unexpected, loginDevice: unexpected, revoke: unexpected,
};
const envelope = (data: unknown): Readonly<Record<string, unknown>> => ({ data, meta: { contract_version: "v1", request_id: "synthetic" } });

await test("promotion CLI routes preview, execute and status without placing receipt in arguments", async () => {
  const preview = mock.fn((input: Parameters<NonNullable<typeof runtime.previewLeadPromotion>>[0]) => {
    assert.deepEqual(input.proposal, { record: { leadId } });
    return Promise.resolve({ credentials, response: envelope({ preview_id: previewId, approval_path: `/dashboard/#/agent-approvals/${previewId}` }) });
  });
  const execute = mock.fn((input: Parameters<NonNullable<typeof runtime.executeLeadPromotion>>[0]) => {
    assert.deepEqual(input.approval, { preview_id: previewId, approval_receipt: receipt, idempotency_key: key });
    return Promise.resolve({ credentials, response: envelope({ audit_reference: previewId }) });
  });
  const status = mock.fn((input: Parameters<NonNullable<typeof runtime.leadPromotionStatus>>[0]) => {
    assert.deepEqual(input.query, { preview_id: previewId, idempotency_key: key });
    return Promise.resolve({ credentials, response: envelope({ state: "succeeded", retry_mutation: false }) });
  });
  const execution = { ...runtime, previewLeadPromotion: preview, executeLeadPromotion: execute, leadPromotionStatus: status,
    readApprovalReceipt: (): Promise<string> => Promise.resolve(receipt) };
  assert.equal((await run(["leads", "promote", "preview", leadId], storage, execution)).exitCode, 0);
  assert.equal((await run(["leads", "promote", "execute", previewId, "--idempotency-key", key, "--receipt-stdin"], storage, execution)).exitCode, 0);
  const result = await run(["--json", "leads", "promote", "status", previewId, "--idempotency-key", key], storage,
    { ...execution, readApprovalReceipt: unexpected });
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(JSON.stringify(result), /access-secret|refresh-secret|rrrrrrrr/u);
  assert.equal(preview.mock.callCount(), 1);
  assert.equal(execute.mock.callCount(), 1);
  assert.equal(status.mock.callCount(), 1);
});

await Promise.all([
  ["preview", "bad/id"], ["preview", leadId, "--input-stdin"],
  ["execute", previewId, "--idempotency-key", "invalid"],
  ["execute", previewId, "--idempotency-key", key, "--approval-receipt", "secret"],
  ["status", previewId, "--idempotency-key", key, "--receipt-stdin"],
].map((args, index) => test(`rejects unsafe promotion CLI options before credential access ${String(index)}`, async () => {
  const result = await run(["leads", "promote", ...args], { ...storage, readCredentials: unexpected }, runtime);
  assert.equal(result.exitCode, 2);
})));
