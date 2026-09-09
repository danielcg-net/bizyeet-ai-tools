# Customer write transport

The real server preview request_hash is a 43-character base64url SHA-256 digest,
not a 64-character hex digest. Keep fixture encoding aligned with this contract.
The private cross-repository test uses real CLI processes, local OAuth and human
browser approval over ephemeral HTTPS; fake HTTP responses alone missed this gap.

The canonical client exposes only customer update preview and execute methods,
using explicit OAuth agent endpoints. Provider policy and business field
validation remain server-owned; never import private provider code here.

Input JSON is bounded to 16 KiB and successful/error write responses to 32 KiB.
Execution retains the supplied preview, receipt and idempotency key. No mutation
POST retries, including after a 401; refresh rotation may occur before dispatch
and must be persisted before business I/O. Read retry behavior is separate.

Lost responses, malformed successes and execution server failures are ambiguous.
Never advertise them as retryable, generate a replacement idempotency key or
silently submit a new preview. Only documented safe result fields are returned;
unexpected receipt fields and nested/private record fields must not leak.

CLI commands are customers update preview (JSON changes via --input-stdin) and
customers update execute (preview UUID plus caller-owned --idempotency-key).
Receipt entry uses hidden raw-mode terminal input or explicit --receipt-stdin.
No receipt argv/environment/file-path flag. Restore terminal mode on completion
and Ctrl+C, bound pipe bytes and timeout, and never reflect parser diagnostics.
Installed package tests exercise piped preview/execute over trusted local HTTPS.
Real terminal manual checks verify no echo and mode restoration on success/cancel.
Remaining: integrated real server/CLI browser proof, cross-platform new-head CI
and review/release gates. Draft implementation is not a publication/deployment.
# Read response bound

Canonical list/detail and error JSON responses share the streamed bounded reader
with writes: 1 MiB for reads, 32 KiB for writes. Count actual UTF-8 bytes, not a
Content-Length promise; cancel oversized streams and release the reader lock.
Oversized/malformed body failures are explicit and do not retry HTTP responses
or become empty results. Tests include exact-limit success and oversized list,
detail and error streams with a deceptive length header.
