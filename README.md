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

The browser flow uses an ephemeral `127.0.0.1` callback with a fresh PKCE
challenge and state. The device flow prints its verification URI and user code
to stderr. Successful token values are never printed. Where the platform has a
native credential service, the CLI stores credentials there. On POSIX systems,
an unavailable service permits the owner-only file fallback, with permissions
checked before reading credentials. Windows requires its native credential
manager: POSIX mode bits do not prove owner-only Windows access, so plaintext
fallback is refused. A locked credential service fails closed rather than
copying a token to a fallback file.

## Bounded read commands

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

## Planned surfaces

- OAuth-protected Streamable HTTP MCP tools for Codex and compatible harnesses.
- A Codex skill documenting safe discovery, output limits, and explicit
  approval boundaries for writes.

See [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), and the
public roadmap documentation for current scope.

The proposed V1 CLI/MCP authorization and safety contract is in
[docs/plans/bizyeet-640-v1-contract.md](docs/plans/bizyeet-640-v1-contract.md).
