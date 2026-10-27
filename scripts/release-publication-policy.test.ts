import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateWorkflow } from "./check-workflow-security.js";
import { renderReleaseWorkflow } from "./release-workflow-template.js";
import { parseDocument } from "yaml";

// Checkout may use CRLF on Windows. Build LF/CRLF cases from one canonical
// fixture so conversion never manufactures invalid CRCRLF YAML.
const source = (await readFile(new URL("../../.github/workflows/release-cli.yml", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
void test("only exact reviewed main-dispatched publication workflow obtains privileged exceptions", (): void => {
  assert.deepEqual(validateWorkflow("release-cli.yml", source), []);
  assert.deepEqual(validateWorkflow("release-cli.yml", source.replaceAll("\n", "\r\n")), []);
  assert.ok(validateWorkflow("other.yml", source).length > 0);
  assert.ok(validateWorkflow("release.yml", source).length > 0);
  assert.ok(validateWorkflow("release-cli.yml", source.replaceAll("/.github/workflows/release-cli.yml", "/.github/workflows/release.yml")).length > 0);
});
void test("the cross-platform candidate gate uses Bash for its shared environment-variable syntax", (): void => {
  const workflow = parseDocument(source).toJS() as Readonly<{jobs: Readonly<{matrix: Readonly<{
    strategy: Readonly<{matrix: Readonly<{os: readonly string[]; node: readonly number[]}>}>;
    steps: readonly Readonly<{name?: string; shell?: string; run?: string}>[];
  }>}>}>;
  const gate = workflow.jobs.matrix.steps.find((step) => step.name === "Verify exact beta metadata and full installed package gate");
  assert.deepEqual(workflow.jobs.matrix.strategy.matrix, {os: ["ubuntu-latest", "macos-latest", "windows-latest"], node: [24, 26]});
  assert.equal(gate?.shell, "bash");
  assert.match(gate.run ?? "", /--tag "\$RELEASE_TAG"/u);
});
void test("drift checks reject manual changes and explicit generation restores only canonical inline code", (): void => {
  const changed = source.replaceAll("Untrusted dispatch source", "unreviewed code");
  assert.ok(validateWorkflow("release-cli.yml", changed).some((error) => error.includes("template drift")));
  const generated = renderReleaseWorkflow(changed);
  assert.deepEqual(parseDocument(generated).toJS({maxAliasCount: 0}) as unknown, parseDocument(source).toJS({maxAliasCount: 0}) as unknown);
  assert.deepEqual(validateWorkflow("release-cli.yml", generated), []);
});
void test("the static signing summary explicitly projects only presentation environment inputs", (): void => {
  const workflow = parseDocument(source).toJS() as Readonly<{jobs: Readonly<{attest: Readonly<{steps: readonly Readonly<{name: string; id?: string; env?: Readonly<Record<string, string>>; with?: Readonly<{script?: string}>}>[]}>}>}>;
  const script = workflow.jobs.attest.steps.find((step) => step.name === "Present attested candidate before approval")?.with?.script ?? "";
  assert.doesNotMatch(script, /\.\.\.process\.env/u);
  ["PUBLICATION_REQUESTED", "RELEASE_TAG", "CANDIDATE_ARTIFACT_ID", "PROVENANCE_ARTIFACT_ID"].forEach((key) => { assert.ok(script.includes(`${key}: process.env.${key}`)); });
  assert.match(script, /GITHUB_SHA: context\.sha/u);
  assert.match(script, /GITHUB_RUN_ID: String\(context\.runId\)/u);
  assert.match(script, /REVIEW_ATTESTED: process\.env\.REVIEW_ATTESTED/u);
  assert.match(script, /process\.env\.REVIEW_ATTESTED !== 'true'/u);
  assert.equal(workflow.jobs.attest.steps.find((step) => step.name === "Verify cryptographic provenance identity")?.id, "verified");
  assert.equal(workflow.jobs.attest.steps.find((step) => step.name === "Attest exact canonical tarball")?.id, "provenance");
  assert.equal(workflow.jobs.attest.steps.find((step) => step.name === "Retain signed candidate evidence")?.id, "signed");
  assert.equal(workflow.jobs.attest.steps.find((step) => step.name === "Present attested candidate before approval")?.env?.REVIEW_ATTESTED, "${{ steps.provenance.outcome == 'success' && steps.verified.outcome == 'success' && steps.signed.outcome == 'success' && 'true' || 'false' }}");
});
[
  ["PR trigger", "workflow_dispatch:", "pull_request:"],
  ["source", "ref: ${{ github.sha }}", "ref: other"],
  ["fork", "github.repository == 'danielcg-net/bizyeet-ai-tools'", "true"],
  ["branch", "github.ref == 'refs/heads/main'", "true"],
  ["permissions", "id-token: write", "id-token: write\n      packages: write"],
  ["approval", "environment: npm-release", "environment: unused"],
  ["matrix evidence", "needs:\n      - readiness\n      - matrix", "needs: readiness"],
  ["matrix shell", "shell: bash", "shell: pwsh"],
  ["missing matrix shell", "        shell: bash\n", ""],
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
  ["source notes", "release.notes !== canonicalNotes", "false && release.notes !== canonicalNotes"],
  ["environment bypass", "environment.can_admins_bypass !== false", "false"],
  ["same run", "release.run_id !== String(context.runId)", "false"],
].forEach(([name, before, after]) => {
  void test(`rejects release boundary regression: ${name ?? "unknown"}`, (): void => {
    assert.ok(before !== undefined && after !== undefined && source.includes(before));
    assert.ok(validateWorkflow("release-cli.yml", source.replaceAll(before, after)).length > 0);
  });
});

void test("real candidate evidence is presented before the protected gate and after its phase proof", (): void => {
  type Step = Readonly<{name: string; id?: string; run?: string; with?: Readonly<{script?: string}>; if?: string}>;
  const workflow = parseDocument(source).toJS() as Readonly<{jobs: Readonly<Record<string, Readonly<{needs: unknown; environment?: string; steps: readonly Step[]}>>>}>;
  const build = workflow.jobs.build;
  const attest = workflow.jobs.attest;
  const publish = workflow.jobs.publish;
  assert.ok(build && attest && publish);
  assert.deepEqual(build.needs, ["readiness", "matrix"]);
  const buildSummary = build.steps.findIndex((step) => step.name === "Present canonical candidate before approval");
  assert.ok(buildSummary > build.steps.findIndex((step) => step.id === "bundle"));
  assert.equal(build.steps[buildSummary]?.run, "node dist/scripts/release-review-summary.js");
  assert.equal(build.steps[buildSummary].if, undefined);
  assert.equal(attest.needs, "build");
  const attestedSummary = attest.steps.findIndex((step) => step.name === "Present attested candidate before approval");
  assert.ok(attestedSummary > attest.steps.findIndex((step) => step.name === "Verify cryptographic provenance identity"));
  assert.ok(attestedSummary > attest.steps.findIndex((step) => step.id === "signed"));
  assert.equal(attest.steps[attestedSummary]?.if, undefined);
  assert.deepEqual(publish.needs, ["build", "attest"]);
  assert.equal(publish.environment, "npm-release");
  const generic = publish.steps.find((step) => step.name === "Revalidate exact source, tag, policy and candidate");
  assert.doesNotMatch(generic?.with?.script ?? "", /GITHUB_STEP_SUMMARY|approval still required/u);
});
