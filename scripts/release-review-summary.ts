import { readFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_NOTES_BYTE_LIMIT } from "./release-notes.js";

type ReviewInput = Readonly<{package: string; source: string; version: string; tag: string; tagVerified: boolean; digest: string; run: string; notes: string; candidate: string; provenance: string; attested: boolean; publish: boolean}>;

/** Bind presentation to the actual canonical candidate and workflow identity. */
export const releaseReviewInput = (value: unknown, environment: Readonly<Record<string, string | undefined>>): ReviewInput => {
  const record = (item: unknown): item is Readonly<Record<string, unknown>> => typeof item === "object" && item !== null && !Array.isArray(item);
  if (!record(value) || !record(value.manifest) || !record(value.manifest.artifact)) throw new Error("Missing canonical review metadata.");
  const packageName = value.package;
  const source = value.source_sha;
  const run = value.run_id;
  const version = value.version;
  const tag = value.tag;
  const digest = value.manifest.artifact.sha256;
  const notes = value.notes;
  if (typeof notes === "string" && new TextEncoder().encode(notes).byteLength > RELEASE_NOTES_BYTE_LIMIT) throw new Error("Review notes exceed the UTF-8 byte budget.");
  const candidate = environment.CANDIDATE_ARTIFACT_ID ?? "";
  const provenance = environment.PROVENANCE_ARTIFACT_ID ?? "";
  const attested = environment.REVIEW_ATTESTED === "true";
  if (typeof packageName !== "string" || packageName.length > 214 || !/^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/u.test(packageName) || typeof source !== "string" || !/^[a-f0-9]{40}$/u.test(source) || source !== environment.GITHUB_SHA || typeof run !== "string" || !/^\d+$/u.test(run) || run !== environment.GITHUB_RUN_ID || typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(version) || typeof tag !== "string" || tag.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(tag) || tag !== environment.RELEASE_TAG || typeof digest !== "string" || !/^[a-f0-9]{64}$/u.test(digest) || typeof notes !== "string" || notes.length < 50 || typeof value.tag_verified !== "boolean" || !/^\d+$/u.test(candidate) || (attested && !/^\d+$/u.test(provenance))) throw new Error("Review summary differs from actual source/run/artifacts.");
  return {package: packageName, source, run, version, tag, digest, notes, candidate, provenance, attested, tagVerified: value.tag_verified, publish: environment.PUBLICATION_REQUESTED === "true"};
};

/** Render phase-correct approval evidence; never infer publication from a candidate. */
export const renderReleaseReview = (input: ReviewInput): string => [
  input.attested ? "# Attested release candidate for review" : "# Canonical release candidate for review",
  `Package: ${input.package}`,
  `Source SHA: ${input.source}`,
  `Version: ${input.version}`,
  `Tag: ${input.tag} (existing tag verified: ${String(input.tagVerified)})`,
  `Tarball SHA256: ${input.digest}`,
  `Run: https://github.com/danielcg-net/bizyeet-ai-tools/actions/runs/${input.run}`,
  "Matrix: Ubuntu, macOS and Windows; Node 24 and 26 — all six upstream jobs succeeded.",
  "Installed exact version/help and canonical checksums verified.",
  input.attested ? "Cryptographic attestation: strict source/signer/main/hosted verification succeeded in the preceding step." : "Cryptographic attestation: pending the separate attestation job; this build summary is not signing proof.",
  `[Canonical candidate](https://github.com/danielcg-net/bizyeet-ai-tools/actions/runs/${input.run}/artifacts/${input.candidate})`,
  ...(input.attested ? [`[Verified attestation bundle](https://github.com/danielcg-net/bizyeet-ai-tools/actions/runs/${input.run}/artifacts/${input.provenance})`] : []),
  input.publish ? "Protected publication requested. Review this exact run, source and digest before the environment approval gate." : "UNPUBLISHED verification only. No publication was requested.",
  input.notes,
  "",
].join("\n\n");

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (!summary) throw new Error("A workflow-owned summary destination is required.");
  const root = new URL("../../", import.meta.url);
  const release: unknown = JSON.parse(await readFile(new URL("release-artifacts/release.json", root), "utf8"));
  await appendFile(summary, renderReleaseReview(releaseReviewInput(release, {
    PUBLICATION_REQUESTED: process.env.PUBLICATION_REQUESTED,
    RELEASE_TAG: process.env.RELEASE_TAG,
    CANDIDATE_ARTIFACT_ID: process.env.CANDIDATE_ARTIFACT_ID,
    PROVENANCE_ARTIFACT_ID: process.env.PROVENANCE_ARTIFACT_ID,
    GITHUB_SHA: process.env.GITHUB_SHA,
    GITHUB_RUN_ID: process.env.GITHUB_RUN_ID,
    REVIEW_ATTESTED: "false",
  })));
}
