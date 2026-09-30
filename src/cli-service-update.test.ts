import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { run } from "./cli.js";

const serviceId = "sales1.fingerprint.services.service";
const previewId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const proposal = { name: "Revised transfer", expectedPricingRevision: 3, pricingCurrency: "CAD",
  items: [{ id: "sales1.fingerprint.services.service.items.line", description: "Ride", quantity: "2", unitPrice: "25.00" }] };
const credentials = { profile: { clientId: "client", issuer: "https://tenant.example" }, accessToken: "access-secret",
  refreshToken: "refresh-secret", expiresAt: "2099-01-01T00:00:00.000Z", scope: "customers.write" };
const unexpected = (): never => { throw new Error("Unexpected operation"); };
const storage: NonNullable<Parameters<typeof run>[1]> = { readCredentials: () => Promise.resolve({ default: credentials }),
  removeCredentials: () => Promise.resolve(), saveCredentials: () => Promise.resolve() };
const runtime: NonNullable<Parameters<typeof run>[2]> = {
  getCustomer: unexpected, listCustomers: unexpected, loginBrowser: unexpected, loginDevice: unexpected, revoke: unexpected,
};

void test("service-update preview binds one opaque service ID to the private proposal", async () => {
  const preview = mock.fn((input: Parameters<NonNullable<typeof runtime.previewServiceUpdate>>[0]) => {
    assert.deepEqual(input.proposal, { resource_id: serviceId, service: proposal });
    return Promise.resolve({ credentials, response: { data: { preview_id: previewId }, meta: { contract_version: "v1" } } });
  });
  const output = await run(["services", "update", "preview", serviceId, "--input-stdin"], storage, { ...runtime,
    readServiceProposal: () => Promise.resolve(proposal), previewServiceUpdate: preview });
  assert.equal(output.exitCode, 0);
  assert.equal(preview.mock.callCount(), 1);
  assert.doesNotMatch(output.message, /access-secret|refresh-secret/u);
});

void test("service-update execution preserves human receipt and status only reads prior outcome", async () => {
  const execute = mock.fn((input: Parameters<NonNullable<typeof runtime.executeServiceUpdate>>[0]) => {
    assert.deepEqual(input.approval, { preview_id: previewId, idempotency_key: key, approval_receipt: "r".repeat(43) });
    return Promise.resolve({ credentials, response: { data: { audit_reference: previewId }, meta: { contract_version: "v1" } } });
  });
  const status = mock.fn((input: Parameters<NonNullable<typeof runtime.serviceUpdateStatus>>[0]) => {
    assert.deepEqual(input.query, { preview_id: previewId, idempotency_key: key });
    return Promise.resolve({ credentials, response: { data: { state: "unknown", retry_mutation: false }, meta: { contract_version: "v1" } } });
  });
  const execution = { ...runtime, executeServiceUpdate: execute, serviceUpdateStatus: status,
    readApprovalReceipt: (piped: boolean): Promise<string> => { assert.equal(piped, true); return Promise.resolve("r".repeat(43)); } };
  const updated = await run(["services", "update", "execute", previewId, "--idempotency-key", key, "--receipt-stdin"], storage, execution);
  const observed = await run(["services", "update", "status", previewId, "--idempotency-key", key], storage, execution);
  assert.equal(updated.exitCode, 0);
  assert.equal(observed.exitCode, 0);
  assert.equal(execute.mock.callCount(), 1);
  assert.equal(status.mock.callCount(), 1);
  assert.doesNotMatch(JSON.stringify([updated, observed]), /rrrrrrrr|access-secret|refresh-secret/u);
});

await Promise.all([
  ["preview", "--input-stdin"], ["preview", serviceId, "--input-stdin", "--input-stdin"],
  ["preview", "/bad", "--input-stdin"], ["execute", previewId, "--idempotency-key", "invalid"],
  ["status", previewId, "--idempotency-key", key, "--receipt-stdin"],
].map((args, index) => test("service update rejects unsafe arguments before credentials " + String(index), async () => {
  const output = await run(["services", "update", ...args], { ...storage, readCredentials: unexpected }, runtime);
  assert.equal(output.exitCode, 2);
})));
