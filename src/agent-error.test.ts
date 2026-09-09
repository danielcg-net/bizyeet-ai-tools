import assert from "node:assert/strict";
import { test } from "node:test";
import { agentFailure, agentFailureExitCode, agentFailureMessage, correlationReference } from "./agent-error.js";

await Promise.all(["req_abc", "opaque:request-1", "x".repeat(128)].map((id) => test(`preserves opaque correlation ${id.slice(0, 20)}`, () => {
  assert.equal(agentFailure(400, { error: { code: "invalid_request", request_id: id } }).requestId, id);
})));
await Promise.all([undefined, null, 3, "", "x".repeat(129), "Bearer secret", "id\n", "id\u007f"].map((id, index) => test(`replaces unsafe correlation case ${String(index)}`, () => {
  assert.match(correlationReference(id), /^[a-f0-9-]{36}$/u);
})));

await Promise.all([
  { code: "authorization_required", status: 401, exit: 3 },
  { code: "authorization_denied", status: 403, exit: 4 },
  { code: "approval_required", status: 409, exit: 5 },
  { code: "preview_expired", status: 409, exit: 5 },
  { code: "idempotency_conflict", status: 409, exit: 5 },
  { code: "conflict", status: 409, exit: 6 },
  { code: "not_found", status: 404, exit: 6 },
  { code: "invalid_cursor", status: 400, exit: 2 },
  { code: "unsupported_operation", status: 422, exit: 2 },
  { code: "provider_unavailable", status: 503, exit: 7 },
  { code: "rate_limited", status: 429, exit: 7 },
  { code: "internal_error", status: 500, exit: 1, retryable: false },
].map(({ code, status, exit, retryable }) => test(`maps ${code} to exit ${String(exit)}`, () => {
  const failure = agentFailure(status, { error: { code, ...(retryable === undefined ? {} : { retryable }) } });
  assert.equal(agentFailureExitCode(failure), exit);
})));

await test("preserves safe correlation metadata but never untrusted messages or details", () => {
  const requestId = "12345678-1234-1234-1234-123456789abc";
  const failure = agentFailure(400, { error: { code: "invalid_cursor", request_id: requestId, retryable: false,
    message: "Bearer secret-access", details: { refresh_token: "secret-refresh" } } });
  assert.equal(failure.requestId, requestId);
  assert.equal(failure.retryable, false);
  assert.match(agentFailureMessage(failure), /fresh list/u);
  assert.doesNotMatch(JSON.stringify(failure), /secret-access|secret-refresh/u);
  const unknown = agentFailure(500, { error: { code: "secret-code", request_id: "secret-id\n" } });
  assert.equal(unknown.code, "internal_error");
  assert.notEqual(unknown.requestId, "secret-id\n");
});
