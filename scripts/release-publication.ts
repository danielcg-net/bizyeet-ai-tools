import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { releaseCandidateErrors } from "./release-candidate.js";

type RecordValue = Readonly<Record<string, unknown>>;
const record = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);
const execute = promisify(execFile);

/** Validate maintainer-attested identity; actual provider protection is checked separately. */
export const readinessErrors = (value: unknown, version: string): readonly string[] => {
  if (!record(value)) return ["Missing reviewed nonsecret release-readiness record."];
  const maintainer = record(value.maintainer) ? value.maintainer : {};
  const publisher = record(maintainer.publisher) ? maintainer.publisher : {};
  const configured = typeof publisher.trust_configured_at === "string" ? Date.parse(publisher.trust_configured_at) : NaN;
  return [
    ...(value.schema_version === 1 && value.repository === "danielcg-net/bizyeet-ai-tools" && value.package === "@bizyeet/ai-tools" && value.workflow === "release.yml" && value.environment === "npm-release" && value.version === version && value.tag === `v${version}` ? [] : ["Readiness identity differs from reviewed candidate."]),
    ...(publisher.direct_publish_allowed === true && typeof publisher.first_publish_succeeded === "boolean" && Number.isFinite(configured) && configured <= Date.now() && (publisher.first_publish_succeeded || Date.now() - configured <= 172_800_000) ? [] : ["Direct publication and active or unexpired initial OIDC trust must be attested."]),
    ...(typeof maintainer.login === "string" && /^[A-Za-z0-9-]+$/u.test(maintainer.login) ? [] : ["Maintainer identity is required."]),
    ...([maintainer.ownership_evidence_url, maintainer.publisher_evidence_url].every((url) => typeof url === "string" && /^https:\/\/\S+$/u.test(url)) ? [] : ["Reviewed ownership/bootstrap and exact OIDC binding evidence is required."]),
    ...(typeof maintainer.prevent_self_review === "boolean" && Array.isArray(maintainer.reviewer_ids) && maintainer.reviewer_ids.length > 0 && maintainer.reviewer_ids.every((id: unknown) => Number.isSafeInteger(id) && Number(id) > 0) ? [] : ["Record exact human reviewer IDs and chosen self-review policy."]),
    ...(typeof maintainer.confirmed_at === "string" && Number.isFinite(Date.parse(maintainer.confirmed_at)) && Date.parse(maintainer.confirmed_at) <= Date.now() ? [] : ["Record maintainer confirmation time."]),
  ];
};

/** Add source-bound release metadata to the existing canonical, fully verified bundle. */
export const preparePublicationBundle = async (root: string, tag: string): Promise<void> => {
  const [metadataText, lockfileText, changelog, manifestText, readinessText] = await Promise.all([
    readFile(`${root}/package.json`, "utf8"), readFile(`${root}/package-lock.json`, "utf8"), readFile(`${root}/CHANGELOG.md`, "utf8"),
    readFile(`${root}/release-artifacts/build-manifest.json`, "utf8"), readFile(`${root}/scripts/release-readiness.json`, "utf8").catch((error: unknown): string => { if (record(error) && error.code === "ENOENT" && process.env.PUBLICATION_REQUESTED === "false") return "null"; throw error; }),
  ]);
  const metadata: unknown = JSON.parse(metadataText);
  const manifest: unknown = JSON.parse(manifestText);
  const readiness: unknown = JSON.parse(readinessText);
  if (!record(metadata) || typeof metadata.version !== "string" || !record(manifest) || !record(manifest.source) || !record(manifest.verification)) throw new Error("Invalid canonical build manifest.");
  const errors = [...releaseCandidateErrors({ metadata, lockfile: JSON.parse(lockfileText) as unknown, changelog, tag }), ...(process.env.PUBLICATION_REQUESTED === "false" ? [] : readinessErrors(readiness, metadata.version))];
  if (errors.length > 0) throw new Error(errors.join("\n"));
  const sha = (await execute("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  if (sha !== process.env.GITHUB_SHA || manifest.source.commit !== sha || manifest.source.dirty !== false || manifest.verification.installed_version !== metadata.version) throw new Error("Source or installed version differs from the dispatch candidate.");
  const section = changelog.split(/^## /mu).find((entry) => entry.startsWith(`[${metadata.version as string}] - `));
  if (!section) throw new Error("Missing reviewed release notes.");
  const release = { schema_version: 1, package: metadata.name, version: metadata.version, tag, channel: "beta", source_sha: sha, workflow: "release.yml", tag_verified: process.env.PUBLICATION_REQUESTED === "true", run_id: process.env.GITHUB_RUN_ID, run_attempt: process.env.GITHUB_RUN_ATTEMPT, readiness, manifest, notes: `## ${section.trim()}\n` };
  const text = JSON.stringify(release, null, 2) + "\n";
  await writeFile(`${root}/release-artifacts/release.json`, text, { flag: "wx" });
  const sums = await readFile(`${root}/release-artifacts/SHA256SUMS`, "utf8");
  await writeFile(`${root}/release-artifacts/SHA256SUMS`, `${sums}${createHash("sha256").update(text).digest("hex")}  release.json\n`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tag = process.argv[3];
  if (process.argv.length !== 4 || process.argv[2] !== "--tag" || !tag) throw new Error("Usage: release-publication --tag vVERSION");
  await preparePublicationBundle(fileURLToPath(new URL("../../", import.meta.url)), tag);
}
