# Trusted provenance boundary

BIZYEET-741: provenance.yml is manual/main/original-repository only. Never add
PR, workflow_run, workflow_call or user-selected source/artifact inputs. The
builder has read-only permissions, checks out github.sha and runs release:verify.
The signer downloads the exact same-run build artifact ID; no checkout, npm,
package installation or artifact execution occurs with signing permissions.

The only permission exception lives in scripts/provenance-policy.ts: exact
attestation job, fixed build steps, trusted condition, only two jobs, read-only
builder. Tests mutate each boundary. Do not globally permit id-token or
attestations writes to make an unrelated workflow pass the security checker.

actions/attest v4 SHA1e69f48acb82d1966a394da916b4c1698aa569d6 and
download-artifact v8 SHA3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c were resolved
from official action tags and exact action inputs inspected. gh attestation
verify enforces repository, signer workflow, source ref/digest, signer digest
and denial of self-hosted signers. No package publication or protected human
approval is implied. Attestation subject is the tarball, not the separate SBOM.

Real trusted post-merge dispatch and downloaded artifact verification remain
required before claiming provenance success. Fork test/required-check policy,
protected publication reviewer and final release metadata are separate gates.
# Platform and storage review notes

Mutation fixtures normalize checkout CRLF to LF before finding multiline anchors,
then validate both LF and CRLF versions of every valid/invalid workflow. Do not
remove anchors/assertions to hide Windows failures. The pinned actions/attest v4
uploads attestations independently of create-storage-record; that option controls
separate linked-artifact metadata, not the GitHub attestation store.
