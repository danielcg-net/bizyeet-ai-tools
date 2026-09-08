import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArtifactBundle, declaredBinTarget, packedFileName, rebuildForRelease, validateSbom } from "./release-artifacts.js";

void test("removes stale generated files before building without changing source", async (): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "bizyeet-clean-build-"));
  const stale = join(root, "dist", "removed-module.js");
  try {
    await mkdir(join(root, "dist"));
    await writeFile(stale, "stale output");
    await writeFile(join(root, "source.ts"), "preserve source");
    await rebuildForRelease(root, async (): Promise<void> => {
      await assert.rejects(readFile(stale), { code: "ENOENT" });
      await mkdir(join(root, "dist"));
      await writeFile(join(root, "dist", "current.js"), "fresh output");
    });
    assert.equal(await readFile(join(root, "dist", "current.js"), "utf8"), "fresh output");
    assert.equal(await readFile(join(root, "source.ts"), "utf8"), "preserve source");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("refuses to overwrite an existing verification directory before invoking npm", async (): Promise<void> => {
  const existing = await mkdtemp(join(tmpdir(), "bizyeet-existing-bundle-"));
  const evidence = join(existing, "evidence.txt");
  try {
    await writeFile(evidence, "keep this evidence");
    await assert.rejects(buildArtifactBundle("unused-root", existing), { code: "EEXIST" });
    assert.equal(await readFile(evidence, "utf8"), "keep this evidence");
  } finally {
    await rm(existing, { recursive: true, force: true });
  }
});

void test("accepts one bounded package filename and rejects traversal or extra artifacts", (): void => {
  assert.equal(packedFileName([{ filename: "bizyeet-ai-tools-0.0.0-development.tgz" }]), "bizyeet-ai-tools-0.0.0-development.tgz");
  [[], {}, [{ filename: "../artifact.tgz" }], [{ filename: "/artifact.tgz" }], [{ filename: "x\\artifact.tgz" }], [{ filename: "a.tgz" }, { filename: "b.tgz" }], [{ filename: "a\n.tgz" }]].forEach((value): void => { assert.throws(() => packedFileName(value)); });
});

void test("requires CycloneDX metadata before accepting an SBOM", (): void => {
  assert.doesNotThrow((): void => { validateSbom({ bomFormat: "CycloneDX", specVersion: "1.5", metadata: { component: { name: "@bizyeet/ai-tools" } } }); });
  [null, [], {}, { bomFormat: "SPDX", specVersion: "1.5", metadata: {} }, { bomFormat: "CycloneDX", specVersion: "1.5", metadata: {} }].forEach((value): void => { assert.throws((): void => { validateSbom(value); }); });
});

void test("requires the declared bizyeet command inside the installed package", (): void => {
  const root = join(tmpdir(), "installed-toolkit");
  assert.equal(declaredBinTarget({ name: "@bizyeet/ai-tools", bin: { bizyeet: "./dist/src/cli.js" } }, root), join(root, "dist", "src", "cli.js"));
  [{}, { name: "@bizyeet/ai-tools" }, ...["../outside.js", "/outside.js", "C:\\outside.js", "..\\outside.js", "dist/cli.cmd"].map((path): Readonly<Record<string, unknown>> => ({ name: "@bizyeet/ai-tools", bin: { bizyeet: path } }))].forEach((value): void => { assert.throws(() => declaredBinTarget(value, root)); });
});
