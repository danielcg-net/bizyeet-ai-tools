import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parseDocument } from "yaml";
import { releaseReviewScript } from "./release-workflow-template.js";
import { isolatedTestEnvironment } from "./test-child-environment.js";

type Data = Readonly<Record<string, unknown>>;
type Step = Readonly<{ name: string; with?: Readonly<{script?: string}> }>;
const source = await readFile(new URL("../../.github/workflows/release-cli.yml", import.meta.url), "utf8");
const workflow = parseDocument(source).toJS() as Readonly<{jobs: Readonly<Record<string, Readonly<{steps: readonly Step[]}>>>}>;
const script = (job: string, name: string): string => {
  const value = workflow.jobs[job]?.steps.find((step) => step.name === name)?.with?.script;
  assert.equal(typeof value, "string");
  return value ?? "";
};
const execute = promisify(execFile);
const sha = "a".repeat(40);
const tag = "cli-v0.1.0-beta.1";
const tarball = "bizyeet-cli-0.1.0-beta.1.tgz";
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
const metadata = {name: "@bizyeet/cli", version: "0.1.0-beta.1", private: false, publishConfig: {registry: "https://registry.npmjs.org", access: "public", tag: "beta"}, repository: {url: "git+https://github.com/danielcg-net/bizyeet-ai-tools.git"}};
const notes = "## [0.1.0-beta.1] - 2026-10-27\n\n- Install and verify tenant-authorized read commands.\n";
const readiness = {schema_version: 1, repository: "danielcg-net/bizyeet-ai-tools", package: metadata.name, version: metadata.version, tag, workflow: "release-cli.yml", environment: "npm-release", maintainer: {login: "maintainer", ownership_evidence_url: "https://example.test/ownership", publisher_evidence_url: "https://example.test/oidc", confirmed_at: new Date().toISOString(), publisher: {direct_publish_allowed: true, trust_configured_at: new Date().toISOString(), first_publish_succeeded: false}, prevent_self_review: false, reviewer_ids: [123]}};
const environment = {name: "npm-release", can_admins_bypass: false, deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}, protection_rules: [{type: "required_reviewers", prevent_self_review: false, reviewers: [{type: "User", reviewer: {id: 123, type: "User"}}]}]};
const context = {repo: {owner: "danielcg-net", repo: "bizyeet-ai-tools"}, eventName: "workflow_dispatch", ref: "refs/heads/main", sha, runId: 42, runAttempt: 1};
const reviewSummary = releaseReviewScript;
const verification = script("attest", "Revalidate exact source, tag, policy and candidate");
const registry = script("publish", "Reconcile registry before any publish");
const githubRelease = script("github-release", "Create immutable matching prerelease or verify complete outcome");
const fixture = (overrides: Data = {}): Data => ({context, metadata, readiness, environment, policies: {total_count: 1, branch_policies: [{type: "branch", name: "main"}]}, tagSha: sha, lock: "lockfile", changelog: "# Changelog\n\n" + notes, ...overrides});

// Execute the ACTUAL reviewed inline workflow script in a subprocess with only
// local fixture APIs. No eval, network, npm, publication or credentials.
const harness = String.raw`
const fs = require('node:fs');
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const context = input.context;
const Date = {parse: globalThis.Date.parse, now: () => input.now ?? globalThis.Date.now()};
const state = {release: input.existingRelease};
const core = {setOutput: (key,value) => console.log(JSON.stringify({key,value})), notice: message => console.log(message)};
const github = {request: async (route, parameters) => {
  if (input.apiStatus) throw new Error('API ' + input.apiStatus);
  const data = route.endsWith('/branches/main') ? {protected: input.protected !== false}
    : route.includes('/compare/') ? {status:input.comparison ?? 'ahead'}
    : route.includes('/git/ref/') ? {object:{type:'commit',sha:input.tagSha}}
    : route.includes('/contents/') ? (() => {
      const path = parameters.path ?? 'package-lock.json';
      if (path === 'CHANGELOG.md' && parameters.ref !== context.sha) throw new Error('CHANGELOG must use the exact source SHA');
      if (path === 'CHANGELOG.md' && input.changelogResponse) return input.changelogResponse;
      const content = path === 'package.json' ? input.metadata : path === 'scripts/release-readiness.json' ? input.readiness : path === 'CHANGELOG.md' ? input.changelog : input.lock;
      if (content == null) throw new Error('missing source file');
      const bytes = Buffer.from(typeof content === 'string' ? content : JSON.stringify(content));
      return {type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')};
    })()
    : route.endsWith('/deployment-branch-policies') ? input.policies
    : route.endsWith('/environments/npm-release') ? input.environment
    : (() => {throw new Error('unexpected API ' + route)})();
  return {data};
},rest:{repos:{
  getReleaseByTag: async () => {if (!input.existingRelease || input.hideDraft) {const error = new Error('not found'); error.status=404; throw error;} return {data:input.existingRelease};},
  listReleases: async () => ({data: input.existingRelease ? [input.existingRelease] : []}),
  getRelease: async () => ({data:state.release}),
  createRelease: async parameters => {if (!input.allowMutations) throw new Error('MUTATION createRelease'); console.log('mutation:create'); state.release={...parameters,id:1,assets:[]}; return {data:state.release};},
  uploadReleaseAsset: async parameters => {if (!input.allowMutations) throw new Error('MUTATION uploadReleaseAsset'); console.log('mutation:upload:' + parameters.name); state.release={...state.release,assets:[...state.release.assets,{name:parameters.name,digest:'sha256:'+require('node:crypto').createHash('sha256').update(parameters.data).digest('hex')}]}; return {data:{}};},
  updateRelease: async parameters => {if (!input.allowMutations) throw new Error('MUTATION updateRelease'); console.log('mutation:finalize'); state.release={...state.release,...parameters}; return {data:state.release};}
}}};
const fetch = async url => {
  const response = input.responses?.[url];
  if (!response) throw new Error('network fixture unavailable: ' + url);
  if (response.error) throw new Error(response.error);
  return new Response(response.chunks ? new ReadableStream({start: controller => {Array.from({length:response.chunks}, () => Uint8Array.of(32)).forEach(chunk => controller.enqueue(chunk));controller.close();}}) : typeof response.body === 'string' ? response.body : JSON.stringify(response.body), {status:response.status});
};
`;
const runInline = async (code: string, input: Data, files: Readonly<Record<string, string>> = {}, env: Readonly<Record<string, string>> = {}, options: Readonly<{inherited?: NodeJS.ProcessEnv; inspect?: (root: string, environment: NodeJS.ProcessEnv) => Promise<void>}> = {}): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "bizyeet-release-inline-"));
  try {
    await mkdir(join(root, "bundle"));
    await mkdir(join(root, "signed"));
    await Promise.all(Object.entries(files).map(async ([name, content]): Promise<void> => { await writeFile(join(root, name), content); }));
    await writeFile(join(root, "fixture.json"), JSON.stringify(input));
    await writeFile(join(root, "inline.cjs"), `${harness}\nasync function main(require){\n${code}\n}\nmain(input.rejectStats ? id => {const loaded=require(id); return id === "node:fs/promises" ? {...loaded,lstat:async()=>{throw new Error("STAT SHOULD NOT RUN");}} : loaded;} : require).catch(error=>{console.error(error.message);process.exitCode=1;});\n`);
    const environment = isolatedTestEnvironment(root, options.inherited ?? process.env, {RELEASE_TAG: tag, PUBLICATION_REQUESTED: "true", BUNDLE_REQUIRED: "false", GITHUB_RUN_ATTEMPT: "1", ...env});
    const result = await execute(process.execPath, [join(root, "inline.cjs"), join(root, "fixture.json")], {cwd: root, env: environment, timeout: 10_000});
    await options.inspect?.(root, environment);
    return result.stdout;
  } finally { await rm(root, {recursive: true, force: true}); }
};
const bundleFiles = (candidateReadiness: unknown = readiness, candidateNotes = notes): Readonly<Record<string, string>> => {
  const manifest = {source: {repository: "https://github.com/danielcg-net/bizyeet-ai-tools", commit: sha, dirty: false}, artifact: {filename: tarball, sha256: hash("package bytes")}, verification: {installed_version: metadata.version, installed_help: true}, runtime: {npm: "11.19.1"}, lockfile_sha256: hash("lockfile")};
  const release = {package: metadata.name, version: metadata.version, source_sha: sha, run_id: "42", tag, tag_verified: true, channel: "beta", workflow: "release-cli.yml", readiness: candidateReadiness, manifest, notes: candidateNotes};
  const files = {[tarball]: "package bytes", "build-manifest.json": JSON.stringify(manifest), "sbom.cdx.json": JSON.stringify({bomFormat: "CycloneDX"}), "release.json": JSON.stringify(release)};
  return {...Object.fromEntries(Object.entries(files).map(([name, text]) => [`bundle/${name}`, text])), "bundle/SHA256SUMS": Object.entries(files).map(([name,text]) => `${hash(text)}  ${name}\n`).join("")};
};

void test("actual CLI gate rejects legacy package, tag, workflow and setup substitution", async (): Promise<void> => {
  await assert.rejects(runInline(verification, fixture({metadata: {...metadata, name: "@bizyeet/ai-tools"}})), /metadata identity/u);
  await assert.rejects(runInline(verification, fixture(), {}, {RELEASE_TAG: "v0.1.0-beta.1"}), /numbered beta tags/u);
  await assert.rejects(runInline(verification, fixture(), {}, {RELEASE_TAG: "mcp-v0.1.0-beta.1"}), /numbered beta tags/u);
  await assert.rejects(runInline(verification, fixture({readiness: null})), /missing source file/u);
  await assert.rejects(runInline(verification, fixture({readiness: {...readiness, package: "@bizyeet/ai-tools", workflow: "release.yml"}})), /configuration attestation/u);
  await [{package: "@bizyeet/ai-tools"}, {workflow: "release.yml"}, {tag: "mcp-v0.1.0-beta.1"}].reduce(async (previous, identity): Promise<void> => {
    await previous;
    const files = bundleFiles();
    const release = {...JSON.parse(files["bundle/release.json"] ?? "") as Data, ...identity};
    const rewritten = {...Object.fromEntries(Object.entries(files).filter(([path]) => path !== "bundle/SHA256SUMS")), "bundle/release.json": JSON.stringify(release)};
    const consistent = {...rewritten, "bundle/SHA256SUMS": Object.entries(rewritten).map(([path, text]) => `${hash(text)}  ${path.slice("bundle/".length)}\n`).join("")};
    await assert.rejects(runInline(verification, fixture(), consistent, {BUNDLE_REQUIRED: "true"}), /Bundle identity/u);
  }, Promise.resolve());
});

void test("actual inline source gate permits default unpublished candidate without tag/setup and rejects hostile dispatch", async (): Promise<void> => {
  await runInline(verification, fixture({readiness: null, environment: null, tagSha: null}), {}, {PUBLICATION_REQUESTED: "false"});
  await assert.rejects(runInline(verification, fixture({tagSha: "b".repeat(40)})), /tag differs/u);
  await assert.rejects(runInline(verification, fixture({readiness: null})), /missing source file/u);
  await assert.rejects(runInline(verification, fixture({environment: {...environment, can_admins_bypass: true}})), /human environment policy/u);
  await runInline(verification, fixture({now: Date.now() + 259_200_000}));
  await assert.rejects(runInline(verification, fixture({readiness: {...readiness, maintainer: {...readiness.maintainer, confirmed_at: "2999-01-01T00:00:00Z"}}})), /Publisher attestation/u);
  await assert.rejects(runInline(verification, fixture({environment: {...environment, protection_rules: [{type: "required_reviewers", prevent_self_review: false, reviewers: [{type: "Team", reviewer: {id: 123, type: "Team"}}]}]}})), /human environment policy/u);
  await assert.rejects(runInline(verification, fixture({policies: {total_count: 1, branch_policies: [{name: "*", type: "branch"}]}})), /human environment policy/u);
  await assert.rejects(runInline(verification, fixture({readiness: {...readiness, maintainer: {...readiness.maintainer, reviewer_ids: [123, 123]}}})), /attestation/u);
  await assert.rejects(runInline(verification, fixture({protected: false})), /main must be protected/u);
  await assert.rejects(runInline(verification, fixture({comparison: "diverged"})), /not merged main history/u);
  await assert.rejects(runInline(verification, fixture({context: {...context, eventName: "pull_request"}})), /Untrusted dispatch/u);
  await assert.rejects(runInline(verification, fixture({apiStatus: 403})), /API 403/u);
});

void test("actual inline bundle gate accepts exact trusted bundle and rejects tampering, missing evidence and cross-run substitution", async (): Promise<void> => {
  const files = bundleFiles();
  await runInline(verification, fixture(), files, {BUNDLE_REQUIRED: "true"});
  await assert.rejects(runInline(verification, fixture(), {...files, [`bundle/${tarball}`]: "altered"}, {BUNDLE_REQUIRED: "true"}), /digest differs: bizyeet-cli/u);
  await assert.rejects(runInline(verification, fixture({rejectStats: true}), {...files, "bundle/extra.js": "malicious"}, {BUNDLE_REQUIRED: "true"}), /Unexpected bundle/u);
  await assert.rejects(runInline(verification, fixture({context: {...context, runId: 43}}), files, {BUNDLE_REQUIRED: "true"}), /identity or verification/u);
  await assert.rejects(runInline(verification, fixture({lock: "other lock"}), files, {BUNDLE_REQUIRED: "true"}), /Lockfile digest/u);
  await assert.rejects(runInline(verification, fixture(), {...files, "bundle/SHA256SUMS": ""}, {BUNDLE_REQUIRED: "true"}), /Checksum file/u);
});

void test("actual inline verifier binds canonical tarball bytes to manifest digest and source package version", async (): Promise<void> => {
  const rewrite = (changes: Readonly<{digest?: string; version?: string; installedVersion?: string}>): Readonly<Record<string, string>> => {
    const files = bundleFiles();
    const original = JSON.parse(files["bundle/build-manifest.json"] ?? "") as Readonly<{artifact: Data; verification: Data}> & Data;
    const manifest = {...original, artifact: {...original.artifact, ...(changes.digest ? {sha256: changes.digest} : {})}, verification: {...original.verification, ...(changes.installedVersion ? {installed_version: changes.installedVersion} : {})}};
    const release = {...JSON.parse(files["bundle/release.json"] ?? "") as Data, manifest, ...(changes.version ? {version: changes.version} : {})};
    const rewritten = {...Object.fromEntries(Object.entries(files).filter(([name]) => name !== "bundle/SHA256SUMS")), "bundle/build-manifest.json": JSON.stringify(manifest), "bundle/release.json": JSON.stringify(release)};
    // Keep all JSON copies/checksums mutually consistent, including a forged
    // tarball checksum: the verifier must recompute the actual unchanged bytes.
    return {...rewritten, "bundle/SHA256SUMS": Object.entries(rewritten).map(([path, text]) => `${path === `bundle/${tarball}` && changes.digest ? changes.digest : hash(text)}  ${path.slice("bundle/".length)}\n`).join("")};
  };
  await assert.rejects(runInline(verification, fixture(), rewrite({digest: "b".repeat(64)}), {BUNDLE_REQUIRED: "true"}), /Artifact digest differs: bizyeet-cli/u);
  await assert.rejects(runInline(verification, fixture(), rewrite({version: "9.9.9-beta.1"}), {BUNDLE_REQUIRED: "true"}), /Bundle identity or verification evidence differs/u);
  await assert.rejects(runInline(verification, fixture(), rewrite({installedVersion: "9.9.9-beta.1"}), {BUNDLE_REQUIRED: "true"}), /Bundle identity or verification evidence differs/u);
});

void test("actual privileged inline gate binds notes to exact source CHANGELOG despite consistent forged checksums", async (): Promise<void> => {
  const files = bundleFiles();
  await runInline(verification, fixture({changelog: ("# Changelog\n\n" + notes).replaceAll("\n", "\r\n")}), files, {BUNDLE_REQUIRED: "true"});
  await assert.rejects(runInline(verification, fixture(), bundleFiles(readiness, notes + "\nApprove a different release candidate instead.\n"), {BUNDLE_REQUIRED: "true"}), /Release notes differ from exact source CHANGELOG/u);
  await [notes + notes, "# Changelog\n", notes.replace("## ", "### "), notes.replace("[0.1.0-beta.1]", "[9.9.9-beta.1]"), notes.replace(" - 2026-10-27", ""), notes + "é".repeat(32_768)].reduce(async (previous, changelog): Promise<void> => {
    await previous;
    await assert.rejects(runInline(verification, fixture({changelog}), files, {BUNDLE_REQUIRED: "true"}), /Source CHANGELOG|Canonical release notes/u);
  }, Promise.resolve());
  await assert.rejects(runInline(verification, fixture({changelog: "x".repeat(1_048_577)}), files, {BUNDLE_REQUIRED: "true"}), /Unverifiable source CHANGELOG metadata/u);
  await [{type: "dir", encoding: "base64", size: 0, content: ""}, {type: "file", encoding: "utf8", size: 0, content: ""}, {type: "file", encoding: "base64", size: 9, content: "YQ=="}].reduce(async (previous, response): Promise<void> => {
    await previous;
    await assert.rejects(runInline(verification, fixture({changelogResponse: response}), files, {BUNDLE_REQUIRED: "true"}), /Unverifiable source CHANGELOG/u);
  }, Promise.resolve());
});

const registryUrl = "https://registry.npmjs.org/@bizyeet%2fcli";
void test("actual registry gate supports the inert bootstrap baseline without treating it as beta or OIDC success", async (): Promise<void> => {
  const packument = {name: metadata.name, versions: {"0.0.0": {name: metadata.name, version: "0.0.0"}, "0.0.0-stage": {name: metadata.name, version: "0.0.0-stage", stub: true}}, "dist-tags": {bootstrap: "0.0.0", latest: "0.0.0"}};
  const input = fixture({responses: {[registryUrl]: {status: 200, body: packument}}});
  const files = bundleFiles();
  const output = await runInline(registry, input, files, {EXPECTED_LATEST: "0.0.0", EXPECTED_BETA: ""});
  assert.match(output, /"key":"exists","value":"false"/u);
  assert.match(output, /"key":"latest-before","value":"0\.0\.0"/u);
  assert.match(output, /"key":"beta-before","value":""/u);
  await assert.rejects(runInline(registry, input, files, {EXPECTED_LATEST: ""}), /Concurrent latest mapping/u);
  await assert.rejects(runInline(registry, {...input, now: Date.now() + 259_200_000}, files), /trust window expired/u);
});
void test("actual registry gate separates unused version from package bootstrap/auth/network and malformed failures", async (): Promise<void> => {
  const files = bundleFiles();
  const packument = {name: metadata.name, versions: {}, "dist-tags": {}};
  const output = await runInline(registry, fixture({responses: {[registryUrl]: {status: 200, body: packument}}}), files);
  assert.match(output, /"exists","value":"false"/u);
  await assert.rejects(runInline(registry, fixture({responses: {[registryUrl]: {status: 404, body: {}}}}), files), /bootstrap/u);
  await assert.rejects(runInline(registry, fixture({responses: {[registryUrl]: {status: 401, body: {}}}}), files), /authentication/u);
  await assert.rejects(runInline(registry, fixture({responses: {[registryUrl]: {status: 200, body: "malformed"}}}), files));
  await assert.rejects(runInline(registry, fixture(), files), /network fixture unavailable/u);
  await assert.rejects(runInline(registry, fixture({now: Date.now() + 259_200_000, responses: {[registryUrl]: {status: 200, body: packument}}}), files), /trust window expired/u);
  await assert.rejects(runInline(registry, fixture({responses: {[registryUrl]: {status: 200, body: {...packument, versions: "malformed"}}}}), files), /Malformed registry/u);
  await assert.rejects(runInline(registry, fixture({responses: {[registryUrl]: {status: 200, body: {...packument, versions: {[metadata.version]: null}}}}}), files), /Malformed registry version/u);
  await assert.rejects(runInline(registry, fixture({responses: {[registryUrl]: {status: 200, body: {...packument, "dist-tags": {latest: 123}}}}}), files), /Malformed registry channel/u);
  await assert.rejects(runInline(registry, fixture({responses: {[registryUrl]: {status: 200, body: "x".repeat(4_194_305)}}}), files), /Oversized registry JSON/u);
  await assert.rejects(runInline(registry, fixture({responses: {[registryUrl]: {status: 200, chunks: 1025}}}), files), /Overly fragmented registry JSON/u);
  await assert.rejects(runInline(registry, fixture({responses: {[registryUrl]: {status: 200, body: packument}}}), files, {GITHUB_RUN_ATTEMPT: "2"}), /never blindly retry/u);
  await assert.rejects(runInline(registry, fixture({responses: {[registryUrl]: {status: 200, body: packument}}}), files, {EXPECTED_BETA: "other"}), /Concurrent beta mapping/u);
  await assert.rejects(runInline(registry, fixture({responses: {[registryUrl]: {status: 200, body: packument}}}), files, {EXPECTED_LATEST: "other"}), /Concurrent latest mapping/u);
  await assert.rejects(runInline(registry, fixture({responses: {[registryUrl]: {status: 200, body: packument}}}), files, {REQUIRE_PUBLISHED: "true"}), /outcome is absent/u);
  await assert.rejects(runInline(registry, fixture({existingRelease: {body: "other",tag_name: tag,prerelease: true},responses: {[registryUrl]: {status: 200, body: packument}}}), files), /GitHub release differs/u);
});

void test("actual registry gate verifies published bytes and stops on concurrent channel, digest or provenance failures", async (): Promise<void> => {
  const files = bundleFiles();
  const archiveUrl = `https://registry.npmjs.org/@bizyeet/cli/-/cli-${metadata.version}.tgz`;
  const attestationsUrl = `https://registry.npmjs.org/-/npm/v1/attestations/@bizyeet%2fcli@${metadata.version}`;
  const dist = {tarball: archiveUrl, integrity: `sha512-${createHash("sha512").update("package bytes").digest("base64")}`, attestations: {url: attestationsUrl}};
  const packument = {name: metadata.name, versions: {[metadata.version]: {name: metadata.name, version: metadata.version, dist}}, "dist-tags": {beta: metadata.version}};
  const responses = {[registryUrl]: {status: 200, body: packument}, [archiveUrl]: {status: 200, body: "package bytes"}, [attestationsUrl]: {status: 200, body: {attestations: [{predicateType: "https://slsa.dev/provenance/v1", bundle: {fixture: true}}]}}};
  await runInline(verification, fixture({now: Date.now() + 259_200_000}), files, {BUNDLE_REQUIRED: "true"});
  assert.match(await runInline(registry, fixture({now: Date.now() + 259_200_000, responses}), files), /"exists","value":"true"/u);
  assert.match(await runInline(registry, fixture({responses}), files), /"exists","value":"true"/u);
  await assert.rejects(runInline(registry, fixture({responses: {...responses, [archiveUrl]: {status: 200, body: "altered"}}}), files), /bytes\/integrity differ/u);
  await assert.rejects(runInline(registry, fixture({responses: {...responses, [registryUrl]: {status: 200, body: {...packument, "dist-tags": {beta: "other"}}}}}), files), /Concurrent beta/u);
  await assert.rejects(runInline(registry, fixture({responses: {...responses, [attestationsUrl]: {status: 404, body: {}}}}), files), /provenance unavailable/u);
});

void test("actual release reconciliation accepts only matching complete assets and never mutates collisions", async (): Promise<void> => {
  const files: Readonly<Record<string, string>> = {...bundleFiles(), "signed/provenance.sigstore.json": "signed", "npm-provenance.json": "npm signed"};
  const release = JSON.parse(files["bundle/release.json"] ?? "") as Readonly<{notes: string}>;
  const assets = Object.entries(files).map(([name,text]) => ({name: name.split("/").at(-1), digest: `sha256:${hash(text)}`}));
  const existingRelease = {id: 1, tag_name: tag, body: release.notes, draft: false, prerelease: true, immutable: true, assets};
  assert.match(await runInline(githubRelease, fixture({existingRelease}), files), /already complete/u);
  await assert.rejects(runInline(githubRelease, fixture({existingRelease: {...existingRelease, body: "different"}}), files), /release differs/u);
  await assert.rejects(runInline(githubRelease, fixture({existingRelease: {...existingRelease, assets: assets.slice(1)}}), files), /release is incomplete/u);
  await assert.rejects(runInline(githubRelease, fixture({existingRelease: {...existingRelease, assets: [{name: tarball, digest: "wrong"}]}}), files), /digest differs/u);
  await assert.rejects(runInline(githubRelease, fixture({existingRelease: {...existingRelease, draft: true}}), files), /MUTATION/u);
  const resumed = await runInline(githubRelease, fixture({now: Date.now() + 259_200_000, allowMutations: true, hideDraft: true, existingRelease: {...existingRelease, draft: true, assets: assets.slice(1)}}), files);
  assert.match(resumed, /mutation:upload:bizyeet-cli/u);
  assert.match(resumed, /mutation:finalize/u);
  assert.doesNotMatch(resumed, /mutation:create/u);
  assert.equal(resumed.split("mutation:upload:").length, 2);
  await assert.rejects(runInline(githubRelease, fixture({existingRelease}), {...files, "bundle/release.json": (files["bundle/release.json"] ?? "").replace('"run_id":"42"', '"run_id":"43"')}), /digest differs/u);
});

void test("inline fixtures cannot modify parent Actions files or inherit credentials and executable injection", async (): Promise<void> => {
  const parent = await mkdtemp(join(tmpdir(), "bizyeet-parent-canaries-"));
  const keys = ["GITHUB_STEP_SUMMARY", "GITHUB_OUTPUT", "GITHUB_ENV", "GITHUB_PATH", "GITHUB_STATE"];
  const injected = {GH_TOKEN: "parent-secret", GITHUB_TOKEN: "parent-secret", NODE_AUTH_TOKEN: "parent-secret", NPM_TOKEN: "parent-secret", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "parent-secret", ACTIONS_RUNTIME_TOKEN: "parent-secret", NODE_OPTIONS: "--require=/must-not-execute", NODE_PATH: "/must-not-load", BASH_ENV: "/must-not-execute", AWS_SECRET_ACCESS_KEY: "parent-secret", AWS_SESSION_TOKEN: "parent-secret", AZURE_CLIENT_SECRET: "parent-secret", GH_ENTERPRISE_TOKEN: "parent-secret", GITLAB_TOKEN: "parent-secret", "npm_config_//registry.npmjs.org/:_authToken": "parent-secret"};
  try {
    const canaries = Object.fromEntries(keys.map((key) => [key, join(parent, key)]));
    const parentPowerShellCache = join(parent, "powershell-module-cache");
    await writeFile(parentPowerShellCache, "PARENT POWERSHELL CACHE");
    await Promise.all(Object.values(canaries).map(async (path): Promise<void> => { await writeFile(path, "PARENT CANARY"); }));
    const probe = `${reviewSummary}\nif (${JSON.stringify(Object.keys(injected))}.some(key => process.env[key] !== undefined) || process.env.PSModulePath !== undefined) throw new Error("Parent authority entered child");\nawait fs.appendFile(process.env.PSModuleAnalysisCachePath, 'private module cache');\nawait Promise.all(['GITHUB_OUTPUT','GITHUB_ENV','GITHUB_PATH','GITHUB_STATE'].map(key => fs.appendFile(process.env[key], 'private fixture command')));`;
    await runInline(probe, fixture(), bundleFiles(), {CANDIDATE_ARTIFACT_ID: "123", PROVENANCE_ARTIFACT_ID: "456", REVIEW_ATTESTED: "true"}, {
      inherited: {...process.env, ...canaries, ...injected, PSModulePath: "/must-not-load-parent-modules", PSModuleAnalysisCachePath: parentPowerShellCache},
      inspect: async (root, environment): Promise<void> => {
        Object.keys(injected).forEach((key) => { assert.equal(environment[key], undefined); });
        const summary = await readFile(environment.GITHUB_STEP_SUMMARY ?? "", "utf8");
        assert.match(summary, /Source SHA: a{40}/u);
        assert.match(summary, /actions\/runs\/42/u);
        assert.equal(environment.PSModulePath, undefined);
        assert.equal(environment.PSModuleAnalysisCachePath, join(root, "powershell-module-cache"));
        assert.equal(await readFile(environment.PSModuleAnalysisCachePath, "utf8"), "private module cache");
        assert.equal(await readFile(parentPowerShellCache, "utf8"), "PARENT POWERSHELL CACHE");
        await Promise.all(keys.map(async (key): Promise<void> => {
          assert.ok((environment[key] ?? "").startsWith(root));
          assert.equal(await readFile(canaries[key] ?? "", "utf8"), "PARENT CANARY");
          assert.ok((await readFile(environment[key] ?? "", "utf8")).length > 0);
        }));
      },
    });
  } finally { await rm(parent, {recursive: true, force: true}); }
});

void test("actual static summary passes only explicit presentation inputs and never renders unexpected environment canaries", async (): Promise<void> => {
  const allowed = ["PUBLICATION_REQUESTED", "RELEASE_TAG", "CANDIDATE_ARTIFACT_ID", "PROVENANCE_ARTIFACT_ID", "GITHUB_SHA", "GITHUB_RUN_ID", "REVIEW_ATTESTED"].sort();
  const call = "const review = readReview(release, ";
  assert.equal(reviewSummary.split(call).length, 2);
  const observed = reviewSummary.replace(call, "const review = ((value, inputs) => { if (JSON.stringify(Object.keys(inputs).sort()) !== JSON.stringify(input.expectedReviewKeys)) throw new Error('Unexpected formatter environment input'); return readReview(value, inputs); })(release, ");
  const canary = "SYNTHETIC_UNEXPECTED_SUMMARY_SECRET";
  await runInline(`process.env.GH_TOKEN = '${canary}'; process.env.UNEXPECTED_SUMMARY_INPUT = '${canary}';\n${observed}`, fixture({expectedReviewKeys: allowed}), bundleFiles(), {CANDIDATE_ARTIFACT_ID: "123", PROVENANCE_ARTIFACT_ID: "456", REVIEW_ATTESTED: "true"}, {
    inspect: async (_root, environment): Promise<void> => {
      const summary = await readFile(environment.GITHUB_STEP_SUMMARY ?? "", "utf8");
      assert.match(summary, /strict source\/signer\/main\/hosted verification succeeded/u);
      assert.ok(!summary.includes(canary));
    },
  });
});

void test("actual attested summary throws without exact successful phase-outcome proof", async (): Promise<void> => {
  const env = {CANDIDATE_ARTIFACT_ID: "123", PROVENANCE_ARTIFACT_ID: "456"};
  await assert.rejects(runInline(reviewSummary, fixture(), bundleFiles(), env), /phase proof is required/u);
  await ["false", "skipped", "failure", "cancelled", "True", "1"].reduce(async (previous, proof): Promise<void> => {
    await previous;
    await assert.rejects(runInline(reviewSummary, fixture(), bundleFiles(), {...env, REVIEW_ATTESTED: proof}), /phase proof is required/u);
  }, Promise.resolve());
  await runInline(reviewSummary, fixture(), bundleFiles(), {...env, REVIEW_ATTESTED: "true"});
});
