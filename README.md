# BizYeet AI Tools

Public CLI, MCP adapter, schemas, and Codex guidance for tenant-authorized BizYeet AI agents.

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

```sh
# Browser Authorization Code + PKCE S256 flow.
bizyeet auth login --issuer https://your-bizyeet-origin

# Headless Device Authorization flow.
bizyeet auth login --device --issuer https://your-bizyeet-origin

bizyeet auth status
bizyeet auth logout
```

The browser flow uses an ephemeral `127.0.0.1` callback with a fresh PKCE
challenge and state. The device flow prints its verification URI and user code
to stderr. Successful token values are never printed. Where the platform has a
native credential service, the CLI stores credentials there; otherwise it uses
the local owner-only fallback and rejects unsafe file permissions before reading
credentials. A locked credential service fails closed rather than copying a
token to the fallback file.

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

## Planned surfaces

- OAuth-protected Streamable HTTP MCP tools for Codex and compatible harnesses.
- A Codex skill documenting safe discovery, output limits, and explicit
  approval boundaries for writes.

See [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), and the
public roadmap documentation for current scope.

The proposed V1 CLI/MCP authorization and safety contract is in
[docs/plans/bizyeet-640-v1-contract.md](docs/plans/bizyeet-640-v1-contract.md).
