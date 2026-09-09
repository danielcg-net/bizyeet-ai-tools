import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkDocumentation, inspectDocumentation } from "./check-documentation.js";

const files = new Set(["README.md", "docs/setup.md", "docs/image name.png"]);
const scripts = new Set(["check", "release:verify"]);
const inspect = (source: string): readonly string[] => inspectDocumentation("docs/setup.md", source, files, scripts).map((finding) => finding.reason);

void test("accepts relative files, encoded images and reference links while keeping external URLs offline", (): void => {
  assert.deepEqual(inspect("[home](../README.md#heading) [directory](../docs) [slash](../docs/) [root](../) ![asset](image%20name.png) [local](#heading) [web](https://example.invalid) [mail](mailto:example@example.invalid)\n\n[reference][home]\n\n[home]: ../README.md"), []);
});

void test("checks actual destinations, including nested links and images, not deceptive labels", (): void => {
  assert.equal(inspect("> - [../README.md](missing.md)\n\n![image](missing.png)").length, 2);
  assert.deepEqual(inspect("`[fake](missing.md)`\n\n```text\n[also fake](missing.md)\n```\n\n[unused]: missing.md"), []);
});

void test("rejects escaped, malformed and unsupported repository links", (): void => {
  ["../../outside.md", "%2e%2e/%2e%2e/outside.md", "/README.md", "bad%XX.md", "bad%00.md", "bad%5cmd", "file:///etc/passwd", "javascript:alert(1)", "//example.invalid/file", "https://"].forEach((link): void => {
    assert.equal(inspect(`[link](<${link}>)`).length, 1, link);
  });
});

void test("validates JSON blocks and npm script names without executing documentation", (): void => {
  assert.deepEqual(inspect('```json\n{"data": []}\n```\n\n`npm run check`\n\n```sh\nnpm run release:verify -- --example\n```'), []);
  assert.deepEqual(inspect('```json\n{"data":}\n```'), ["JSON example is not valid JSON."]);
  assert.deepEqual(inspect("```sh\nnpm run missing; echo should-not-execute\n```"), ["Documented npm run command is absent from package.json or is not a literal script name."]);
  assert.deepEqual(inspect("```text\nnpm run fictional\n```"), []);
});

void test("uses the first normalized fence-info word when metadata follows the language", (): void => {
  ["json example", "JSON title=example", "json\tmetadata"].forEach((info): void => {
    assert.deepEqual(inspect(`\`\`\`${info}\n{invalid}\n\`\`\``), ["JSON example is not valid JSON."]);
  });
  ["bash session", "SH title=example", "console output"].forEach((info): void => {
    assert.equal(inspect(`\`\`\`${info}\nnpm run missing\n\`\`\``).length, 1);
  });
  assert.deepEqual(inspect('```JSON example\n{"valid": true}\n```\n\n```bash session\nnpm run check\n```'), []);
});

void test("checks complete quoted or punctuated npm operands and never expands environment variables", (): void => {
  ["check.typo", '"check.typo"', "'check'.typo", "check$MISSING", '"$SCRIPT"', "$(echo check)", "check?", "check/typo", "--silent check"].forEach((operand): void => {
    assert.equal(inspect(`\`npm run ${operand}\``).length, 1, operand);
  });
  assert.deepEqual(inspect('`npm run`\n\n`npm run "check"`\n\n```sh\nnpm run check && npm run release:verify # npm run ignored\n```'), []);
  assert.deepEqual(inspectDocumentation("README.md", '`npm run test.unit`\n\n`npm run "test space"`', files, new Set(["test.unit", "test space"])), []);
  assert.equal(inspect('`npm run "unterminated`').length, 1);
});

const withRepository = (verify: (root: string) => void): void => {
  const root = mkdtempSync(join(tmpdir(), "documentation check "));
  try {
    execFileSync("git", ["init", "--quiet", root], { timeout: 10_000 });
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "README.md"), "[setup](docs/setup.md)\n");
    writeFileSync(join(root, "docs/setup.md"), "`npm run check`\n");
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { check: "not executed" } }));
    execFileSync("git", ["add", "README.md", "docs/setup.md", "package.json"], { cwd: root, timeout: 10_000 });
    verify(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

void test("checks tracked documents from a real repository with spaces without running scripts", (): void => {
  withRepository((root): void => {
    assert.deepEqual(checkDocumentation(root), []);
    writeFileSync(join(root, "untracked.md"), "this is not a published document");
    writeFileSync(join(root, "README.md"), "[not committed](untracked.md)");
    assert.deepEqual(checkDocumentation(root), [{ file: "README.md", reason: "Repository link does not name a tracked file or directory." }]);
  });
});

void test("rejects oversized documents and malformed script metadata", (): void => {
  withRepository((root): void => {
    [null, {}, { scripts: [] }, { scripts: { check: 1 } }].forEach((metadata): void => {
      writeFileSync(join(root, "package.json"), JSON.stringify(metadata));
      assert.throws(() => checkDocumentation(root), /must declare scripts/u);
    });
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { check: "not executed" } }));
    writeFileSync(join(root, "README.md"), "x".repeat(1024 * 1024 + 1));
    assert.throws(() => checkDocumentation(root), /at most 1 MiB/u);
  });
});

void test("rejects symlinked Markdown rather than reading its target", { skip: process.platform === "win32" }, (): void => {
  withRepository((root): void => {
    rmSync(join(root, "README.md"));
    symlinkSync("package.json", join(root, "README.md"));
    assert.throws(() => checkDocumentation(root), /regular in-repository file/u);
  });
});
