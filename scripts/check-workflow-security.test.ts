import assert from "node:assert/strict";
import test from "node:test";

import { validateWorkflow } from "./check-workflow-security.js";

const pinnedCheckout = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
const workflow = (body: string): string => `permissions:\n  contents: read\njobs:\n${body}`;

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
