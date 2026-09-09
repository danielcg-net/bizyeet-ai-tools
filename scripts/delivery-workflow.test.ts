import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { parseDocument } from "yaml";

type Step = Readonly<{
  uses?: string;
  run?: string;
  "working-directory"?: string;
  with?: Readonly<Record<string, unknown>>;
}>;
type Workflow = Readonly<{
  on: Readonly<Record<string, unknown>>;
  permissions: Readonly<Record<string, string>>;
  jobs: Readonly<{ validate: Readonly<{ "runs-on": string; steps: readonly Step[] }> }>;
}>;

const sourceUrl = new URL("../../.github/workflows/youtrack-delivery-policy.yml", import.meta.url);
const helperPath = "dist/.github/scripts/validate-youtrack-delivery-policy.js";

const policyImport = (source: string): string => {
  const workflow = parseDocument(source).toJS() as Workflow;
  assert.deepEqual(Object.keys(workflow.on), ["pull_request"]);
  assert.deepEqual(workflow.permissions, { contents: "read", "pull-requests": "read" });
  assert.equal(workflow.jobs.validate["runs-on"], "ubuntu-latest");
  const steps = workflow.jobs.validate.steps;
  const checkout = steps.filter((step): boolean => step.uses?.startsWith("actions/checkout@") === true);
  assert.equal(checkout.length, 1);
  assert.deepEqual(checkout[0]?.with, {
    ref: "${{ github.event.pull_request.base.sha }}", path: "trusted-policy", "persist-credentials": false,
  });
  assert.deepEqual(steps.find((step): boolean => step.uses?.startsWith("actions/setup-node@") === true)?.with,
    { "node-version-file": "trusted-policy/.nvmrc" });
  const commands = steps.filter((step): boolean => typeof step.run === "string");
  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.["working-directory"], "trusted-policy");
  assert.equal(commands[0].run, "npm ci --ignore-scripts && npm run test");
  const script = steps.find((step): boolean => step.uses?.startsWith("actions/github-script@") === true)?.with?.script;
  assert.equal(typeof script, "string");
  assert.ok(typeof script === "string");
  const imports = [...script.matchAll(/await import\(`\$\{process.env.GITHUB_WORKSPACE\}\/([^`]+)`\)/gu)];
  assert.equal(imports.length, 1);
  assert.equal(imports[0]?.[1], `trusted-policy/${helperPath}`);
  assert.ok(script.includes("policy.validatePullRequestBody(metadata.issueId, pull.body)"));
  assert.ok(script.includes("policy.validateCommitMessages(metadata.issueId, commits)"));
  assert.ok(script.includes("policy.isTrustedDependabotAuthor(pull.user?.login)"));
  return imports[0][1];
};

void test("delivery policy builds and imports only the exact trusted base checkout", async (): Promise<void> => {
  const source = await readFile(sourceUrl, "utf8");
  policyImport(source);
  [
    source.replace("pull_request.base.sha", "pull_request.head.sha"),
    source.replace("working-directory: trusted-policy", "working-directory: ."),
    source.replace("/trusted-policy/dist/", "/dist/"),
    source.replace("npm ci --ignore-scripts", "npm ci"),
    source.replace("node-version-file: trusted-policy/.nvmrc", "node-version-file: .nvmrc"),
  ].forEach((mutation): void => { assert.throws((): string => policyImport(mutation)); });
});

void test("a PR-local no-op validator cannot replace the selected base validator", async (): Promise<void> => {
  const relativeImport = policyImport(await readFile(sourceUrl, "utf8"));
  // Keep the temporary fixture under the project so the trusted helper resolves
  // the project's locked Marked dependency without copying or executing PR code.
  const workspace = await mkdtemp(join(process.cwd(), ".policy-workflow-"));
  try {
    await mkdir(join(workspace, "dist/.github/scripts"), { recursive: true });
    await mkdir(join(workspace, "trusted-policy/dist/.github/scripts"), { recursive: true });
    await writeFile(join(workspace, helperPath), "export const validatePullRequestBody = () => [];\n");
    await copyFile(new URL(`../../${helperPath}`, import.meta.url), join(workspace, relativeImport));
    const policy = await import(pathToFileURL(join(workspace, relativeImport)).href) as Readonly<{
      validatePullRequestBody: (issueId: string, body: string) => readonly string[];
    }>;
    assert.equal(policy.validatePullRequestBody("bizyeet-741", "No tracking link").length, 1);
    assert.deepEqual(policy.validatePullRequestBody("bizyeet-741", "https://bizyeet.youtrack.cloud/issue/BIZYEET-741"), []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
