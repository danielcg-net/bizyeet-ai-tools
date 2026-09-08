import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { checkWorkflowSecurity, validateWorkflow } from "./check-workflow-security.js";

const pinnedCheckout = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
const workflow = (body: string): string => `permissions:\n  contents: read\njobs:\n${body}`;

void test("reads workflow directories through decoded platform file URLs", async (): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), "workflow path with spaces-"));
  try {
    await writeFile(join(directory, "test.yml"), workflow("  check:\n    runs-on: ubuntu-latest\n"));
    assert.deepEqual(await checkWorkflowSecurity(pathToFileURL(directory + sep)), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("rejects a self-hosted label in a multi-label runner", (): void => {
  const violations = validateWorkflow("test.yml", workflow("  check:\n    runs-on: [ubuntu-latest, self-hosted]\n"));

  assert.deepEqual(violations, ["test.yml: self-hosted runners are forbidden"]);
});

void test("rejects unapproved write permissions", (): void => {
  const source = `permissions:\n  contents: write\njobs:\n  check:\n    runs-on: ubuntu-latest\n`;

  assert.deepEqual(validateWorkflow("test.yml", source), ["test.yml: permissions must use the approved least-privilege mapping"]);
});

void test("accepts a quoted immutable action reference", (): void => {
  const source = workflow(`  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: "${pinnedCheckout}"\n`);

  assert.deepEqual(validateWorkflow("test.yml", source), []);
});

void test("rejects privileged pull request triggers in all valid YAML forms", (): void => {
  ["on: pull_request_target", "on: [push, pull_request_target]", "on:\n  pull_request_target:\n    types: [opened]", "\"on\":\n  pull_request_target:"].forEach((trigger) => {
    assert.deepEqual(validateWorkflow("test.yml", `${trigger}\n${workflow("  check:\n    runs-on: ubuntu-latest\n")}`), ["test.yml: pull_request_target is forbidden"]);
  });
});

void test("rejects job permission escalation even with safe workflow defaults", (): void => {
  ["write-all", "{ contents: write }", "{ id-token: write }", "{ packages: write }"].forEach((permissions) => {
    assert.deepEqual(validateWorkflow("test.yml", workflow(`  check:\n    runs-on: ubuntu-latest\n    permissions: ${permissions}\n`)), ["test.yml: job permissions must use the approved least-privilege mapping"]);
  });
  assert.deepEqual(validateWorkflow("test.yml", workflow("  check:\n    runs-on: ubuntu-latest\n    permissions: {}\n")), []);
});

void test("requires immutable references for reusable workflows as well as steps", (): void => {
  const reference = "example/security/.github/workflows/check.yml";
  assert.deepEqual(validateWorkflow("test.yml", workflow(`  check:\n    uses: ${reference}@main\n`)), [`test.yml: action must use a full commit SHA (${reference}@main)`]);
  assert.deepEqual(validateWorkflow("test.yml", workflow(`  check:\n    uses: ${reference}@${"a".repeat(40)}\n`)), []);
});
