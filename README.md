# BizYeet AI Tools

Public CLI, MCP adapter, schemas, and Codex guidance for tenant-authorized BizYeet AI agents.

The shared `createCanonicalCrmClient` transport is available for CLI/MCP adapters
after their OAuth flow obtains a resource-bound access token. It calls only the
canonical agent API and preserves server counts, opaque IDs, cursors and errors.
It does not implement login or add user-facing CLI commands. See the
[canonical read contract](docs/canonical-crm-contract.md).

## Security model

The CLI authenticates a human tenant user through OAuth. It never uses API
keys, personal access tokens, shared dashboard passwords, or embedded client
secrets. The server derives tenant identity and intersects OAuth scopes with
the user's current BizYeet permissions on every request.

This repository intentionally excludes BizYeet backend source, tenant data,
production configuration, Terraform state, deployment credentials, and OAuth
signing material.

## Development

Requires Node.js 24 or newer.

```sh
npm run check
```

## CLI authentication

Install from a released package, then use the approved OAuth issuer for the
tenant origin you are accessing. Do not substitute an API key, password,
tenant ID, or copied bearer token.

Use `bizyeet --version` to report the installed package version without making
a network request or reading stored credentials.

`bizyeet diagnostics` reports the package/runtime version, OS/architecture and
runtime requirement, with the official releases link for manual updates. It
does not access credentials, call the network, claim that this is the latest
release, or install updates. Use `bizyeet auth check` separately to verify
server authorization. The current development package is not a published release.

```sh
# Browser Authorization Code + PKCE S256 flow.
bizyeet auth login --issuer https://your-bizyeet-origin

# Headless Device Authorization flow.
bizyeet auth login --device --issuer https://your-bizyeet-origin

bizyeet auth status
bizyeet auth check
bizyeet auth logout
```

`auth status` inspects the selected profile's local credential expiry and reports
`verification: "local_only"`; it does not prove current server authorization.
`auth check` verifies the existing OAuth session with the server, refreshing and
safely persisting credentials when necessary, and reports the server-resolved
tenant and granted scopes without reading customer data. Individual commands
still enforce current permissions. Use `--profile <name>` to select a stored
connection; profiles never override the server's tenant decision.

Issuer, public client ID and tokens are saved together in one protected credential
record. Legacy `profiles.json` metadata is not used to route authenticated requests
or reuse a client registration. If you have credentials created by an earlier CLI
without this identity binding, run `bizyeet auth login` again for that profile.
They are never silently migrated using public metadata. Logout can clear an
unbound legacy record locally but cannot safely revoke it remotely; revoke that
old connection from the dashboard if needed. Refresh preserves the binding.

The browser flow uses an ephemeral `127.0.0.1` callback with a fresh PKCE
challenge and state. Waiting for the browser callback expires after five minutes
and closes the listener; start a new login if authorization was abandoned.
Device polling rejects advertised intervals below one second or beyond supported
timer bounds, defaults an omitted interval to five seconds, and honors slowdown.
Device authorization lifetimes are limited to fifteen minutes; longer advertised
lifetimes are rejected before polling. Token exchanges reject empty or
whitespace-bearing access tokens before reporting a successful login.
Device registration explicitly requests the device-code and refresh grants.
Registration must explicitly assign the selected login flow and refresh-token
grant with secretless authentication. A missing or insufficient assignment stops
login with an administrator-facing diagnostic; requested grants are not assumed
to have been granted. Browser login also requires the code response type (the
default when omitted).
Switching from a browser or legacy profile registers a device-capable client;
later device logins reuse it only after a successful device exchange has been
recorded in that same issuer's protected profile.
Verification links must use HTTPS on the selected issuer origin, without
credentials or fragments; unsafe links are rejected before being displayed.
The device flow prints its verification URI and user code
to stderr. Successful token values are never printed. Where the platform has a
native credential service, the CLI stores credentials there. On POSIX systems,
an unavailable service permits the owner-only file fallback. It requires an
owner-owned mode-0700 configuration directory and an owner-owned mode-0600
regular credential file; symbolic links and multiply linked files are rejected.
Permissions and ownership are checked on the same open file that is read.
Do not place the configuration directory inside an untrusted/shared writable
parent. An explicitly configured `XDG_CONFIG_HOME` must be nonempty and absolute;
empty or relative paths fail instead of writing credentials into the workspace.
Fallback saves/removals hold an exclusive `.credentials.lock` directory across
the collection read and atomic replacement so other profiles are not overwritten.
Contention retries at most 50 times with a 100 ms delay, then fails without
removing another process's lock. A killed owner can leave an abandoned lock:
stop all BizYeet commands and verify there is no live owner before an operator
removes only that empty lock directory. Never delete credential files to recover
the lock. This serializes local file updates, not overlapping OAuth refresh
requests for the same profile; do not run those refreshes concurrently.
Windows requires its native credential
manager: POSIX mode bits do not prove owner-only Windows access, so plaintext
fallback is refused. A locked credential service fails closed rather than
copying a token to a fallback file.

Headless POSIX harnesses whose native service denies access can explicitly set
`BIZYEET_CREDENTIAL_STORE=file` in their trusted launch environment. This selects
the same permission-checked file store for login, refresh, reads and logout; it
does not probe, copy or delete native credentials. Use a dedicated profile and
a trusted private `XDG_CONFIG_HOME`, keep this setting consistent for that
profile, and perform OAuth login normally. These files are plaintext: protect
them from backups, artifacts, shared volumes and other workspace processes.
They are not a defense against a process already running as the same OS user.
The default `auto` mode is unchanged and never interprets locked/denied access
as permission to downgrade. File mode remains forbidden on Windows. An unknown
setting fails closed without echoing its value. Switching modes is not a
credential migration; logout only revokes/removes the selected store's grant
in file mode, so manage any separate native profile independently.

## Bounded read commands

Canonical list/detail response bodies are streamed with a 1 MiB byte limit,
including error responses. Oversized responses fail explicitly without parsing
or retrying them; they are never reported as an empty result. Write responses
retain their separate 32 KiB limit. OAuth discovery, registration, token/device
responses and the identity probe have a 64 KiB limit, including error bodies.
The reader consumes chunks iteratively and cancels/releases its reader on failure;
response content is never included in parser errors.

The V1 client intentionally exposes explicit business commands only. It has no
raw HTTP, SQL, tenant-selection, bulk-export, or file-path command.

```sh
bizyeet customers list --limit 25 --search "acme"
bizyeet customers get customer_opaque_id
```

List pages are capped at 100 records. Resource IDs and cursors are opaque;
never replace them with URLs, database IDs, or tenant identifiers. All command
results use the versioned BizYeet JSON envelope on stdout. Diagnostics and
errors use stderr with deterministic exit codes.

For an ID beginning with an option-like prefix, put options before `--` and the
single literal ID after it: `bizyeet customers get --profile default -- --opaque-id`.
The same separator works for update previews; put `--input-stdin` before `--`.
Anything after the separator is an ID, not a help, JSON, or profile option.
For an opaque cursor beginning with `--`, use `--cursor=<value>`, for example
`bizyeet customers list --cursor=--next-page`. The equals form preserves the
entire value, including additional equals signs, without treating it as a flag.

## Preview and approve a customer update

This draft CLI includes customer update commands; the matching server endpoints
must be available on the selected issuer. They require `customers.write` and
the server's current provider/role policy. Unsupported provider operations fail
explicitly; the CLI never selects a different database.

Supply a JSON object of proposed changed fields through stdin, not argument values:

```sh
bizyeet customers update preview "$CUSTOMER_ID" --input-stdin < changes.json
```

Open the returned `approval_path` on the selected issuer in your signed-in
dashboard. Review the proposed change and approve or deny it there. Opening
the page or approving does not itself update the customer.

Generate and retain one UUID execution key. Then run:

```sh
bizyeet customers update execute "$PREVIEW_ID" --idempotency-key "$EXECUTION_KEY"
bizyeet customers update status "$PREVIEW_ID" --idempotency-key "$EXECUTION_KEY"
```

Paste the dashboard receipt into the hidden terminal prompt. It is not echoed,
stored by the CLI or accepted as an argument. Headless harnesses may use
`--receipt-stdin` with a private pipe; never construct an inline shell command,
environment variable or chat message containing the receipt. Keep harness input
logging disabled for this secret channel. Preview JSON is capped at 16 KiB;
receipt input is one 43-character value with an optional line ending.

Execution does not automatically retry, even after a token denial. Refreshing
expired credentials happens before dispatch. If the result is uncertain, verify
the existing execution; do not create a new preview or idempotency key to repeat
the change. An exact same-key request can only replay the server's recorded
outcome or report an in-progress/uncertain state.

`customers update status` is a read-only lookup using that original preview ID
and execution key. It requires no receipt. A successful command means the lookup
succeeded, not that the mutation did: inspect `data.state` and `data.outcome`.
`pending` becomes `unknown` after five minutes without a recorded outcome;
elapsed time is not proof of failure. Unknown or ambiguous outcomes require
operator reconciliation. Status never releases a claim or retries a mutation.

## Planned surfaces

- OAuth-protected Streamable HTTP MCP tools for Codex and compatible harnesses.
- A Codex skill documenting safe discovery, output limits, and explicit
  approval boundaries for writes.

See [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), and the
public roadmap documentation for current scope.

The proposed V1 CLI/MCP authorization and safety contract is in
[docs/plans/bizyeet-640-v1-contract.md](docs/plans/bizyeet-640-v1-contract.md).
