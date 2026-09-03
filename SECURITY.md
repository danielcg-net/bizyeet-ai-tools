# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through
[GitHub Security Advisories](https://github.com/danielcg-net/bizyeet-ai-tools/security/advisories/new).
Do not open a public issue for a vulnerability that could expose tenant data,
OAuth credentials, workflow secrets, or an authorization bypass.

Include affected versions or commit IDs, reproduction steps, impact, and any
suggested mitigation. We will acknowledge reports within five business days.

## Security boundaries

- Never add tenant data, real access tokens, API keys, passwords, private keys,
  production URLs, or deployment credentials to this repository.
- Public pull requests run only on GitHub-hosted runners and never receive
  repository, environment, cloud, registry, OAuth, signing, or review-provider
  secrets.
- The public CLI and MCP adapter must use OAuth with PKCE. They must not add an
  API-key, shared-password, or manually copied bearer-token login path.
- Report dependency and supply-chain concerns privately using the channel above.

## Supported versions

No production version has been released. Security fixes are made on `main`
until the first supported release line is published.
