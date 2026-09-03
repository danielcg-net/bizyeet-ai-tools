import assert from "node:assert/strict";
import test from "node:test";

import { isCliEntrypoint, run } from "./cli.js";

void test("help describes the development-only state", (): void => {
  const result = run(["--help"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.message, /No tenant operation is available yet/);
  assert.match(result.message, /OAuth/);
  assert.match(result.message, /bootstrap\.\nNo tenant operation/u);
});

void test("other commands fail closed until a supported command exists", (): void => {
  const result = run(["customers", "list"]);

  assert.equal(result.exitCode, 1);
  assert.match(result.message, /Unsupported command: customers/);
});

void test("recognizes an npm bin symlink as the CLI entrypoint", (): void => {
  const resolvePath = (path: string): string => path === "/bin/bizyeet" ? "/pkg/dist/src/cli.js" : path;

  assert.equal(isCliEntrypoint("/bin/bizyeet", resolvePath, "/pkg/dist/src/cli.js"), true);
});
