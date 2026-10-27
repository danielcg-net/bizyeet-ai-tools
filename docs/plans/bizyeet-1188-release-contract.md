# Beta release contract

> Historical first-package contract. Active CLI delivery now uses `@bizyeet/cli`, `cli-vVERSION` and `release-cli.yml`; see [current release guidance](../release-verification.md). Old `@bizyeet/ai-tools` setup and immutable `v0.1.0-beta.1` failure history do not authorize the new namespace.

This plan defines the proposed first distribution of the public CLI. It does
not authorize publication or establish production readiness. Delivery is tracked
by [BIZYEET-1188](https://bizyeet.youtrack.cloud/issue/bizyeet-1188) and
[BIZYEET-1189](https://bizyeet.youtrack.cloud/issue/bizyeet-1189).

## Identity and supported subset

| Field | Required value |
| --- | --- |
| Repository | `danielcg-net/bizyeet-ai-tools` |
| npm package | `@bizyeet/ai-tools` |
| Proposed version | `0.1.0-beta.1` |
| Git tag / GitHub prerelease | `v0.1.0-beta.1` |
| npm channel | `beta`; never implicitly `latest` |
| CLI command | `bizyeet` |
| Supported verification matrix | GitHub-hosted Ubuntu, macOS, Windows; Node 24 and 26 |
| Publishing build | GitHub-hosted Ubuntu, Node 24; recorded exact Node/npm versions |

The beta support claim covers installation, version/help/diagnostics, OAuth
setup, bounded customer/lead discovery and exact reads where the authenticated
server advertises the required scopes and capabilities. Other packaged command
and source MCP descriptors are capability-dependent previews until their exact
release/server/client combinations have acceptance evidence. Their presence in
source or help does not establish deployed availability or authorize a write.
Every release must enumerate its tested subset and remaining limitations.
Unsupported, unavailable, scope-denied and revoked operations fail explicitly;
there is no provider bypass, silent fallback or empty-success substitution.

The public distribution is the CLI, public contracts, and companion guidance.
The hosted Streamable HTTP MCP runtime is independently deployed by BizYeet;
there is no standalone MCP server executable in this package. CLI installation
neither deploys that runtime nor enables a tenant or broadens OAuth authority.
The shared business contract uses API `v1`, opaque IDs/cursors, live roles/scopes,
and server-owned routing. The hosted server's authenticated advertised tools and
schemas determine availability, independently of the npm version. Record the
observed tool/schema set, server deployment reference, CLI version and client
version in private acceptance evidence. A missing feature requires a supported
server deployment/reauthorization, never a copied token or provider endpoint.

Use the existing [MCP setup](../mcp.md) and [harness guide](../codex-harness.md).
Keep project-scoped OAuth setup and exact scope reauthorization. Package
upgrades do not upgrade the hosted runtime, grant scopes, approve mutations or
replace the existing preview/approval/idempotency boundaries. Breaking API
changes require an explicit versioned contract and migration guidance, following
the [V1 contract](bizyeet-640-v1-contract.md).

## Reviewed source and build boundary

1. Metadata and workflow changes land through protected `main`, signed commits,
   required checks, DeepSeek review and resolved actionable threads. The package
   and lockfile identities/versions must agree, `private` must be `false`, public
   access explicit, `publishConfig.registry` fixed to `https://registry.npmjs.org`,
   `repository.url` exactly `git+https://github.com/danielcg-net/bizyeet-ai-tools.git`,
   and the changelog dated and
   substantive. Run `release:preflight` with the exact proposed tag.
2. Publication is a manual dispatch from the original repository's `main` only.
   Use one top-level `.github/workflows/release.yml`; no reusable caller, PR,
   fork, release-event, workflow-completion or arbitrary-ref entrypoint obtains
   publish authority. Bind the dispatch SHA to a merged, protected-main revision.
   Any supplied version/tag must equal reviewed metadata; no source/artifact URL,
   cross-run artifact selector or arbitrary checkout input is accepted.
3. The existing release tag must resolve to that exact dispatch commit before
   publication. Tag creation/protection is a separate authorized maintainer gate;
   never move or replace an existing tag. Record the full peeled commit SHA,
   workflow revision and tag, and revalidate them immediately before publishing.
4. Unprivileged fresh jobs run the full `npm run check` and release verification
   on all six OS/Node combinations for the same SHA. Package-install tests run
   outside the checkout. Require installed `--version` to equal metadata and
   installed `--help` to succeed. Fail if the tracked source is dirty. PR matrix
   artifacts and older successful runs are never publication inputs.
5. One canonical fresh Linux build supplies the distributable tarball, CycloneDX
   production-dependency SBOM, source/build manifest and `SHA256SUMS`. Other
   platforms prove install compatibility; their tarball hashes need not be
   identical. The manifest binds source SHA, tag, package/version, lockfile hash,
   runtime and artifact hash; unsigned manifest fields alone prove no authority.
6. Subsequent jobs download only exact artifact IDs from this run's successful
   build, verify file allowlists, digests and metadata, and never rebuild or
   repack the candidate. No checked-out repository executable, dependency install, lifecycle
   script or downloaded executable runs with publishing/signing permissions.
   Immutable pinned actions and inline verification code in the reviewed workflow
   may run there; all verification logic must bind to that workflow revision.
7. Cryptographic attestation binds the canonical tarball digest to the original
   repository, exact signer workflow/revision, main source ref, exact source SHA
   and GitHub-hosted runner. Verify these restrictions before any publication.
   Preserve the signed bundle alongside the tarball, SBOM, manifest and checksums.
   npm OIDC provenance must also be verified after publication. Neither an
   unsigned manifest nor a declared permission is successful provenance evidence.

## Protected approval and publication

A protected environment named `npm-release` is required. Its policy must require
an explicitly authorized human reviewer, disallow protection bypass,
and restrict deployments to protected `main`. Fail closed if the environment,
reviewer policy, ref restriction or publisher identity cannot be verified;
referencing an absent environment must not silently create an unprotected gate.
Record and verify the chosen `prevent_self_review` setting; a second person is
required only when the applicable organization policy requires it.
Approval follows a concrete reviewable candidate with SHA/tag/version, digest,
notes, matrix, installed smoke results and verified attestation. Approval must
bind that candidate and run, not an earlier build or future unspecified release.

Keep build permissions read-only. Attestation receives only the required
`id-token: write` and `attestations: write` in addition to read access. npm
publication receives only read access and `id-token: write` after environment
approval. A separate GitHub-release job receives `contents: write` only after
successful, reconciled npm publication. Pin actions to immutable SHAs, disable
persisted checkout credentials and package-manager caches, use hosted runners,
bounded timeouts, and non-cancelling per-package publication concurrency.

[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) requires
npm >=11.5.1 and Node >=22.14.0. Configure the exact repository, `release.yml`,
and `npm-release` environment identity, with direct publication explicitly
allowed. The package repository URL must match. New trust configurations require
a first successful publish within two days. The publishing job must contain no
npm write token or fallback credential; OIDC failure stops the run. Ownership,
trust setup and policy changes require separate maintainer authorization.

Ownership and external publisher configuration evidence may be a reviewed,
candidate-bound maintainer attestation recording the package, repository, workflow,
environment, allowed action, setup time and expiry check. Do not invent a registry
configuration-query API or treat this attestation as proof that OIDC will succeed.
The registry OIDC exchange enforces actual publisher binding; authentication failure
stops publication. GitHub environment policy remains independently fetched and
verified with the documented read permission. Verify registry provenance afterward.

Initial namespace/package provisioning is an explicit execution prerequisite.
A registry 404 does not prove name availability, ownership or that initial OIDC
publication is supported. The current npm guide starts from package settings;
before the first run, the maintainer must demonstrate package ownership and a
supported configured OIDC path for the initial package. If provisioning requires
an initial manual publication or another external write, stop for a separately
reviewed bootstrap decision. Do not create a placeholder version, add a token,
or silently substitute a local publish to unblock this contract.

Publish the already verified exact tarball with explicit public access, beta
channel and lifecycle scripts disabled. Do not disable provenance. Query registry
version/integrity/channel before publishing and verify retrieved bytes and
provenance afterward. Create the matching GitHub prerelease only after npm
verification, with reviewed notes and the exact verified bundle plus attestation.
Preserve durable release evidence; seven-day CI artifact retention is insufficient
as the sole public release archive. No automatic stable promotion is included.

## Collision, failure and recovery

| Situation | Required behavior |
| --- | --- |
| Existing version, tag or release differs | Stop; never overwrite, force-tag, reuse a version or replace assets. |
| Version absent | Treat only an explicit registry not-found as absence; authentication, network and malformed responses stop the run. Ownership/trust still require independent proof. |
| Publish times out or returns ambiguous failure | Reconcile exact registry bytes/integrity and provenance before any retry; never blindly republish. |
| npm succeeded, GitHub step failed | Resume only missing GitHub publication after re-verifying the immutable source and exact retained bytes; do not publish npm again. |
| Existing matching complete release | Verify every digest, provenance identity, version and beta mapping; report already complete without changing it. |
| Existing matching npm version only | Reconcile with authenticated release evidence; byte equality alone cannot prove authorized publication. Resume only the missing approved step. |
| Registry channel changed concurrently | Stop for maintainer reconciliation; do not silently move it back or touch `latest`. |
| Artifact/evidence expired or unavailable | Stop; do not rebuild and claim the replacement is the previously approved candidate. |
| Failure before publication | Retain failed evidence; a fresh run needs its own verification and approval. |

Channel repair, deprecation, unpublish, tag deletion and advisory changes are
separate maintainer decisions. OIDC dist-tag writes require explicit publisher
permission and a supporting npm version; they are not an automatic retry tool.
Use the existing [withdrawal runbook](../release-verification.md); rollback of
a client package is separate from server deployment or OAuth revocation.

## Acceptance and stopping gates

- Tests reject wrong repo/event/ref, arbitrary source, tag/version/SHA mismatch,
  dirty input, cross-run/PR artifacts, missing matrix evidence, broadened token
  permissions, unpinned actions and bypassed environment policy.
- Metadata validation rejects development/private packages, inconsistent lockfile,
  wrong repository/channel, absent substantive notes and package-bin mismatches.
- Collision/recovery tests cover registry auth/network errors, altered tarballs,
  wrong attestation identity, pre-existing versions/releases, partial success,
  concurrent channel changes and expired evidence without registry writes.
- A non-publishing trusted run proves six-platform verification, exact-version
  installed help/version, allowlisted bundle, checksums, SBOM and attestation.
  Fork checks remain unprivileged. A dry-run is recorded as unpublished.
- Independent acceptance reconciles routing rollout BIZYEET-805, broader security
  BIZYEET-741 and harness BIZYEET-648. Existing historical provider validation and
  synthetic fixtures retain their scope. Record current installed OAuth/read and
  hosted MCP evidence, or the exact missing live-auth prerequisite, before
  recommending beta use. Do not block package engineering on unrelated backlog
  or claim full harness/write acceptance from a supported read-only subset.
- Maintainer confirms ownership/bootstrap, publisher binding and protected human
  gate against the exact candidate. Missing external setup blocks execution;
  it does not justify weakening the workflow or changing secrets/settings.
- Only after that approval, verify the public exact-version install from a fresh
  directory, version/help, npm beta mapping, matching GitHub prerelease, downloaded
  hashes, public provenance and durable assets. Record source/run/tag/digests and
  actual publication outcome. Effort completion requires every in-scope child
  merged and post-merge evidence; opening a PR is only a checkpoint.

As of the contract audit on 2026-10-27 UTC, the checkout still uses the private
`0.0.0-development` package; this plan itself changes no metadata, workflows,
registry settings, secrets, production data or tenant enablement. Detailed live
control/authentication findings belong in restricted YouTrack evidence.
