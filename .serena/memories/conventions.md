# Conventions

- Ship source and executable scripts as TypeScript. Keep I/O at narrow edges and core logic pure.
- ESLint is mandatory and rejects `let`/`var`, mutable parameter/property updates, loops, classes, and `this`.
- Prefer readonly types and return new values; validate all untrusted boundaries.
- OAuth uses PKCE and scoped, audience-bound access tokens. Do not add API keys, PATs, passwords, client secrets, tenant data, or private BizYeet code.
- Do not add `pull_request_target`, self-hosted runners, or unpinned GitHub Actions.
- YouTrack is the work-tracking source of truth; GitHub Issues are disabled.
- Only authenticated `dependabot[bot]` pull requests bypass delivery identifiers; dependency updates still pass every other security, test, and review control.
