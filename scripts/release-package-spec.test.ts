import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parseDocument } from "yaml";
import { parse } from "shell-quote";
import { isolatedTestEnvironment } from "./test-child-environment.js";

const execute = promisify(execFile);
void test("the actual publisher argument resolves as a local file in npm's own bundled package parser", async (): Promise<void> => {
  const npm = process.env.npm_execpath;
  assert.ok(npm, "Run through npm test to select the actual npm CLI parser.");
  const root = await mkdtemp(join(tmpdir(), "bizyeet-npm-spec-"));
  try {
    await mkdir(join(root, "bundle"));
    const source = await readFile(new URL("../../.github/workflows/release-cli.yml", import.meta.url), "utf8");
    const workflow = parseDocument(source).toJS() as Readonly<{jobs: Readonly<{publish: Readonly<{steps: readonly Readonly<{run?: string}>[]}>}>}>;
    const lines = workflow.jobs.publish.steps.flatMap((step) => step.run?.split("\n").filter((line) => /^\s*npm publish /u.test(line)) ?? []);
    assert.equal(lines.length, 1);
    const filename = "candidate-0.1.0-beta.2.tgz";
    const command = parse(lines[0] ?? "", {TARBALL: filename});
    assert.equal(command[0], "npm");
    assert.equal(command[1], "publish");
    const spec = command[2];
    if (typeof spec !== "string") throw new Error("Publisher package argument must be a string.");
    const program = "const {createRequire}=require('node:module'); const npa=createRequire(process.argv[1])('npm-package-arg'); const result=npa(process.argv[2],process.argv[3]); console.log(JSON.stringify({type:result.type,fetchSpec:result.fetchSpec,hosted:result.hosted?.type}));";
    const parseSpec = async (value: string): Promise<Readonly<{type: string; fetchSpec: string; hosted?: string}>> => JSON.parse((await execute(process.execPath, ["-e", program, npm, value, root], {cwd: root, env: isolatedTestEnvironment(root), timeout: 10_000})).stdout) as Readonly<{type: string; fetchSpec: string; hosted?: string}>;
    const actual = await parseSpec(spec);
    assert.equal(actual.type, "file");
    assert.equal(resolve(actual.fetchSpec), join(root, "bundle", filename));
    const originalBug = await parseSpec(`bundle/${filename}`);
    assert.equal(originalBug.type, "git");
    assert.equal(originalBug.hosted, "github");
  } finally { await rm(root, {recursive: true, force: true}); }
});
