import assert from "node:assert/strict";
import test from "node:test";
import { canonicalReleaseNotes, CHANGELOG_SOURCE_BYTE_LIMIT, RELEASE_NOTES_BYTE_LIMIT } from "./release-notes.js";

const version = "0.1.0-beta.1";
const notes = `## [${version}] - 2026-10-26\n\n- Preserve reviewed **Markdown**, links and Unicode café.\n`;

void test("canonical notes preserve the existing Unix section shape and normalize CRLF deterministically", (): void => {
  const source = `# Changelog\n\n${notes}\n## [0.0.0] - 2026-10-01\n\n- Older release.\n`;
  assert.equal(canonicalReleaseNotes(source, version), notes);
  assert.equal(canonicalReleaseNotes(source.replaceAll("\n", "\r\n"), version), notes);
});

void test("canonical notes reject duplicate, missing, malformed heading and wrong-version sections", (): void => {
  [notes + notes, "# Changelog\n", notes.replace("## ", "### "), notes.replace(`[${version}]`, "[9.9.9-beta.1]"), notes.replace(" - 2026-10-26", ""), notes.replaceAll("\n", "\r")].forEach((source) => {
    assert.throws(() => canonicalReleaseNotes(source, version));
  });
  assert.throws(() => canonicalReleaseNotes(notes, "not-a-version"));
});

void test("notes budget is inclusive and counts UTF-8 bytes rather than JavaScript characters", (): void => {
  const prefix = `## [${version}] - 2026-10-26\n\n`;
  const remaining = RELEASE_NOTES_BYTE_LIMIT - new TextEncoder().encode(prefix + "\n").byteLength;
  const exact = prefix + "é".repeat(Math.floor(remaining / 2)) + (remaining % 2 === 1 ? "x" : "") + "\n";
  assert.ok(exact.length < RELEASE_NOTES_BYTE_LIMIT);
  assert.equal(new TextEncoder().encode(exact).byteLength, RELEASE_NOTES_BYTE_LIMIT);
  assert.equal(canonicalReleaseNotes(exact, version), exact);
  assert.throws(() => canonicalReleaseNotes(exact.trimEnd() + "x\n", version), /UTF-8 budget/u);
});

void test("the entire changelog has an independent inclusive UTF-8 source budget", (): void => {
  const suffix = `\n${notes}`;
  const exact = "x".repeat(CHANGELOG_SOURCE_BYTE_LIMIT - new TextEncoder().encode(suffix).byteLength) + suffix;
  assert.equal(canonicalReleaseNotes(exact, version), notes);
  assert.throws(() => canonicalReleaseNotes("x" + exact, version), /Source CHANGELOG exceeds/u);
  assert.throws(() => canonicalReleaseNotes("é".repeat(CHANGELOG_SOURCE_BYTE_LIMIT / 2) + notes, version), /Source CHANGELOG exceeds/u);
});
