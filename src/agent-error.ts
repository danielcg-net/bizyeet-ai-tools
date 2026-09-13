export type AgentFailure = Readonly<{
  kind: "agent_failure";
  code: string;
  status: number;
  requestId: string;
  retryable: boolean;
}>;

const codes = new Set([
  "authentication_required", "authorization_required", "authorization_denied", "invalid_request",
  "not_found", "conflict", "idempotency_conflict", "preview_expired", "approval_required",
  "invalid_cursor", "rate_limited", "internal_error", "provider_unavailable", "request_unavailable",
  "invalid_response", "unsupported_operation", "execution_ambiguous", "execution_in_progress",
]);
/** Shared safe wire-code vocabulary, including the existing server's legacy unsupported spelling. */
export const canonicalErrorCode = (value: unknown): string | undefined =>
  value === "crm_operation_unsupported" ? "unsupported_operation"
    : typeof value === "string" && codes.has(value) ? value : undefined;

const recordedFailureCodes = new Set([
  "authentication_required", "authorization_denied", "invalid_request", "not_found", "conflict",
  "idempotency_conflict", "preview_expired", "approval_required", "invalid_cursor", "rate_limited",
  "internal_error", "unsupported_operation",
]);
/** Recorded server outcomes exclude client transport and response-validation failures. */
export const recordedFailureCode = (value: unknown): string | undefined => {
  const code = canonicalErrorCode(value);
  return code !== undefined && recordedFailureCodes.has(code) ? code : undefined;
};
const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Preserve bounded printable correlation references without requiring UUID syntax. */
export const correlationReference = (value: unknown): string =>
  typeof value === "string" && value.length >= 1 && value.length <= 128
    && !/[\p{Cc}\p{Cf}\p{Cs}\p{Z}]/u.test(value)
    ? value : crypto.randomUUID();

/** Retains machine semantics without reflecting server messages, details or credentials. */
export const agentFailure = (status: number, body: unknown): AgentFailure => {
  const error = record(body) && record(body.error) ? body.error : {};
  const code = canonicalErrorCode(error.code) ?? "internal_error";
  const requestId = correlationReference(error.request_id);
  return Object.freeze({ kind: "agent_failure", code, status, requestId,
    retryable: ["execution_ambiguous", "execution_in_progress"].includes(code) ? false
      : typeof error.retryable === "boolean" ? error.retryable : status === 429 || status >= 500 });
};

/** Recognizes only the typed internal failure boundary. */
export const isAgentFailure = (value: unknown): value is AgentFailure => record(value) && value.kind === "agent_failure"
  && typeof value.code === "string" && codes.has(value.code) && typeof value.status === "number"
  && typeof value.requestId === "string" && typeof value.retryable === "boolean";

/** Maps the common API contract to stable CLI exit codes. */
export const agentFailureExitCode = (failure: AgentFailure): number => {
  if (["authentication_required", "authorization_required"].includes(failure.code) || failure.status === 401) return 3;
  if (failure.code === "authorization_denied" || failure.status === 403) return 4;
  if (["approval_required", "preview_expired", "idempotency_conflict"].includes(failure.code)) return 5;
  if (["not_found", "conflict"].includes(failure.code)) return 6;
  if (["invalid_request", "invalid_cursor", "unsupported_operation"].includes(failure.code)) return 2;
  return failure.retryable ? 7 : 1;
};

/** Emits local safe recovery copy; never repeats an upstream error payload. */
export const agentFailureMessage = (failure: AgentFailure): string => {
  if (["execution_ambiguous", "execution_in_progress"].includes(failure.code)) return "Read the outcome with customers update status using the original preview ID and idempotency key. Do not retry with a new idempotency key or create a replacement write.";
  if (agentFailureExitCode(failure) === 3) return "Run auth login to reconnect this profile.";
  if (failure.code === "invalid_cursor") return "Start a fresh list request without the expired or incompatible cursor.";
  if (failure.code === "authorization_denied") return "You do not have permission for this operation.";
  if (failure.code === "unsupported_operation") return "This operation is not supported by the configured service.";
  return failure.retryable ? "The service is temporarily unavailable. Retry later." : "The service could not complete this request.";
};
