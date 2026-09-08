import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateWorkflow } from "./check-workflow-security.js";

const source = (await readFile(new URL("../../.github/workflows/provenance.yml", import.meta.url), "utf8")).replaceAll("\r\n", "\n");

void test("permits only the reviewed main-only non-publishing provenance workflow", (): void => {
  assert.deepEqual(validateWorkflow("provenance.yml", source), []);
  assert.deepEqual(validateWorkflow("provenance.yml", source.replaceAll("\n", "\r\n")), []);
  assert.match(source, /needs: build/u);
  assert.doesNotMatch(source, /secrets\s*[.[]|npm publish|workflow_run|pull_request/u);
  assert.ok(validateWorkflow("other.yml", source).length > 0);
});

[
  ["PR trigger", "  workflow_dispatch:", "  pull_request:"],
  ["completion trigger", "  workflow_dispatch:", "  workflow_run:"],
  ["dispatch inputs", "  workflow_dispatch:", "  workflow_dispatch:\n    inputs:\n      ref:\n        type: string"],
  ["fork repository", "github.repository == 'danielcg-net/bizyeet-ai-tools'", "github.repository != ''"],
  ["arbitrary source ref", "github.ref == 'refs/heads/main'", "github.ref != ''"],
  ["different event", "github.event_name == 'workflow_dispatch'", "github.event_name != ''"],
  ["source checkout", "ref: ${{ github.sha }}", "ref: ${{ github.event.inputs.ref }}"],
  ["persisted checkout token", "persist-credentials: false", "persist-credentials: true"],
  ["unverified build", "npm run release:verify", "npm run build"],
  ["build secret", "run: |\n          npm ci", "env:\n          TOKEN: ${{ secrets.PUBLISH_TOKEN }}\n        run: |\n          npm ci"],
  ["different run artifact", "artifact-ids: ${{ needs.build.outputs.artifact-id }}", "artifact-ids: ${{ github.event.inputs.artifact }}"],
  ["cross-run download", "path: bundle", "path: bundle\n          run-id: 1234"],
  ["registry push", "push-to-registry: false", "push-to-registry: true"],
  ["storage record", "create-storage-record: false", "create-storage-record: true"],
  ["artifact execution", "gh attestation verify bundle/*.tgz", "npm install bundle/*.tgz"],
  ["different signer", "--signer-workflow danielcg-net/bizyeet-ai-tools/.github/workflows/provenance.yml", "--signer-workflow unrelated/repo/.github/workflows/build.yml"],
  ["missing source ref", "--source-ref refs/heads/main", ""],
  ["missing source SHA", '--source-digest "$SOURCE_SHA"', ""],
  ["missing signer SHA", '--signer-digest "$SOURCE_SHA"', ""],
  ["self-hosted signer", "--deny-self-hosted-runners", ""],
  ["global defaults", "permissions:\n  contents: read", "defaults:\n  run:\n    shell: malicious\npermissions:\n  contents: read"],
  ["broader token", "attestations: write", "attestations: write\n      packages: write"],
  ["build signing token", "    outputs:", "    env:\n      TOKEN: ${{ secrets.SIGNING_TOKEN }}\n    outputs:"],
  ["build shell override", "    outputs:", "    defaults:\n      run:\n        shell: malicious\n    outputs:"],
  ["build matrix override", "    outputs:", "    strategy:\n      matrix:\n        source: [untrusted]\n    outputs:"],
  ["privileged reusable workflow", "    needs: build", "    needs: build\n    uses: unrelated/repo/.github/workflows/sign.yml@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
].forEach(([name, before, after]) => {
  void test(`rejects provenance boundary regression: ${name ?? "unknown"}`, (): void => {
    assert.ok(before !== undefined && after !== undefined);
    assert.ok(source.includes(before));
    assert.ok(validateWorkflow("provenance.yml", source.replaceAll(before, after)).length > 0);
    assert.ok(validateWorkflow("provenance.yml", source.replaceAll(before, after).replaceAll("\n", "\r\n")).length > 0);
  });
});
