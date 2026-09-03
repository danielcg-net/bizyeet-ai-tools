# BizYeet AI Tools

Public CLI, MCP adapter, schemas, and Codex guidance for tenant-authorized BizYeet AI agents.

> This repository is a TypeScript development scaffold. It does not yet provide a usable
> OAuth client, MCP server, or access to BizYeet tenant data.

## Security model

Future clients will authenticate a human tenant user through OAuth. They will
never use API keys, personal access tokens, shared dashboard passwords, or
embedded client secrets. The server will derive tenant identity and intersect
OAuth scopes with the user's current BizYeet permissions on every request.

This repository intentionally excludes BizYeet backend source, tenant data,
production configuration, Terraform state, deployment credentials, and OAuth
signing material.

## Development

Requires Node.js 24 or newer.

```sh
npm run check
```

## Planned surfaces

- `bizyeet` CLI for bounded, structured agent workflows.
- OAuth-protected Streamable HTTP MCP tools for Codex and compatible harnesses.
- A Codex skill documenting safe discovery, output limits, and explicit
  approval boundaries for writes.

See [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), and the
repository's GitHub issues for the current roadmap.
