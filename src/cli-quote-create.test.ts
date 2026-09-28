import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { run } from "./cli.js";

const previewId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const credentials = { profile: { clientId: "client", issuer: "https://tenant.example" }, accessToken: "access-secret",
  refreshToken: "refresh-secret", expiresAt: "2099-01-01T00:00:00.000Z", scope: "customers.write" };
const storage: NonNullable<Parameters<typeof run>[1]> = { readCredentials: () => Promise.resolve({ default: credentials }),
  removeCredentials: () => Promise.resolve(), saveCredentials: () => Promise.resolve() };
const unexpected = (): never => { throw new Error("Unexpected operation"); };
const runtime: NonNullable<Parameters<typeof run>[2]> = {
  getCustomer: unexpected, listCustomers: unexpected, loginBrowser: unexpected, loginDevice: unexpected, revoke: unexpected,
};

void test("quote preview reads one private JSON proposal and preserves canonical shape", async () => {
  const quote = { customer_id: "opaque-customer", title: "Transfer", items: [{ description: "Transfer", quantity: "1", unit_price: "25.00" }] };
  const preview = mock.fn((input: Parameters<NonNullable<typeof runtime.previewQuoteCreate>>[0]) => {
    assert.deepEqual(input.proposal, { quote });
    return Promise.resolve({ credentials, response: { data: { preview_id: previewId }, meta: { contract_version: "v1" } } });
  });
  const result = await run(["quotes", "create", "preview", "--input-stdin"], storage,
    { ...runtime, previewQuoteCreate: preview, readQuoteProposal: () => Promise.resolve(quote) });
  assert.equal(result.exitCode, 0);
  assert.equal(preview.mock.callCount(), 1);
  assert.doesNotMatch(result.message, /access-secret|refresh-secret/u);
});

void test("quote execution keeps the caller key and private receipt; status is read-only", async () => {
  const execute = mock.fn((input: Parameters<NonNullable<typeof runtime.executeQuoteCreate>>[0]) => {
    assert.deepEqual(input.approval, { preview_id: previewId, idempotency_key: key, approval_receipt: "r".repeat(43) });
    return Promise.resolve({ credentials, response: { data: { audit_reference: previewId }, meta: { contract_version: "v1" } } });
  });
  const status = mock.fn((input: Parameters<NonNullable<typeof runtime.quoteCreateStatus>>[0]) => {
    assert.deepEqual(input.query, { preview_id: previewId, idempotency_key: key });
    return Promise.resolve({ credentials, response: { data: { state: "unknown", retry_mutation: false }, meta: { contract_version: "v1" } } });
  });
  const execution = { ...runtime, executeQuoteCreate: execute, quoteCreateStatus: status,
    readApprovalReceipt: (piped: boolean): Promise<string> => { assert.equal(piped, true); return Promise.resolve("r".repeat(43)); } };
  const created = await run(["quotes", "create", "execute", previewId, "--idempotency-key", key, "--receipt-stdin"], storage, execution);
  const observed = await run(["quotes", "create", "status", previewId, "--idempotency-key", key], storage, execution);
  assert.equal(created.exitCode, 0);
  assert.equal(observed.exitCode, 0);
  assert.equal(execute.mock.callCount(), 1);
  assert.equal(status.mock.callCount(), 1);
  assert.doesNotMatch(JSON.stringify([created, observed]), /rrrrrrrr|access-secret|refresh-secret/u);
});

await Promise.all([
  ["preview"], ["preview", "--input-stdin", "--input-stdin"], ["preview", "--input-stdin", "unexpected"],
  ["execute", previewId, "--idempotency-key", key, "--receipt", "secret-receipt"],
  ["execute", previewId, "--idempotency-key", "invalid"],
  ["execute", previewId, "--idempotency-key", key, "--receipt-stdin", "--receipt-stdin"],
  ["status", previewId, "--idempotency-key", key, "--receipt-stdin"],
].map((args, index) => test(`quote create rejects unsafe arguments before storage ${String(index)}`, async () => {
  const result = await run(["quotes", "create", ...args], { ...storage, readCredentials: unexpected }, runtime);
  assert.equal(result.exitCode, 2);
  assert.doesNotMatch(result.message, /secret-receipt/u);
})));
