import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateWorkflow } from "./check-workflow-security.js";
import { renderReleaseWorkflow } from "./release-workflow-template.js";
import { parseDocument } from "yaml";

// Checkout may use CRLF on Windows. Build LF/CRLF cases from one canonical
// fixture so conversion never manufactures invalid CRCRLF YAML.
const source = (await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
void test("only exact reviewed main-dispatched publication workflow obtains privileged exceptions", (): void => {
  assert.deepEqual(validateWorkflow("release.yml", source), []);
  assert.deepEqual(validateWorkflow("release.yml", source.replaceAll("\n", "\r\n")), []);
  assert.ok(validateWorkflow("other.yml", source).length > 0);
});
void test("drift checks reject manual changes and explicit generation restores only canonical inline code", (): void => {
  const changed = source.replaceAll("Untrusted dispatch source", "unreviewed code");
  assert.ok(validateWorkflow("release.yml", changed).some((error) => error.includes("template drift")));
  const generated = renderReleaseWorkflow(changed);
  assert.deepEqual(parseDocument(generated).toJS({maxAliasCount: 0}) as unknown, parseDocument(source).toJS({maxAliasCount: 0}) as unknown);
  assert.deepEqual(validateWorkflow("release.yml", generated), []);
});
[
  ["PR trigger", "workflow_dispatch:", "pull_request:"],
  ["source", "ref: ${{ github.sha }}", "ref: other"],
  ["fork", "github.repository == 'danielcg-net/bizyeet-ai-tools'", "true"],
  ["branch", "github.ref == 'refs/heads/main'", "true"],
  ["permissions", "id-token: write", "id-token: write\n      packages: write"],
  ["approval", "environment: npm-release", "environment: unused"],
  ["matrix evidence", "needs:\n      - readiness\n      - matrix", "needs: readiness"],
  ["artifact", "artifact-ids: ${{ needs.build.outputs.artifact-id }}", "artifact-ids: 123"],
  ["cross run", "path: bundle", "path: bundle\n          run-id: 123"],
  ["signer", "--source-digest", "--unused"],
  ["lifecycle", "--ignore-scripts --provenance", "--provenance"],
  ["channel", "--tag=beta", "--tag=latest"],
  ["credential", "npm publish", "NODE_AUTH_TOKEN=secret npm publish"],
  ["default publish", "default: false", "default: true"],
  ["candidate execution", "gh attestation verify", "node bundle/candidate.js"],
  ["tag identity", "target.sha !== context.sha", "false"],
  ["checksum", "hash !== match[1]", "false"],
  ["environment bypass", "environment.can_admins_bypass !== false", "false"],
  ["same run", "release.run_id !== String(context.runId)", "false"],
].forEach(([name, before, after]) => {
  void test(`rejects release boundary regression: ${name ?? "unknown"}`, (): void => {
    assert.ok(before !== undefined && after !== undefined && source.includes(before));
    assert.ok(validateWorkflow("release.yml", source.replaceAll(before, after)).length > 0);
  });
});
