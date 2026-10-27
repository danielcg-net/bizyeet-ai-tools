import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { isolatedTestEnvironment } from "./test-child-environment.js";

void test("fixture environments retain OS essentials but reject inherited authority and executable hooks", (): void => {
  const root = join(tmpdir(), "owned-fixture");
  const inherited = {PATH: "/approved/bin", SystemRoot: "C:\\Windows", ProgramFiles: "C:\\Program Files", GH_TOKEN: "secret", GITHUB_OUTPUT: "/real/output", GITHUB_STEP_SUMMARY: "/real/summary", ACTIONS_RUNTIME_TOKEN: "secret", NODE_OPTIONS: "--require=bad", npm_config_userconfig: "/real/npmrc"};
  const result = isolatedTestEnvironment(root, inherited, {GITHUB_RUN_ATTEMPT: "2", EXPECTED_BETA: "example", github_output: "/override/output", NODE_OPTIONS: "--require=bad", NPM_CONFIG_USERCONFIG: "/override/npmrc", AWS_SECRET_ACCESS_KEY: "parent-secret", AZURE_CLIENT_SECRET: "parent-secret", GH_ENTERPRISE_TOKEN: "parent-secret", arbitrary_parent_variable: "must-not-copy", PSModuleAnalysisCachePath: "/parent/cache", PSModulePath: "/parent/modules"});
  assert.equal(result.PATH, inherited.PATH);
  assert.equal(result.SystemRoot, inherited.SystemRoot);
  assert.equal(result.ProgramFiles, inherited.ProgramFiles);
  assert.equal(result.GITHUB_RUN_ATTEMPT, "2");
  assert.equal(result.EXPECTED_BETA, "example");
  ["GH_TOKEN", "ACTIONS_RUNTIME_TOKEN", "NODE_OPTIONS", "github_output", "NPM_CONFIG_USERCONFIG", "AWS_SECRET_ACCESS_KEY", "AZURE_CLIENT_SECRET", "GH_ENTERPRISE_TOKEN", "arbitrary_parent_variable"].forEach((key) => { assert.equal(result[key], undefined); });
  assert.equal(result.HOME, root);
  assert.equal(result.npm_config_userconfig, join(root, "npm-user-config"));
  assert.equal(result.PSModuleAnalysisCachePath, join(root, "powershell-module-cache"));
  assert.equal(result.PSModulePath, undefined);
  ["GITHUB_STEP_SUMMARY", "GITHUB_OUTPUT", "GITHUB_ENV", "GITHUB_PATH", "GITHUB_STATE"].forEach((key) => { assert.ok(result[key]?.startsWith(root)); });
});
