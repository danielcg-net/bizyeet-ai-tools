# Harness validation evidence

Run `npm test` to build and exercise the installed-command contract tests in
`src/package-install.test.ts`. These tests pack the current source, install it
outside the repository, and invoke the installed binary with synthetic
credentials against a local HTTPS fixture. They do not access a production
tenant, publish a package, or evaluate a language model.

The recovery cases require an empty stdout, a structured stderr below 2 KiB,
the documented exit code, no reflected credentials or upstream instructions,
and exactly one canonical GET request. They cover permission denial,
unsupported and unavailable providers, stale cursors, a not-found response,
and a response exceeding the transport's 1 MiB limit. Oversized JSON currently
maps to `request_unavailable`; its contents must never reach the output.

Expired and server-revoked sessions exercise OAuth discovery and one rejected
refresh. Both must stop with exit code 3 and `authentication_required`, without
reflecting hostile OAuth error descriptions. An expired session makes no
business request; a revoked session makes one initial GET and never retries it
after refresh rejection. These fixtures do not prove interactive re-login or
server revocation enforcement.

Hostile error messages request credential exfiltration and a write. The test
verifies that the CLI does neither and emits locally defined recovery text.
The not-found fixture verifies response handling only, not server tenant
isolation. The existing successful-path fixture verifies bounded list and
exact-read arguments, private exports, and explicit preview/execute/status
transport, not human approval or server-side idempotency enforcement.

## Remaining acceptance

BIZYEET-648 also requires model-driven command selection and argument scoring,
record-content prompt injection, successful OAuth reauthorization, repeated
writes, real cross-tenant denial, interactive and device login, and live
Codex desktop/CLI/IDE integration. Passing the package suite alone does not
establish those outcomes. Record model, client and package versions, scenario,
observed calls, approval evidence and pass/fail results when those evaluations
run; keep credentials and business records out of the evidence.
