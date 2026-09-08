# Release verification

- `npm run release:verify` creates an actual npm tarball, CycloneDX production SBOM, SHA256SUMS and unsigned build manifest after all normal gates pass. It installs and runs CLI help in a temporary directory outside the repository.
- The generated `release-artifacts/` directory must be absent before starting; never overwrite an existing verification bundle. Artifacts are ignored by Git, not source files to commit.
- The manifest explicitly records unpublished/unattested status and dirty source state, including untracked source. Do not describe it as cryptographic provenance.
- The Release Verification workflow uses GitHub-hosted Ubuntu/macOS/Windows on Node24/26, no tenant credentials or publication permissions, pinned actions and seven-day artifact retention. Actual CI results, not matrix configuration alone, establish support.
- BIZYEET-741 remains open until protected release/publication, version/changelog controls, signed provenance, real-fork tests and required-check reconciliation are verified.
