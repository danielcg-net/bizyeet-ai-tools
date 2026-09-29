import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { run } from "./cli.js";

const previewId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const proposal = { customerId: "sales1.fingerprint.customers.customer", name: "Transfer",
  items: [{ description: "Ride", quantity: "1", unitPrice: "25.00" }] };
const credentials = { profile: { clientId: "client", issuer: "https://tenant.example" }, accessToken: "access-secret",
  refreshToken: "refresh-secret", expiresAt: "2099-01-01T00:00:00.000Z", scope: "customers.write" };
const storage: NonNullable<Parameters<typeof run>[1]> = { readCredentials: () => Promise.resolve({ default: credentials }),
  removeCredentials: () => Promise.resolve(), saveCredentials: () => Promise.resolve() };
const unexpected = (): never => { throw new Error("Unexpected operation"); };
const runtime: NonNullable<Parameters<typeof run>[2]> = {
  getCustomer: unexpected, listCustomers: unexpected, loginBrowser: unexpected, loginDevice: unexpected, revoke: unexpected,
};

void test("service-create preview reads one bounded private proposal and sends only that object", async () => {
  const preview = mock.fn((input: Parameters<NonNullable<typeof runtime.previewServiceCreate>>[0]) => {
    assert.deepEqual(input.proposal, { service: proposal });
    return Promise.resolve({ credentials, response: { data: { preview_id: previewId }, meta: { contract_version: "v1" } } });
  });
  const output = await run(["services", "create", "preview", "--input-stdin"], storage, { ...runtime,
    readServiceProposal: () => Promise.resolve(proposal), previewServiceCreate: preview });
  assert.equal(output.exitCode, 0);
  assert.equal(preview.mock.callCount(), 1);
  assert.doesNotMatch(output.message, /access-secret|refresh-secret/u);
});

void test("service-create execute preserves human receipt and status does not repeat creation", async () => {
  const execute = mock.fn((input: Parameters<NonNullable<typeof runtime.executeServiceCreate>>[0]) => {
    assert.deepEqual(input.approval, { preview_id: previewId, idempotency_key: key, approval_receipt: "r".repeat(43) });
    return Promise.resolve({ credentials, response: { data: { audit_reference: previewId }, meta: { contract_version: "v1" } } });
  });
  const status = mock.fn((input: Parameters<NonNullable<typeof runtime.serviceCreateStatus>>[0]) => {
    assert.deepEqual(input.query, { preview_id: previewId, idempotency_key: key });
    return Promise.resolve({ credentials, response: { data: { state: "unknown", retry_mutation: false }, meta: { contract_version: "v1" } } });
  });
  const execution = { ...runtime, executeServiceCreate: execute, serviceCreateStatus: status,
    readApprovalReceipt: (piped: boolean): Promise<string> => { assert.equal(piped, true); return Promise.resolve("r".repeat(43)); } };
  const created = await run(["services", "create", "execute", previewId, "--idempotency-key", key, "--receipt-stdin"], storage, execution);
  const observed = await run(["services", "create", "status", previewId, "--idempotency-key", key], storage, execution);
  assert.equal(created.exitCode, 0);
  assert.equal(observed.exitCode, 0);
  assert.equal(execute.mock.callCount(), 1);
  assert.equal(status.mock.callCount(), 1);
  assert.doesNotMatch(JSON.stringify([created, observed]), /rrrrrrrr|access-secret|refresh-secret/u);
});

await Promise.all([
  ["preview"], ["preview", "--input-stdin", "--input-stdin"], ["preview", "unexpected", "--input-stdin"],
  ["execute", previewId, "--idempotency-key", "invalid"],
  ["status", previewId, "--idempotency-key", key, "--receipt-stdin"],
].map((args, index) => test("service create rejects unsafe arguments before credentials " + String(index), async () => {
  const output = await run(["services", "create", ...args], { ...storage, readCredentials: unexpected }, runtime);
  assert.equal(output.exitCode, 2);
})));
