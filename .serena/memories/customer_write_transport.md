# Customer write transport

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

These are transport/session functions, not yet a shipped CLI command workflow.
Remaining work includes bounded secret-safe input, command parsing/discovery,
installed-command and real server integration tests, and review/delivery gates.
