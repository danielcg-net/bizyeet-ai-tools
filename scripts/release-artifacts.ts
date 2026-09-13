import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const record = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Reject unexpected pack output and path traversal before opening its artifact. */
export const packedFileName = (value: unknown): string => {
  if (!Array.isArray(value) || value.length !== 1) throw new Error("Expected exactly one package artifact.");
  const item: unknown = value[0];
  if (!record(item) || typeof item.filename !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/u.test(item.filename)) throw new Error("Invalid package artifact filename.");
  return item.filename;
};

/** Require an actual CycloneDX document rather than storing arbitrary command output. */
export const validateSbom = (value: unknown): void => {
  if (!record(value) || value.bomFormat !== "CycloneDX" || typeof value.specVersion !== "string" || !record(value.metadata) || !record(value.metadata.component)) throw new Error("Invalid CycloneDX SBOM.");
};

/** Resolve the declared installed command, rejecting missing or escaping bin mappings. */
export const declaredBinTarget = (metadata: unknown, packageRoot: string): string => {
  if (!record(metadata) || metadata.name !== "@bizyeet/ai-tools" || !record(metadata.bin) || typeof metadata.bin.bizyeet !== "string" || !/^[A-Za-z0-9._/-]+\.js$/u.test(metadata.bin.bizyeet) || isAbsolute(metadata.bin.bizyeet)) throw new Error("Invalid installed bizyeet command mapping.");
  const target = resolve(packageRoot, metadata.bin.bizyeet);
  const path = relative(packageRoot, target);
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error("Installed command escapes its package.");
  return target;
};

const hashFile = async (path: string): Promise<string> => {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
};

const npm = async (args: readonly string[], cwd: string): Promise<string> => {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error("Run artifact verification through npm run release:verify.");
  const execution = execute(process.execPath, [cli, ...args], { cwd, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  // Keep the complete test failure visible; Node's inspection of a rejected
  // execFile promise truncates its stdout property before late test failures.
  if (args[0] === "run" && args[1] === "check") {
    execution.child.stdout?.pipe(process.stdout);
    execution.child.stderr?.pipe(process.stderr);
  }
  return (await execution).stdout;
};

/** Remove only generated build output before running the supplied fresh-build gate. */
export const rebuildForRelease = async (root: string, build: () => Promise<unknown>): Promise<void> => {
  await rm(join(root, "dist"), { recursive: true, force: true });
  await build();
};

/** Build a non-published bundle and smoke-test its installed binary outside the source tree. */
export const buildArtifactBundle = async (root: string, output: string): Promise<string> => {
  // Never overwrite a prior verification bundle, including through a symlink.
  await mkdir(output, { mode: 0o700 });
  const metadata: unknown = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (!record(metadata) || metadata.name !== "@bizyeet/ai-tools" || typeof metadata.version !== "string") throw new Error("Invalid release package.");
  // This process has loaded its verifier already. Rebuild all generated output
  // before tests/packing so ignored files from older revisions cannot survive.
  await rebuildForRelease(root, (): Promise<string> => npm(["run", "check"], root));
  const packed: unknown = JSON.parse(await npm(["pack", "--json", "--ignore-scripts", "--pack-destination", output], root));
  const filename = packedFileName(packed);
  const archive = join(output, filename);
  const sbom = await npm(["sbom", "--sbom-format=cyclonedx", "--omit=dev"], root);
  const document: unknown = JSON.parse(sbom);
  validateSbom(document);
  await writeFile(join(output, "sbom.cdx.json"), sbom, { flag: "wx", mode: 0o600 });
  const installed = await mkdtemp(join(tmpdir(), "bizyeet-artifact-smoke-"));
  try {
    await npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", archive], installed);
    const packageRoot = join(installed, "node_modules", "@bizyeet", "ai-tools");
    const installedMetadata: unknown = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    await access(declaredBinTarget(installedMetadata, packageRoot));
    await access(join(installed, "node_modules", ".bin", process.platform === "win32" ? "bizyeet.cmd" : "bizyeet"));
    const help = await npm(["exec", "--offline", "--no", "--", "bizyeet", "--help"], installed);
    if (!help.includes("OAuth")) throw new Error("Installed CLI help smoke check failed.");
  } finally {
    await rm(installed, { recursive: true, force: true });
  }
  const commit = (await execute("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  const dirty = (await execute("git", ["status", "--porcelain"], { cwd: root })).stdout.length > 0;
  const manifest = {
    schema_version: 1, package: "@bizyeet/ai-tools", version: metadata.version,
    source: { repository: "https://github.com/danielcg-net/bizyeet-ai-tools", commit, dirty },
    runtime: { node: process.versions.node, platform: process.platform, architecture: process.arch },
    artifact: { filename, sha256: await hashFile(archive) },
    lockfile_sha256: await hashFile(join(root, "package-lock.json")),
    verification: { installed_help: true, published: false, attested: false },
  };
  await writeFile(join(output, "build-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  const checksums = await Promise.all([filename, "sbom.cdx.json", "build-manifest.json"].map(async (name): Promise<string> => `${await hashFile(join(output, name))}  ${name}`));
  await writeFile(join(output, "SHA256SUMS"), checksums.join("\n") + "\n", { flag: "wx", mode: 0o600 });
  return output;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  console.log(await buildArtifactBundle(root, join(root, "release-artifacts")));
}
