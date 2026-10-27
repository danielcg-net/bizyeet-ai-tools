import assert from "node:assert/strict";
import { delimiter, dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import test from "node:test";
import { fixtureSystemPath, installedBinEnvironment, isolatedTestEnvironment } from "./test-child-environment.js";

void test("fixture environments retain OS essentials but reject inherited authority and executable hooks", (): void => {
  const root = join(tmpdir(), "owned-fixture");
  const inherited = {PATH: "/approved/bin", SystemRoot: "C:\\Windows", ProgramFiles: "C:\\Program Files", GH_TOKEN: "secret", GITHUB_OUTPUT: "/real/output", GITHUB_STEP_SUMMARY: "/real/summary", ACTIONS_RUNTIME_TOKEN: "secret", NODE_OPTIONS: "--require=bad", npm_config_userconfig: "/real/npmrc"};
  const result = isolatedTestEnvironment(root, inherited, {GITHUB_RUN_ATTEMPT: "2", EXPECTED_BETA: "example", github_output: "/override/output", NODE_OPTIONS: "--require=bad", NPM_CONFIG_USERCONFIG: "/override/npmrc", AWS_SECRET_ACCESS_KEY: "parent-secret", AZURE_CLIENT_SECRET: "parent-secret", GH_ENTERPRISE_TOKEN: "parent-secret", arbitrary_parent_variable: "must-not-copy", PSModuleAnalysisCachePath: "/parent/cache", PSModulePath: "/parent/modules", PATH: "/override/bin", Path: "/override/alias"});
  assert.equal(result.PATH, fixtureSystemPath(inherited));
  assert.equal(result.Path, undefined);
  assert.deepEqual(Object.keys(result).filter((key) => key.toUpperCase() === "PATH"), ["PATH"]);
  assert.ok(!result.PATH.includes(inherited.PATH));
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

void test("fixture paths contain only fixed OS tools and the runtime, with Windows case deduplication", (): void => {
  assert.equal(fixtureSystemPath({}, {platform: "linux", execPath: "/runtime/node"}), "/runtime:/usr/bin:/bin");
  assert.equal(fixtureSystemPath({}, {platform: "darwin", execPath: "/usr/bin/node"}), "/usr/bin:/bin");
  assert.equal(fixtureSystemPath({SystemRoot: "C:\\Windows", ProgramFiles: "C:\\Program Files"}, {platform: "win32", execPath: "c:\\windows\\system32\\node.exe"}), "c:\\windows\\system32;C:\\Program Files\\OpenSSL\\bin");
  ["", "relative", "C:\\Windows;C:\\poison", "C:\\Windows\n"].forEach((SystemRoot) => {
    assert.throws(() => fixtureSystemPath({SystemRoot, ProgramFiles: "C:\\Program Files"}, {platform: "win32", execPath: "C:\\Node\\node.exe"}));
  });
  [undefined, "", "relative", "C:\\Program Files;C:\\poison", "C:\\Program Files\u202e"].forEach((ProgramFiles) => {
    assert.throws(() => fixtureSystemPath({SystemRoot: "C:\\Windows", ProgramFiles}, {platform: "win32", execPath: "C:\\Node\\node.exe"}));
  });
  ["", "relative", "/runtime:poison/node", "/runtime\n/node"].forEach((execPath) => {
    assert.throws(() => fixtureSystemPath({}, {platform: "linux", execPath}));
  });
});

void test("poisoned inherited and override PATH aliases cannot select fixture node or OpenSSL commands", async (): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "bizyeet-path-canary-"));
  try {
    const poison = join(root, "poison");
    await mkdir(poison);
    await Promise.all(["node", "openssl"].map(async (name): Promise<void> => {
      await writeFile(join(poison, process.platform === "win32" ? `${name}.exe` : name), process.platform === "win32" ? "invalid executable POISON_PATH_EXECUTED" : "#!/bin/sh\nprintf 'POISON_PATH_EXECUTED\\n'\n", {mode: 0o700});
    }));
    const environment = isolatedTestEnvironment(root, {...process.env, PATH: poison, Path: poison}, {PATH: poison, Path: poison});
    assert.equal(environment.Path, undefined);
    assert.ok(!environment.PATH?.split(delimiter).includes(poison));
    const execute = promisify(execFile);
    assert.equal((await execute("node", ["--version"], {env: environment})).stdout.trim(), process.version);
    const openssl = (await execute("openssl", ["version"], {env: environment})).stdout;
    assert.match(openssl, /^(?:OpenSSL|LibreSSL) /u);
    assert.doesNotMatch(openssl, /POISON_PATH_EXECUTED/u);
  } finally { await rm(root, {recursive: true, force: true}); }
});

void test("installed-bin paths require an owned private root, canonical base and fixed nonescaping directory", async (): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "bizyeet-bin-environment-"));
  const outside = await mkdtemp(join(tmpdir(), "bizyeet-bin-outside-"));
  try {
    const bin = join(root, "node_modules", ".bin");
    await mkdir(bin, {recursive: true});
    const base = isolatedTestEnvironment(root);
    const actual = await installedBinEnvironment(root, base);
    assert.equal(actual.PATH?.split(delimiter).slice(1).join(delimiter), base.PATH);
    assert.equal(dirname(actual.PATH?.split(delimiter)[0] ?? ""), join(await realpath(root), "node_modules"));
    await assert.rejects(installedBinEnvironment(root, {...base, PATH: "/poison"}), /canonical isolated search path/u);
    await assert.rejects(installedBinEnvironment(root, {...base, Path: base.PATH}), /canonical isolated search path/u);
    await assert.rejects(installedBinEnvironment(root, {...base, HOME: outside}), /canonical isolated search path/u);
    await assert.rejects(installedBinEnvironment("relative", base), /absolute private directory/u);
    await assert.rejects(installedBinEnvironment(`${root}\n`, base), /absolute private directory/u);
    if (process.platform !== "win32") {
      await chmod(root, 0o755);
      await assert.rejects(installedBinEnvironment(root, base), /canonical isolated search path/u);
      await chmod(root, 0o700);
      await chmod(bin, 0o777);
      await assert.rejects(installedBinEnvironment(root, base), /canonical isolated search path/u);
      await chmod(bin, 0o755);
    }
    await rm(bin, {recursive: true});
    await symlink(outside, bin, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(installedBinEnvironment(root, base), /canonical isolated search path/u);
  } finally { await Promise.all([rm(root, {recursive: true, force: true}), rm(outside, {recursive: true, force: true})]); }
});
