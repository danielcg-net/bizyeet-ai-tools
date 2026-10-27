# Release verification

Prepare the required protected GitHub approval gate with the read-only-first
[release environment helper](release-environment.md). Applying its reviewed plan
is a separate authorized settings action, not publication approval.

The dedicated `release-cli.yml` workflow releases only `@bizyeet/cli`, using
`cli-vVERSION` tags (initial candidate `cli-v0.1.0-beta.1`). The legacy
`release.yml` publication workflow is retired. The GitHub repository and
existing `npm-release` human gate stay the same.

[New-package readiness](release-readiness.md) records actual approved bootstrap
and publisher setup, including a conservative trust-window bound. Verify-only
dispatches use `publish:false`; setup evidence does not approve a candidate.
Actual publication still requires fresh source/run/tag/provenance validation and
the native human gate. Neither source changes nor an unpublished run authorize it.

Hosted MCP has an independent private version/build/deployment. This npm package
contains the CLI, not a hosted MCP server or a second MCP executable. CLI release
success does not activate or prove a hosted MCP deployment.

Run `npm run release:verify` from a clean checkout. It runs the full TypeScript,
functional-immutability, unit, routing and workflow-security gates, then creates
a real npm tarball in a fresh `release-artifacts/` directory. A bootstrap compilation
loads the verifier, then it removes generated `dist/` output and reruns all normal
gates before packing, excluding stale ignored files from earlier revisions. The command refuses
to overwrite an existing bundle. Move a previous bundle elsewhere before rerunning.

The bundle contains the tarball, a production-dependency CycloneDX SBOM,
`build-manifest.json`, and `SHA256SUMS`. The package is installed into an isolated
temporary directory; its declared `bin.bizyeet` target and npm-generated shim must
exist, and its CLI help is executed through offline npm exec before success. Temporary
installation files are removed; the verification bundle is retained.

The manifest records the source revision and dirty state, lockfile digest,
artifact digest, runtime, and completed smoke check. It is an **unsigned build
manifest**, not an attestation or proof of release authorization. The
`0.1.0-beta.1` candidate has publication metadata but remains unpublished until
the protected publication gates actually succeed. This command never publishes, signs,
uses tenant OAuth credentials, or exercises production business operations.

The Release Verification workflow runs on GitHub-hosted Ubuntu, macOS and Windows
with Node 24 and 26 for PRs, main pushes, manual runs and a weekly schedule. Every
job has read-only repository permissions, a 15-minute timeout, no persisted Git
credentials and immutable action references. Bundles expire after seven days.
Concurrency cancels obsolete runs for the same PR/ref, not unrelated PRs.

CI must establish actual success on each platform; the matrix is not itself proof
of support. The CLI core's installed OAuth/list/exact-read verification remains
separate from this package/help smoke check.

Before BIZYEET-741 can close, complete protected release authorization, version
and changelog validation, cryptographic provenance verification, publication and
rollback guidance, required-check reconciliation and representative fork testing.
Do not publish or call this an attested release based only on a green dry-run.

## Trusted non-publishing provenance

`Verify Trusted Provenance` is a separate manual workflow. Both jobs require
the original `danielcg-net/bizyeet-ai-tools` repository, `refs/heads/main`, and
`workflow_dispatch`. There are no source/artifact inputs, pull-request triggers,
completion triggers or reusable-workflow entrypoints. A fork or non-main dispatch
cannot obtain its signing job. This is not a package-publication environment.

The read-only build job checks out the dispatch commit without persisted Git
credentials, runs the full artifact verifier and uploads a fresh bundle. The
attestation job downloads the exact artifact ID from that job in the same run.
It has only `contents: read`, `id-token: write`, and `attestations: write`; it
does not check out source, install dependencies or execute the downloaded package.
It attests the tarball and verifies its digest, repository, signer workflow,
source ref, source commit, signer commit and GitHub-hosted runner identity using
the generated bundle. Artifact and attestation bundles are retained for seven days.

The workflow security checker permits signing permissions only for this exact
reviewed job shape and trusted build boundary. Regression tests reject PR/fork
events, arbitrary refs, cross-run artifacts, injected secrets, broader tokens,
artifact execution, registry writes and weakened verification restrictions.
Ordinary PR checks retain their existing read-only/security-analysis permissions.

This workflow records provenance in GitHub's attestation service but never runs
`npm publish`, creates a GitHub Release, changes a registry channel, enables
OAuth clients or mutates tenant data. It does not claim human release approval or
a SLSA level. The candidate metadata enables publication review but does not
prove any publication, publisher configuration or human approval. The SBOM and
local build manifest remain ordinary files in the
build bundle; the cryptographic provenance subject here is the npm tarball.

`create-storage-record: false` disables the separate linked-artifact storage
metadata record, not the attestation upload. The pinned action uploads its
attestation independently; `attestations: write` is still required. We do not
grant `artifact-metadata: write` or publish a registry artifact for that optional
record. Verify the actual attestation URL after the trusted run.

After merge, run it from `main` and verify the actual uploaded tarball and signed
bundle before recording this gate as delivered. A skipped job, a declaration of
permissions, or a passing local workflow test is not successful attestation proof.
See the official [artifact attestation guidance](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
and [verification restrictions](https://cli.github.com/manual/gh_attestation_verify).

See [exact-version installation and compatibility](installation.md) for the
dated candidate preparation status and the supported beta subset.

## Release metadata gate

`npm run release:preflight -- --tag cli-vVERSION` is a read-only local metadata gate.
It requires a non-development [SemVer](https://semver.org/) version (including
prereleases, excluding build metadata), an exact matching tag string, consistent
package/lockfile identities, explicit `private: false` and
`publishConfig.access: public`, and one dated, substantive changelog entry.
The proposed exact invocation is `npm run release:preflight -- --tag cli-v0.1.0-beta.1`.
Neither this command nor a passing unit fixture proves publication or that a Git tag
exists, a release is approved, or the version is unused in the registry.

A release PR must review those metadata changes, compatibility and migration
notes. The future protected release workflow must additionally verify a clean
reviewed source revision, tag/commit binding, unused registry version, all matrix
and installed-command checks, trusted provenance and human approval. Do not use
PR-uploaded artifacts as inputs to a privileged release job.

## Rollback and withdrawal runbook

At candidate preparation on 2026-10-26, no published version had been verified.
The following is a required maintainer-run
procedure, not an automatic registry or tenant mutation:

1. Record the affected exact version, digest, source revision, release run and
   user impact in YouTrack. Stop pending release approvals; preserve artifacts,
   logs and immutable release history for investigation.
2. Identify a known-good version and verify its digest/provenance and compatibility
   with the current server contract. Test its installed command in an isolated
   environment before recommending an exact-version downgrade. If none exists,
   suspend installation guidance rather than recommend an unverified version.
3. With maintainer approval, withdraw the affected version from the recommended
   release channel and publish a clear advisory. npm
   [deprecation](https://docs.npmjs.com/cli/v11/commands/npm-deprecate/) warns
   installers; it does not remove existing installations or revoke OAuth grants.
4. Treat unpublishing as a separate destructive decision subject to the current
   [npm unpublish policy](https://docs.npmjs.com/policies/unpublish/), not the
   default rollback. Never overwrite/reuse a published version or silently replace
   its artifact; deliver fixes as a new reviewed version.
5. If credential compromise is suspected, obtain separate authorization for
   targeted OAuth revocation or client/tenant/global controls. A package rollback
   is not a server rollback. Do not disable tenant agents or dashboard access as
   an incidental release action.
6. Record registry/advisory changes and fresh installed-version verification.
   Resume releases only after the fix passes review, matrix, provenance and the
   protected human gate. Retain the incident and audit history.
