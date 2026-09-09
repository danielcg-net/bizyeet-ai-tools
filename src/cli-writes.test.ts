import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { run } from "./cli.js";
import { agentFailure } from "./agent-error.js";

const id = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const credentials = { profile: { clientId: "client", issuer: "https://tenant.example" }, accessToken: "access-secret", refreshToken: "refresh-secret", expiresAt: "2099-01-01T00:00:00.000Z", scope: "customers.write" };
const storage: NonNullable<Parameters<typeof run>[1]> = {
  readCredentials: () => Promise.resolve({ default: credentials }),
  removeCredentials: () => Promise.resolve(), saveCredentials: () => Promise.resolve(),
};
const unexpected = (): never => { throw new Error("Unexpected operation"); };
const runtime: NonNullable<Parameters<typeof run>[2]> = {
  getCustomer: unexpected, listCustomers: unexpected, loginBrowser: unexpected, loginDevice: unexpected, revoke: unexpected,
};

await test("preview reads only piped changes and passes the selected canonical identifier", async () => {
  const preview = mock.fn((input: Parameters<NonNullable<typeof runtime.previewCustomerUpdate>>[0]) => {
    assert.deepEqual(input.proposal, { resource_id: "canonical-id", changes: { business: "New name" } });
    return Promise.resolve({ credentials, response: { data: { preview_id: id }, meta: { contract_version: "v1" } } });
  });
  const result = await run(["customers", "update", "preview", "canonical-id", "--input-stdin"], storage,
    { ...runtime, readChanges: () => Promise.resolve({ business: "New name" }), previewCustomerUpdate: preview });
  assert.equal(result.exitCode, 0);
  assert.equal(preview.mock.callCount(), 1);
  assert.doesNotMatch(result.message, /access-secret|refresh-secret/u);
});

await test("execute receives receipt through injected hidden input and preserves supplied identity", async () => {
  const execute = mock.fn((input: Parameters<NonNullable<typeof runtime.executeCustomerUpdate>>[0]) => {
    assert.deepEqual(input.approval, { preview_id: id, idempotency_key: key, approval_receipt: "r".repeat(43) });
    return Promise.resolve({ credentials, response: { data: { audit_reference: id }, meta: { contract_version: "v1" } } });
  });
  const result = await run(["customers", "update", "execute", id, "--idempotency-key", key], storage,
    { ...runtime, readApprovalReceipt: (piped) => { assert.equal(piped, false); return Promise.resolve("r".repeat(43)); }, executeCustomerUpdate: execute });
  assert.equal(result.exitCode, 0);
  assert.equal(execute.mock.callCount(), 1);
  assert.doesNotMatch(result.message, /rrrrrrrr|access-secret/u);
});

await Promise.all([
  ["preview", "canonical-id"],
  ["preview", "canonical-id", "--input-stdin", "--input-stdin"],
  ["execute", id, "--idempotency-key", key, "--receipt", "secret-receipt"],
  ["execute", id, "--idempotency-key", "invalid"],
  ["execute", id, "--idempotency-key", key, "--idempotency-key", key],
].map((args, index) => test(`rejects unsafe write arguments ${String(index)} before input or credentials`, async () => {
  const forbidden = { ...storage, readCredentials: unexpected };
  const result = await run(["customers", "update", ...args], forbidden, runtime);
  assert.equal(result.exitCode, 2);
  assert.doesNotMatch(result.message, /secret-receipt/u);
})));

await test("ambiguous write response is not retryable and does not leak receipt", async () => {
  const failure = agentFailure(503, { error: { code: "execution_ambiguous", retryable: true, message: "secret-receipt" } });
  const result = await run(["customers", "update", "execute", id, "--idempotency-key", key, "--receipt-stdin"], storage,
    { ...runtime, readApprovalReceipt: (piped) => { assert.equal(piped, true); return Promise.resolve("r".repeat(43)); },
      executeCustomerUpdate: () => Promise.reject(new Error("secret-receipt", { cause: failure })) });
  assert.notEqual(result.exitCode, 0);
  assert.match(result.message, /"retryable":false/u);
  assert.match(result.message, /Do not retry/u);
  assert.doesNotMatch(result.message, /secret-receipt/u);
});
