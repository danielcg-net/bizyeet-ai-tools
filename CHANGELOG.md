# Changelog

## [0.1.0-beta.1] - 2026-10-26

- Prepare the first CLI beta candidate, `@bizyeet/ai-tools@0.1.0-beta.1`, with
  command `bizyeet` and proposed GitHub prerelease `v0.1.0-beta.1`. At candidate preparation on 2026-10-26, publication was pending; verify the
  matching npm version and GitHub prerelease before installation. Reviewed
  metadata and local tarball tests are not publication evidence.
- Define the beta subset as installation, version/help/diagnostics, OAuth setup,
  and bounded customer/lead list and exact reads when the authenticated server
  advertises the required capability and `customers.read` is granted. Live
  OAuth/read and hosted MCP acceptance are not established by this changelog;
  consult the exact release acceptance evidence.
- Retain OAuth Authorization Code with PKCE S256 and headless Device
  Authorization, protected credential storage, refresh rotation and revocation.
  Local auth status does not prove server authorization; `auth check` contacts
  the server and can refresh/persist credentials.
- Preserve API `v1` envelopes, server-resolved tenant/provider routing, live
  roles/scopes, opaque IDs/cursors, explicit denied/unavailable errors and bounded
  projections/pages. No raw HTTP, SQL, provider bypass or automatic page traversal.
- Package additional business commands and MCP descriptors as capability-dependent
  previews. Their presence in help/source is not live acceptance or write authority;
  existing preview, trusted approval and idempotency requirements still apply.
- Clarify that the hosted OAuth MCP endpoint is deployed independently by BizYeet.
  This package has one CLI executable and no standalone MCP server executable;
  installation does not deploy a server, enable a tenant or grant scopes.
- Require Node.js 24 or newer. Release verification targets hosted Ubuntu, macOS
  and Windows on Node 24/26; actual matrix results and protected release evidence
  must pass before claiming release support. Windows requires native credential
  storage; plaintext fallback is POSIX-only and subject to ownership protections.
- Add exact-version install/upgrade/uninstall and manual diagnostics guidance.
  Review release notes and provenance before upgrading. Existing identity-bound
  profiles are retained; legacy unbound profiles require explicit revocation and
  login. Package upgrades do not upgrade the hosted server or migrate OAuth grants.
- Keep the first beta on npm's `beta` channel, with no automatic stable promotion.
  Protected publication, namespace ownership/trusted publisher configuration,
  live acceptance and public install/provenance checks are required release gates.

See [installation and compatibility](docs/installation.md),
[MCP setup](docs/mcp.md), and [release verification](docs/release-verification.md).
