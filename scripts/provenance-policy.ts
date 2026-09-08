import { isDeepStrictEqual } from "node:util";

type Mapping = Readonly<Record<string, unknown>>;
const record = (value: unknown): value is Mapping => typeof value === "object" && value !== null && !Array.isArray(value);

const trustedEvent = "github.repository == 'danielcg-net/bizyeet-ai-tools' && github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch'";
const verifier = 'gh attestation verify bundle/*.tgz --bundle "$ATTESTATION_BUNDLE" --repo danielcg-net/bizyeet-ai-tools --signer-workflow danielcg-net/bizyeet-ai-tools/.github/workflows/provenance.yml --source-ref refs/heads/main --source-digest "$SOURCE_SHA" --signer-digest "$SOURCE_SHA" --deny-self-hosted-runners';
const buildSteps = [
  { name: "Checkout trusted source", uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    with: { ref: "${{ github.sha }}", "persist-credentials": false } },
  { name: "Set up Node", uses: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020", with: { "node-version": 24 } },
  { name: "Build and verify without signing permissions", run: "npm ci --ignore-scripts\nnpm run release:verify\n" },
  { name: "Retain verified build", id: "bundle", uses: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    with: { name: "trusted-build-${{ github.sha }}", path: "release-artifacts/", "if-no-files-found": "error", "retention-days": 7 } },
];

// Deliberately exact: this is the sole permission exception, not a general
// allowlist for signing jobs. Any change to its execution boundary needs review
// alongside this policy. No checkout, package install or artifact execution.
const attestJob = {
  if: trustedEvent,
  needs: "build",
  "runs-on": "ubuntu-latest",
  "timeout-minutes": 10,
  permissions: { contents: "read", "id-token": "write", attestations: "write" },
  steps: [
    { name: "Download only this run's verified build", uses: "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
      with: { "artifact-ids": "${{ needs.build.outputs.artifact-id }}", path: "bundle", "merge-multiple": true } },
    { name: "Attest package provenance", id: "provenance", uses: "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6",
      with: { "subject-path": "bundle/*.tgz", "push-to-registry": false, "create-storage-record": false } },
    { name: "Verify artifact and exact signer identity",
      env: { GH_TOKEN: "${{ github.token }}", ATTESTATION_BUNDLE: "${{ steps.provenance.outputs.bundle-path }}", SOURCE_SHA: "${{ github.sha }}" },
      run: verifier },
    { name: "Retain signed provenance evidence", uses: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
      with: { name: "trusted-provenance-${{ github.sha }}", path: "${{ steps.provenance.outputs.bundle-path }}", "if-no-files-found": "error", "retention-days": 7 } },
  ],
};

/** Permit only the exact trusted, same-run, non-publishing attestation boundary. */
export const permitsTrustedAttestation = (fileName: string, workflow: Mapping, jobId: string, job: unknown): boolean => {
  if (fileName !== "provenance.yml" || jobId !== "attest" || !record(workflow.jobs) || !record(workflow.jobs.build)) return false;
  const build = workflow.jobs.build;
  return isDeepStrictEqual(workflow.on, { workflow_dispatch: null })
    && isDeepStrictEqual(workflow.permissions, { contents: "read" })
    && isDeepStrictEqual(Object.keys(workflow.jobs).sort(), ["attest", "build"])
    && isDeepStrictEqual(Object.keys(build).sort(), ["if", "outputs", "permissions", "runs-on", "steps", "timeout-minutes"])
    && build.if === trustedEvent && build["runs-on"] === "ubuntu-latest"
    && build["timeout-minutes"] === 15
    && isDeepStrictEqual(build.permissions, { contents: "read" })
    && isDeepStrictEqual(build.outputs, { "artifact-id": "${{ steps.bundle.outputs.artifact-id }}" })
    && isDeepStrictEqual(build.steps, buildSteps)
    && !["env", "environment", "defaults", "secrets"].some((key) => Object.hasOwn(workflow, key))
    && !["env", "environment", "container", "services", "uses", "secrets"].some((key) => Object.hasOwn(build, key))
    && isDeepStrictEqual(job, attestJob);
};
