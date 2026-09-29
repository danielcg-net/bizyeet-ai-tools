import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

void test("only the isolated same-repository DeepSeek review may write PR comments", async (): Promise<void> => {
  const source = await readFile(new URL("../../.github/workflows/deepseek-cr.yml", import.meta.url), "utf8");
  assert.deepEqual(validateWorkflow("deepseek-cr.yml", source), []);
  assert.deepEqual(validateWorkflow("other.yml", source), ["other.yml: job permissions must use the approved least-privilege mapping"]);
  const unsafe = [
    source.replace("github.event.pull_request.head.repo.full_name == github.repository", "github.event.pull_request.number > 0"),
    source.replace("runs-on: ubuntu-latest", "runs-on: [self-hosted, bizyeet]"),
    source.replace("reconcile-threads: \"false\"", "reconcile-threads: \"true\""),
    source.replace("contents: read\n      pull-requests: write", "contents: write\n      pull-requests: write"),
    source.replace("      # No checkout", "      - run: echo untrusted\n      # No checkout"),
    source.replace("github.rest.pulls.listCommits", "github.rest.pulls.get"),
  ];
  unsafe.forEach((variant) => {
    assert.notDeepEqual(validateWorkflow("deepseek-cr.yml", variant), []);
  });
  assert.deepEqual(validateWorkflow("deepseek-cr.yml", source.replace("pull_request:", "pull_request_target:")),
    ["deepseek-cr.yml: pull_request_target is forbidden", "deepseek-cr.yml: job permissions must use the approved least-privilege mapping"]);
});
