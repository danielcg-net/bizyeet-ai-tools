# Release verification

- `npm run release:verify` creates an actual npm tarball, CycloneDX production SBOM, SHA256SUMS and unsigned build manifest after all normal gates pass. It installs and runs CLI help in a temporary directory outside the repository.
- After bootstrap compilation, the verifier deletes generated dist output and reruns all gates before packing. This prevents stale ignored code from entering a clean-source artifact. The installed bin mapping and generated shim are validated and offline npm exec exercises the command, not a hardcoded source path.
- Convert filesystem URLs with fileURLToPath, never URL.pathname; the latter duplicates Windows drive prefixes and retains encoded spaces.
- The generated `release-artifacts/` directory must be absent before starting; never overwrite an existing verification bundle. Artifacts are ignored by Git, not source files to commit.
- The manifest explicitly records unpublished/unattested status and dirty source state, including untracked source. Do not describe it as cryptographic provenance.
- The Release Verification workflow uses GitHub-hosted Ubuntu/macOS/Windows on Node24/26, no tenant credentials or publication permissions, pinned actions and seven-day artifact retention. Actual CI results, not matrix configuration alone, establish support.
- BIZYEET-741 remains open until protected release/publication, version/changelog controls, signed provenance, real-fork tests and required-check reconciliation are verified.
- `npm run release:preflight -- --tag vVERSION` validates candidate package/lockfile identity, SemVer/tag consistency, explicit public publishability and dated substantive changelog notes. It must fail on the private development scaffold. It is not Git tag verification, registry uniqueness, provenance or release approval.
- Rollback guidance is in docs/release-verification.md. Deprecation, registry/channel changes, destructive unpublishing and OAuth revocation require distinct maintainer authorization; preserve immutable artifacts/audit and never imply package rollback revokes installed OAuth grants.
