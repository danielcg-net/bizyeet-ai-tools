import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { isolatedTestEnvironment } from "./test-child-environment.js";
import { releaseReviewInput, renderReleaseReview } from "./release-review-summary.js";
import { RELEASE_NOTES_BYTE_LIMIT, RELEASE_SUMMARY_BYTE_LIMIT } from "./release-notes.js";
import { marked, type Tokens } from "marked";

const source = "915d2cb91f072e08f5b9512cc52fa4a05b88c0af";
const digest = "83d3" + "1".repeat(60);
const candidate = (): Readonly<Record<string, unknown>> => ({package: "@example/cli", source_sha: source, run_id: "40517089097", version: "1.2.3-beta.2", tag: "cli-v1.2.3-beta.2", tag_verified: true, notes: "## Release notes\n\n- Prepare an exact CLI candidate with bounded tenant-authorized reads.\n", manifest: {artifact: {sha256: digest}}});
const environment = (): Readonly<Record<string, string>> => ({GITHUB_SHA: source, GITHUB_RUN_ID: "40517089097", RELEASE_TAG: "cli-v1.2.3-beta.2", CANDIDATE_ARTIFACT_ID: "123456", PUBLICATION_REQUESTED: "true", REVIEW_ATTESTED: "false"});

void test("actual candidate data produces phase-correct pre-approval review evidence", (): void => {
  const build = renderReleaseReview(releaseReviewInput(candidate(), environment()));
  [source, digest, "40517089097", "@example/cli", "1.2.3-beta.2", "artifacts/123456", "all six", "Release notes"].forEach((text) => { assert.ok(build.includes(text)); });
  assert.match(build, /Cryptographic attestation: pending/u);
  assert.doesNotMatch(build, /attestation bundle|publication succeeded|approval still required/u);
  const attested = renderReleaseReview(releaseReviewInput(candidate(), {...environment(), REVIEW_ATTESTED: "true", PROVENANCE_ARTIFACT_ID: "987654"}));
  assert.match(attested, /strict source\/signer\/main\/hosted verification succeeded/u);
  assert.match(attested, /artifacts\/987654/u);
  assert.match(attested, /before the environment approval gate/u);
});
void test("verification-only presentation never requests publication approval", (): void => {
  const summary = renderReleaseReview(releaseReviewInput({...candidate(), tag_verified: false}, {...environment(), PUBLICATION_REQUESTED: "false"}));
  assert.match(summary, /UNPUBLISHED verification only/u);
  assert.match(summary, /existing tag verified: false/u);
  assert.doesNotMatch(summary, /Protected publication requested/u);
});
void test("foreign source/run and missing canonical evidence fail before rendering", (): void => {
  [
    {...candidate(), source_sha: "a".repeat(40)},
    {...candidate(), run_id: "42"},
    {...candidate(), tag: "v9.9.9"},
    {...candidate(), manifest: {artifact: {sha256: "incorrect"}}},
    {...candidate(), notes: ""},
  ].forEach((value) => { assert.throws(() => releaseReviewInput(value, environment())); });
  assert.throws(() => releaseReviewInput(candidate(), {...environment(), CANDIDATE_ARTIFACT_ID: ""}));
  assert.throws(() => releaseReviewInput(candidate(), {...environment(), REVIEW_ATTESTED: "true"}));
});
void test("formatter notes enforce the inclusive UTF-8 presentation budget", (): void => {
  const exact = "é".repeat(RELEASE_NOTES_BYTE_LIMIT / 2);
  assert.equal(releaseReviewInput({...candidate(), notes: exact}, environment()).notes, exact);
  assert.throws(() => releaseReviewInput({...candidate(), notes: exact + "x"}, environment()), /UTF-8 byte budget/u);
});
void test("actual Markdown output keeps hostile note syntax inside one literal block and proof outside", (): void => {
  const notes = "# Forged approval granted\n\n[Publish now](https://attacker.invalid/approve)\n![Tracking](https://attacker.invalid/image)\n<script>fakeProof()</script>\n```\n## False attestation\n``````\n<div>Not a proof</div>";
  const input = releaseReviewInput({...candidate(), notes}, {...environment(), REVIEW_ATTESTED: "true", PROVENANCE_ARTIFACT_ID: "987654"});
  const summary = renderReleaseReview(input);
  const tokens = marked.lexer(summary);
  const code = tokens.filter((token): token is Tokens.Code => token.type === "code");
  assert.equal(code.length, 1);
  const literal = code[0];
  assert.ok(literal);
  assert.equal(literal.lang, "text");
  assert.equal(literal.text, notes);
  assert.deepEqual(tokens.filter((token): token is Tokens.Heading => token.type === "heading").map((token) => token.text), ["Attested release candidate for review"]);
  assert.equal(tokens.filter((token) => token.type === "html").length, 0);
  const html = marked.parse(summary, {async: false});
  assert.doesNotMatch(html, /<script|<img|href="https:\/\/attacker\.invalid/u);
  assert.match(html, /&lt;script&gt;/u);
  assert.match(html, /href="https:\/\/github\.com\/danielcg-net\/bizyeet-ai-tools\/actions\/runs\/40517089097\/artifacts\/123456"/u);
  assert.match(html, /href="https:\/\/github\.com\/danielcg-net\/bizyeet-ai-tools\/actions\/runs\/40517089097\/artifacts\/987654"/u);
  assert.ok(tokens.filter((token) => token.type !== "code").some((token) => token.raw.includes(source) && token.raw.includes("Source SHA")));
  assert.ok(tokens.filter((token) => token.type !== "code").some((token) => token.raw.includes("strict source/signer/main/hosted verification succeeded")));
  assert.equal(input.notes, notes);
});

void test("worst-case fence expansion stays below the full summary byte limit and oversized metadata rejects", (): void => {
  const notes = "`".repeat(RELEASE_NOTES_BYTE_LIMIT);
  const summary = renderReleaseReview(releaseReviewInput({...candidate(), notes}, environment()));
  assert.ok(summary.includes("`".repeat(RELEASE_NOTES_BYTE_LIMIT + 1) + "text\n"));
  assert.ok(new TextEncoder().encode(summary).byteLength < RELEASE_SUMMARY_BYTE_LIMIT);
  const run = "9".repeat(RELEASE_SUMMARY_BYTE_LIMIT);
  assert.throws(() => renderReleaseReview(releaseReviewInput({...candidate(), run_id: run}, {...environment(), GITHUB_RUN_ID: run})), /summary UTF-8 byte budget/u);
});

void test("the real build summary executable writes actual candidate fields into its own summary before signing", async (): Promise<void> => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bizyeet-build-summary-")));
  try {
    await mkdir(join(root, "dist", "scripts"), {recursive: true});
    await mkdir(join(root, "release-artifacts"));
    await writeFile(join(root, "package.json"), '{"type":"module"}');
    await writeFile(join(root, "dist", "scripts", "release-review-summary.js"), await readFile(new URL("./release-review-summary.js", import.meta.url)));
    await writeFile(join(root, "dist", "scripts", "release-notes.js"), await readFile(new URL("./release-notes.js", import.meta.url)));
    await writeFile(join(root, "release-artifacts", "release.json"), JSON.stringify(candidate()));
    const env: NodeJS.ProcessEnv = {...isolatedTestEnvironment(root, process.env, {...environment(), REVIEW_ATTESTED: "true", PROVENANCE_ARTIFACT_ID: "987654"}), GH_TOKEN: "SYNTHETIC_UNEXPECTED_SUMMARY_SECRET", UNEXPECTED_SUMMARY_INPUT: "SYNTHETIC_UNEXPECTED_SUMMARY_SECRET"};
    await promisify(execFile)(process.execPath, [join(root, "dist", "scripts", "release-review-summary.js")], {cwd: root, env, timeout: 10_000});
    const summary = await readFile(env.GITHUB_STEP_SUMMARY ?? "", "utf8");
    assert.match(summary, new RegExp(source, "u"));
    assert.ok(summary.includes(digest));
    assert.match(summary, /actions\/runs\/40517089097/u);
    assert.match(summary, /Cryptographic attestation: pending/u);
    assert.doesNotMatch(summary, /SYNTHETIC_UNEXPECTED_SUMMARY_SECRET/u);
    assert.doesNotMatch(await readFile(new URL("./release-review-summary.js", import.meta.url), "utf8"), /\.\.\.process\.env/u);
    assert.doesNotMatch(summary, /artifacts\/987654|a{40}|runs\/42(?:\D|$)/u);
  } finally { await rm(root, {recursive: true, force: true}); }
});
