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

await Promise.all(["--next-page", "--help", "--json", "--profile=other", "--next=a=b"].map((cursor) =>
  test(`list preserves an explicit literal cursor value ${cursor}`, async () => {
    const list = mock.fn((input: Parameters<typeof runtime.listCustomers>[0]) => {
      assert.equal(input.options.cursor, cursor);
      assert.equal(input.profile.clientId, "client");
      assert.equal(input.options.limit, 10);
      return Promise.resolve({ credentials, response: { data: { items: [], total: 0 }, meta: { contract_version: "v1", next_cursor: null } } });
    });
    const result = await run(["--json", "customers", "list", "--profile=default", "--limit=10", `--cursor=${cursor}`], storage,
      { ...runtime, listCustomers: list });
    assert.equal(result.exitCode, 0);
    assert.equal(list.mock.callCount(), 1);
  })));

await Promise.all([
  ["--cursor="], ["--cursor=one", "--cursor", "two"], ["--cursor", "one", "--cursor=two"],
  ["--cursor=one", "--cursor=two"], ["--cursor", "--limit", "1"],
  ["--profile=default", "--profile", "default"], ["--unknown=value"],
].map((options, index) => test(`rejects malformed literal value options ${String(index)} before storage`, async () => {
  const result = await run(["customers", "list", ...options], { ...storage, readCredentials: unexpected }, runtime);
  assert.equal(result.exitCode, 2);
})));

await Promise.all(["customer:123", "opaque~id", "--customer", "--profile", "--help", "-h", "--json", "--"].map((target) =>
  test(`get and preview preserve separated opaque target ${target}`, async () => {
    const readCredentials = mock.fn((profile?: string) => {
      assert.equal(profile, "default");
      return Promise.resolve({ default: credentials });
    });
    const get = mock.fn((input: Parameters<typeof runtime.getCustomer>[0]) => {
      assert.equal(input.resourceId, target);
      return Promise.resolve({ credentials, response: { data: { id: target }, meta: { contract_version: "v1" } } });
    });
    const preview = mock.fn((input: Parameters<NonNullable<typeof runtime.previewCustomerUpdate>>[0]) => {
      assert.equal(input.proposal.resource_id, target);
      return Promise.resolve({ credentials, response: { data: { preview_id: id }, meta: { contract_version: "v1" } } });
    });
    const selected = { ...storage, readCredentials };
    const execution = { ...runtime, getCustomer: get, previewCustomerUpdate: preview, readChanges: (): Promise<Readonly<Record<string, string>>> => Promise.resolve({ business: "New" }) };
    const read = await run(["--json", "customers", "get", "--profile", "default", "--", target], selected, execution);
    assert.equal(read.exitCode, 0);
    assert.deepEqual(JSON.parse(read.message), { data: { id: target }, meta: { contract_version: "v1" } });
    const proposed = await run(["customers", "update", "preview", "--input-stdin", "--profile", "default", "--", target], selected, execution);
    assert.equal(proposed.exitCode, 0);
    assert.equal(get.mock.callCount(), 1);
    assert.equal(preview.mock.callCount(), 1);
  })));

await test("preview accepts non-option opaque IDs without a separator", async () => {
  const preview = mock.fn((input: Parameters<NonNullable<typeof runtime.previewCustomerUpdate>>[0]) => {
    assert.equal(input.proposal.resource_id, "customer:123~one");
    return Promise.resolve({ credentials, response: { data: { preview_id: id }, meta: { contract_version: "v1" } } });
  });
  const result = await run(["customers", "update", "preview", "customer:123~one", "--input-stdin"], storage,
    { ...runtime, previewCustomerUpdate: preview, readChanges: () => Promise.resolve({ business: "New" }) });
  assert.equal(result.exitCode, 0);
  assert.equal(preview.mock.callCount(), 1);
});

await Promise.all([
  ["get", "--"], ["get", "--", "one", "two"], ["get", "--profile", "--", "id"],
  ["get", "--", "../other"], ["get", "--unknown"], ["get", "one", "two"],
  ["get", "--profile", "default", "--profile", "default", "--", "id"],
  ["update", "preview", "--input-stdin", "--", "id", "--profile", "default"],
  ["update", "execute", "--idempotency-key", key, "--", "--opaque-not-uuid"],
].map((args, index) => test(`rejects ambiguous separated target ${String(index)} before storage`, async () => {
  const result = await run(["customers", ...args], { ...storage, readCredentials: unexpected }, runtime);
  assert.equal(result.exitCode, 2);
})));

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
