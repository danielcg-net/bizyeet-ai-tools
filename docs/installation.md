# CLI installation and beta compatibility

`@bizyeet/cli@0.1.0-beta.1` candidate metadata was prepared on 2026-10-27, with publication
pending at that time. Availability is established by the matching npm version,
verified npm `beta` mapping and GitHub prerelease, not by these instructions or
source metadata. Verify the exact release before installation. A local tarball
install or passing dry-run is not publication or live authentication acceptance.

## Install and inspect an exact release

Use Node.js 24 or newer and npm. The release verification matrix targets Ubuntu,
macOS and Windows with Node 24 and 26; consult the actual release evidence for
platform results. Review the exact version's notes, checksums and provenance at
the [official releases](https://github.com/danielcg-net/bizyeet-ai-tools/releases)
before installing. After protected publication is verified:

```sh
npm install --global @bizyeet/cli@0.1.0-beta.1 --registry=https://registry.npmjs.org
bizyeet --version
bizyeet --help
bizyeet diagnostics --json
```

The version command must report `0.1.0-beta.1`. Version, help and diagnostics are
local: they do not read credentials, query the registry or prove server access.
Diagnostics reports runtime/platform and manual update guidance, without deciding
the latest version or updating automatically. Registry not-found means stop and
check publication status; do not substitute an unofficial archive or registry.

The initial channel is `beta`, never an automatic `latest` promotion. Once the
published channel is verified, `@bizyeet/cli@beta` selects its current mapping,
which can change. Prefer the explicit version above for reproducible installation.
Do not use an unversioned install to select this prerelease.

## Upgrade, remove and credential recovery

To upgrade to this candidate after publication, review its notes and rerun the
same exact-version install command above, then verify version/help/diagnostics.
For a subsequent beta, replace the version only with a reviewed, published exact
version. There is no automatic updater. At candidate preparation no older published
release had been verified for a downgrade.

```sh
npm uninstall --global @bizyeet/cli
```

Removing the executable does not revoke OAuth grants or delete protected profiles
or exported business data. When retiring a connection, run `bizyeet auth logout`
for the selected profile before uninstalling and verify revocation succeeds.
Do not delete credential files to bypass failed revocation. Remove private export
files separately when finished; never upload them as diagnostic evidence.

Existing identity-bound profiles are retained by a package upgrade. Legacy
unbound profiles require dashboard revocation, explicit local logout and a new
OAuth login; see the [credential and recovery guidance](../README.md#cli-authentication).
Changing credential-store mode is not migration. Windows requires its native
credential service; POSIX fallback files require protected ownership/permissions.

## Candidate support boundary

| Surface | Candidate compatibility and remaining evidence |
| --- | --- |
| CLI installation and local diagnostics | Exact package/version/help; require release matrix and registry install evidence. |
| OAuth | Browser PKCE S256 or approved Device Authorization with exact requested scopes; require exact candidate live login/read acceptance evidence. |
| Customer/lead list and exact reads | API `v1`, `customers.read`, live permissions and advertised server capability; bounded projections/pages and opaque IDs/cursors. |
| Other packaged business commands | Capability-dependent previews until the exact release/server/client combination has acceptance evidence. |
| Hosted MCP | Independently deployed OAuth Streamable HTTP endpoint; authenticated advertised tool/schema set and granted scopes govern availability. |

This candidate is not a claim of full model-driven, cross-client or write-flow
acceptance. Historical deployment evidence and synthetic local tests do not prove
current tenant acceptance. No live tenant canary is asserted by these instructions.
Before recommending the beta for business reads, record the installed exact CLI
version, server identity/scopes, advertised capabilities and a bounded authorized
read. Keep record payloads and credentials out of release evidence.

Use an administrator-approved tenant issuer and normal OAuth setup in
[CLI authentication](../README.md#cli-authentication). `auth status` is local-only;
`auth check` contacts the server and may refresh and persist credentials. Default
CLI login requests `customers.read`; request only the exact additional scope needed
for an approved operation. Package installation never enables a tenant, grants
scope or authorizes production mutations.

The hosted MCP server uses the same API `v1` business contract but is deployed
independently from the private backend. Installing this CLI neither starts nor
upgrades it. The package contains no standalone MCP server executable. Discover
the authenticated server's tools and schemas before relying on a descriptor;
source declarations do not prove deployment. Record the server deployment/tool
schema and client version alongside the CLI version in acceptance evidence.
Breaking contract changes require explicit migration guidance; a package upgrade
never substitutes for server deployment or scope reauthorization. See
[MCP setup](mcp.md), [canonical reads](canonical-crm-contract.md), and
[release verification](release-verification.md).
