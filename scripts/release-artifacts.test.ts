import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArtifactBundle, packedFileName, validateSbom } from "./release-artifacts.js";

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
