# Release verification deadlines

- The artifact verifier runs the complete fresh-build check before packaging. That exact npm invocation has a bounded ten-minute allowance; pack, SBOM, install and installed-help commands retain their two-minute allowance.
- Windows/Node24 postmerge run34787219289 passed all native tests but hit the old two-minute wrapper deadline during routing checks. Do not remove tests, weaken ACL checks, or skip the fresh-build gate to address this.
- The release workflow retains its independent fifteen-minute job deadline. There are no automatic retries or unbounded execution.
