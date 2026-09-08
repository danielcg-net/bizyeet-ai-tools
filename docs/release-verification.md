# Release verification

Run `npm run release:verify` from a clean checkout. It runs the full TypeScript,
functional-immutability, unit, routing and workflow-security gates, then creates
a real npm tarball in a fresh `release-artifacts/` directory. The command refuses
to overwrite an existing bundle. Move a previous bundle elsewhere before rerunning.

The bundle contains the tarball, a production-dependency CycloneDX SBOM,
`build-manifest.json`, and `SHA256SUMS`. The package is installed into an isolated
temporary directory and its CLI help is executed there before success. Temporary
installation files are removed; the verification bundle is retained.

The manifest records the source revision and dirty state, lockfile digest,
artifact digest, runtime, and completed smoke check. It is an **unsigned build
manifest**, not an attestation or proof of release authorization. The development
package remains private and unpublished. This command never publishes, signs,
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
