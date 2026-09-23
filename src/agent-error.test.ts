import assert from "node:assert/strict";
import { test } from "node:test";
import { agentFailure, agentFailureExitCode, agentFailureMessage, correlationReference, isAgentFailure, recordedFailureCode } from "./agent-error.js";

await Promise.all([
  ["payment_operation_unsupported", "unsupported_operation", 2],
  ["payment_provider_unsupported", "unsupported_operation", 2],
  ["payment_provider_unavailable", "provider_unavailable", 1],
  ["payment_provider_invalid_response", "invalid_response", 1],
  ["catalog_provider_unavailable", "provider_unavailable", 1],
  ["catalog_provider_invalid_response", "invalid_response", 1],
  ["provider_configuration_changed", "conflict", 6],
].map(([wire, code, exit]) => test(`normalizes canonical read failure ${String(wire)}`, () => {
  const failure = agentFailure(503, { error: { code: wire, retryable: false, message: "private-provider-message" } });
  assert.equal(failure.code, code);
  assert.equal(agentFailureExitCode(failure), exit);
  assert.equal(isAgentFailure(failure), true);
  assert.equal(recordedFailureCode(wire), undefined);
  assert.doesNotMatch(JSON.stringify(failure) + agentFailureMessage(failure), /private-provider-message/u);
})));

await Promise.all(["__proto__", "constructor", "toString"].map((code) => test(`error aliases reject inherited property ${code}`, () => {
  assert.equal(agentFailure(503, { error: { code } }).code, "internal_error");
})));

await Promise.all([undefined, false, true].map((retryable) => test(`catalog capacity is actionable without blind retries: ${String(retryable)}`, () => {
  const failure = agentFailure(503, { error: { code: "catalog_provider_limit_exceeded", retryable,
    message: "private-provider-detail", details: { token: "private-token" } } });
  assert.equal(failure.code, "catalog_provider_limit_exceeded");
  assert.equal(failure.retryable, false);
  assert.equal(isAgentFailure(failure), true);
  assert.equal(agentFailureExitCode(failure), 1);
  assert.match(agentFailureMessage(failure), /bounded read capacity/u);
  assert.doesNotMatch(JSON.stringify(failure) + agentFailureMessage(failure), /private-provider-detail|private-token/u);
  assert.equal(recordedFailureCode(failure.code), undefined);
})));

await Promise.all([undefined, false, true].map((retryable) => test(`customer configuration failure is actionable and never auto-retryable: ${String(retryable)}`, () => {
  const failure = agentFailure(503, { error: { code: "customer_provider_not_configured", retryable,
    message: "secret-provider-config", details: { token: "secret-token" } } });
  assert.equal(failure.code, "customer_provider_not_configured");
  assert.equal(failure.retryable, false);
  assert.equal(isAgentFailure(failure), true);
  assert.equal(agentFailureExitCode(failure), 1);
  assert.match(agentFailureMessage(failure), /tenant administrator.*customer provider/u);
  assert.doesNotMatch(JSON.stringify(failure) + agentFailureMessage(failure), /secret-provider-config|secret-token/u);
  assert.equal(recordedFailureCode(failure.code), undefined);
})));

await Promise.all(["req_abc", "opaque:request-1", "x".repeat(128), "référence:😀"].map((id) => test(`preserves opaque correlation ${id.slice(0, 20)}`, () => {
  assert.equal(agentFailure(400, { error: { code: "invalid_request", request_id: id } }).requestId, id);
})));
await Promise.all([undefined, null, 3, "", "x".repeat(129), "Bearer secret", "id\n", "id\u007f", "id\u009b", "id\u0085", "id\u00a0", "id\u2028", "id\u2029", "id\u202e", "id\u200b", "id\ud800"].map((id, index) => test(`replaces unsafe correlation case ${String(index)}`, () => {
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
