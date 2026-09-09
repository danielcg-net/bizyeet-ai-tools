# Customer write transport

The real server preview request_hash is a 43-character base64url SHA-256 digest,
not a 64-character hex digest. Keep fixture encoding aligned with this contract.
The private cross-repository test uses real CLI processes, local OAuth and human
browser approval over ephemeral HTTPS; fake HTTP responses alone missed this gap.

The canonical client exposes customer update preview, execute and read-only status methods,
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
`customers update status` takes the original preview UUID and --idempotency-key,
never a receipt or changes. It calls only GET /api/agent/customers/update-status.
Pending/unknown reads have null outcome; terminal reads contain the projected
original outcome. HTTP/CLI success means the lookup succeeded, not the mutation.
Unknown and ambiguous require reconciliation; retry_mutation is always false.
The five-minute pending presentation is not a reclaimable execution lease.
Remaining: integrated real server/CLI browser proof, cross-platform new-head CI
and review/release gates. Draft implementation is not a publication/deployment.
# Read response bound

Authorization URL construction retains discovery-provided query parameters
(RFC6749 section3.1), but generated state/client/PKCE/resource fields replace
all same-name endpoint values so duplicates cannot override their binding.
The merge uses new URLSearchParams values without mutating metadata.

Resource commands accept lazy OAuth discovery, evaluated only after protected
identity validation when refresh is needed. Valid tokens do not depend on
discovery availability; login and revocation still discover normally. Persist
rotated credentials before resource access and never replay a mutation on 401.
Piped changes and receipts use iterative bounded decoding, not recursive copied
chunk arrays. Preserve byte limits, fatal UTF-8 validation and opaque errors.

Canonical list/detail and error JSON responses share the streamed bounded reader
with writes: 1 MiB for reads, 32 KiB for writes. Count actual UTF-8 bytes, not a
Content-Length promise; cancel oversized streams and release the reader lock.
Oversized/malformed body failures are explicit and do not retry HTTP responses
or become empty results. Tests include exact-limit success and oversized list,
detail and error streams with a deceptive length header.
