import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { run } from "./cli.js";

const serviceId = "sales1.fingerprint.services.service";
const previewId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const receipt = `${"aB9_-".repeat(8)}aB9`;
const credentials = { profile: { clientId: "client", issuer: "https://tenant.example" }, accessToken: "access-secret",
  refreshToken: "refresh-secret", expiresAt: "2099-01-01T00:00:00.000Z", scope: "customers.write mail.send" };
const unexpected = (): never => { throw new Error("Unexpected operation"); };
const storage: NonNullable<Parameters<typeof run>[1]> = { readCredentials: () => Promise.resolve({ default: credentials }),
  removeCredentials: () => Promise.resolve(), saveCredentials: () => Promise.resolve() };
const runtime: NonNullable<Parameters<typeof run>[2]> = {
  getCustomer: unexpected, listCustomers: unexpected, loginBrowser: unexpected, loginDevice: unexpected, revoke: unexpected,
};

void test("delivery preview binds exactly one opaque service without effects", async () => {
  const preview = mock.fn((input: Parameters<NonNullable<typeof runtime.previewServiceDelivery>>[0]) => {
    assert.deepEqual(input.proposal, { resource_id: serviceId });
    return Promise.resolve({ credentials, response: { data: { preview_id: previewId }, meta: { contract_version: "v1" } } });
  });
  const output = await run(["services", "deliver", "preview", serviceId], storage, { ...runtime, previewServiceDelivery: preview });
  assert.equal(output.exitCode, 0);
  assert.equal(preview.mock.callCount(), 1);
  assert.doesNotMatch(output.message, /access-secret|refresh-secret/u);
});

void test("delivery executes only with a human receipt and observes status without another mutation", async () => {
  const execute = mock.fn((input: Parameters<NonNullable<typeof runtime.executeServiceDelivery>>[0]) => {
    assert.deepEqual(input.approval, { preview_id: previewId, idempotency_key: key, approval_receipt: receipt });
    return Promise.resolve({ credentials, response: { data: { audit_reference: previewId }, meta: { contract_version: "v1" } } });
  });
  const status = mock.fn((input: Parameters<NonNullable<typeof runtime.serviceDeliveryStatus>>[0]) => {
    assert.deepEqual(input.query, { preview_id: previewId, idempotency_key: key });
    return Promise.resolve({ credentials, response: { data: { state: "unknown", retry_mutation: false }, meta: { contract_version: "v1" } } });
  });
  const execution = { ...runtime, executeServiceDelivery: execute, serviceDeliveryStatus: status,
    readApprovalReceipt: (piped: boolean): Promise<string> => { assert.equal(piped, true); return Promise.resolve(receipt); } };
  const result = await run(["services", "deliver", "execute", previewId, "--idempotency-key", key, "--receipt-stdin"], storage, execution);
  const observed = await run(["services", "deliver", "status", previewId, "--idempotency-key", key], storage, execution);
  assert.equal(result.exitCode, 0);
  assert.equal(observed.exitCode, 0);
  assert.equal(execute.mock.callCount(), 1);
  assert.equal(status.mock.callCount(), 1);
  assert.equal(JSON.stringify([result, observed]).includes(receipt), false);
  assert.doesNotMatch(JSON.stringify([result, observed]), /access-secret|refresh-secret/u);
});

await Promise.all([
  ["preview", serviceId, "--status", "delivered"], ["preview", "/bad"], ["preview", serviceId, "--profile", "one", "--profile", "two"],
  ["execute", previewId, "--idempotency-key", "invalid"], ["status", previewId, "--idempotency-key", key, "--receipt-stdin"],
].map((args, index) => test("service delivery rejects unsafe arguments before credentials " + String(index), async () => {
  const output = await run(["services", "deliver", ...args], { ...storage, readCredentials: unexpected }, runtime);
  assert.equal(output.exitCode, 2);
})));
