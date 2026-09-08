import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseDocument } from "yaml";

void test("release verification remains secret-free across the declared host/runtime matrix", async (): Promise<void> => {
  const source = await readFile(new URL("../../.github/workflows/release-verify.yml", import.meta.url), "utf8");
  const workflow = parseDocument(source).toJS() as Readonly<{
    permissions: Readonly<Record<string, string>>;
    jobs: Readonly<{ verify: Readonly<{
      "runs-on": string;
      "timeout-minutes": number;
      strategy: Readonly<{ matrix: Readonly<{ os: readonly string[]; node: readonly number[] }> }>;
      steps: readonly Readonly<{ run?: string; uses?: string; with?: Readonly<Record<string, unknown>> }>[];
    }> }>;
  }>;
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.jobs.verify["runs-on"], "${{ matrix.os }}");
  assert.equal(workflow.jobs.verify["timeout-minutes"], 15);
  assert.deepEqual(workflow.jobs.verify.strategy.matrix, { os: ["ubuntu-latest", "macos-latest", "windows-latest"], node: [24, 26] });
  assert.ok(workflow.jobs.verify.steps.some((step): boolean => step.run?.includes("npm run release:verify") === true));
  const upload = workflow.jobs.verify.steps.find((step): boolean => step.uses?.startsWith("actions/upload-artifact@") === true);
  assert.equal(upload?.with?.["retention-days"], 7);
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.doesNotMatch(source, /secrets\.|id-token:|attestations:|environment:|npm publish|pull_request_target|self-hosted/u);
});
