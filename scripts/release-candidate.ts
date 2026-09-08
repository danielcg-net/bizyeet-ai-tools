import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const record = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);
const numeric = /^(0|[1-9][0-9]*)$/u;

/** Accept SemVer release/prerelease versions; release tags deliberately exclude build metadata. */
export const releaseVersion = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 128) return false;
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?$/u.exec(value);
  if (!match || value === "0.0.0" || value === "0.0.0-development") return false;
  return match[4] === undefined || match[4].split(".").every((part) => part.length > 0 && (!/^[0-9]+$/u.test(part) || numeric.test(part)));
};

const changelogReady = (changelog: string, version: string): boolean => {
  const sections = changelog.split(/^## /mu).slice(1);
  const entries = sections.filter((section) => section.startsWith(`[${version}] - `));
  const entry = entries[0];
  if (entries.length !== 1 || entry === undefined) return false;
  const [heading = "", ...body] = entry.split(/\r?\n/u);
  const date = heading.slice(`[${version}] - `.length);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return false;
  return body.some((line) => /^- \S.{9,}$/u.test(line)) && !body.some((line) => /\b(TODO|TBD|placeholder)\b/iu.test(line));
};

/** Validate release metadata only; this is not approval, provenance or permission to publish. */
export const releaseCandidateErrors = (input: Readonly<{ metadata: unknown; lockfile: unknown; changelog: string; tag: string }>): readonly string[] => {
  const metadata = record(input.metadata) ? input.metadata : {};
  const lockfile = record(input.lockfile) ? input.lockfile : {};
  const packages = record(lockfile.packages) ? lockfile.packages : {};
  const root = record(packages[""]) ? packages[""] : {};
  const version = metadata.version;
  const valid = releaseVersion(version);
  return [
    ...(metadata.name === "@bizyeet/ai-tools" ? [] : ["Unexpected package name."]),
    ...(valid ? [] : ["Select a non-development SemVer version without build metadata."]),
    ...(valid && input.tag === `v${version}` ? [] : ["Release tag must exactly match v plus the package version."]),
    ...(metadata.private === false ? [] : ["Publication must be explicitly enabled by a reviewed package change."]),
    ...(record(metadata.publishConfig) && metadata.publishConfig.access === "public" ? [] : ["Public package access must be explicit."]),
    ...(lockfile.lockfileVersion === 3 && lockfile.name === metadata.name && lockfile.version === version && root.name === metadata.name && root.version === version ? [] : ["Package and lockfile root identity/version must agree."]),
    ...(valid && changelogReady(input.changelog, version) ? [] : ["Provide one dated changelog section with substantive release notes and no placeholders."]),
  ];
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tag = process.argv[3];
  if (process.argv.length !== 4 || process.argv[2] !== "--tag" || tag === undefined) throw new Error("Usage: npm run release:preflight -- --tag vVERSION");
  const root = new URL("../../", import.meta.url);
  const [metadata, lockfile, changelog] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("package-lock.json", root), "utf8"),
    readFile(new URL("CHANGELOG.md", root), "utf8"),
  ]);
  const errors = releaseCandidateErrors({ metadata: JSON.parse(metadata) as unknown, lockfile: JSON.parse(lockfile) as unknown, changelog, tag });
  if (errors.length > 0) throw new Error(errors.join("\n"));
  console.log("Release metadata passed. Protected approval, trusted build, provenance and publication checks remain required.");
}
