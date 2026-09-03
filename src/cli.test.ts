import assert from "node:assert/strict";
import test from "node:test";

import { run } from "./cli.js";

void test("help describes the development-only state", (): void => {
  const result = run(["--help"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.message, /No tenant operation is available yet/);
  assert.match(result.message, /OAuth/);
});

void test("other commands fail closed until a supported command exists", (): void => {
  const result = run(["customers", "list"]);

  assert.equal(result.exitCode, 1);
  assert.match(result.message, /Unsupported command: customers/);
});
