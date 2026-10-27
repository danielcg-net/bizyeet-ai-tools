import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parseDocument } from "yaml";

type Data = Readonly<Record<string, unknown>>;
type Step = Readonly<{ name: string; with?: Readonly<{script?: string}> }>;
const source = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
const workflow = parseDocument(source).toJS() as Readonly<{jobs: Readonly<Record<string, Readonly<{steps: readonly Step[]}>>>}>;
const script = (job: string, name: string): string => {
  const value = workflow.jobs[job]?.steps.find((step) => step.name === name)?.with?.script;
  assert.equal(typeof value, "string");
  return value ?? "";
};
const execute = promisify(execFile);
const sha = "a".repeat(40);
const tag = "v0.1.0-beta.1";
const tarball = "bizyeet-ai-tools-0.1.0-beta.1.tgz";
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
const metadata = {name: "@bizyeet/ai-tools", version: "0.1.0-beta.1", private: false, publishConfig: {registry: "https://registry.npmjs.org", access: "public", tag: "beta"}, repository: {url: "git+https://github.com/danielcg-net/bizyeet-ai-tools.git"}};
const readiness = {schema_version: 1, repository: "danielcg-net/bizyeet-ai-tools", package: metadata.name, version: metadata.version, tag, workflow: "release.yml", environment: "npm-release", maintainer: {login: "maintainer", ownership_evidence_url: "https://example.test/ownership", publisher_evidence_url: "https://example.test/oidc", confirmed_at: new Date().toISOString(), publisher: {direct_publish_allowed: true, trust_configured_at: new Date().toISOString(), first_publish_succeeded: false}, prevent_self_review: false, reviewer_ids: [123]}};
const environment = {name: "npm-release", can_admins_bypass: false, deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}, protection_rules: [{type: "required_reviewers", prevent_self_review: false, reviewers: [{type: "User", reviewer: {id: 123, type: "User"}}]}]};
const context = {repo: {owner: "danielcg-net", repo: "bizyeet-ai-tools"}, eventName: "workflow_dispatch", ref: "refs/heads/main", sha, runId: 42, runAttempt: 1};
const verification = script("attest", "Revalidate exact source, tag, policy and candidate");
const registry = script("publish", "Reconcile registry before any publish");
const githubRelease = script("github-release", "Create immutable matching prerelease or verify complete outcome");
const fixture = (overrides: Data = {}): Data => ({context, metadata, readiness, environment, policies: {total_count: 1, branch_policies: [{type: "branch", name: "main"}]}, tagSha: sha, lock: "lockfile", ...overrides});

// Execute the ACTUAL reviewed inline workflow script in a subprocess with only
// local fixture APIs. No eval, network, npm, publication or credentials.
const harness = String.raw`
const fs = require('node:fs');
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const context = input.context;
const state = {release: input.existingRelease};
const core = {setOutput: (key,value) => console.log(JSON.stringify({key,value})), notice: message => console.log(message)};
const github = {request: async (route, parameters) => {
  if (input.apiStatus) throw new Error('API ' + input.apiStatus);
  const data = route.endsWith('/branches/main') ? {protected: input.protected !== false}
    : route.includes('/compare/') ? {status:input.comparison ?? 'ahead'}
    : route.includes('/git/ref/') ? {object:{type:'commit',sha:input.tagSha}}
    : route.includes('/contents/') ? (() => {
      const path = parameters.path ?? 'package-lock.json';
      const content = path === 'package.json' ? input.metadata : path === 'scripts/release-readiness.json' ? input.readiness : input.lock;
      if (content == null) throw new Error('missing source file');
      return {type:'file',encoding:'base64',content:Buffer.from(typeof content === 'string' ? content : JSON.stringify(content)).toString('base64')};
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
const runInline = async (code: string, input: Data, files: Readonly<Record<string, string>> = {}, env: Readonly<Record<string, string>> = {}): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "bizyeet-release-inline-"));
  try {
    await mkdir(join(root, "bundle"));
    await mkdir(join(root, "signed"));
    await Promise.all(Object.entries(files).map(async ([name, content]): Promise<void> => { await writeFile(join(root, name), content); }));
    await writeFile(join(root, "fixture.json"), JSON.stringify(input));
    await writeFile(join(root, "inline.cjs"), `${harness}\nasync function main(){\n${code}\n}\nmain().catch(error=>{console.error(error.message);process.exitCode=1;});\n`);
    return (await execute(process.execPath, [join(root, "inline.cjs"), join(root, "fixture.json")], {cwd: root, env: {...process.env, RELEASE_TAG: tag, PUBLICATION_REQUESTED: "true", BUNDLE_REQUIRED: "false", GITHUB_RUN_ATTEMPT: "1", ...env}, timeout: 10_000})).stdout;
  } finally { await rm(root, {recursive: true, force: true}); }
};
const bundleFiles = (): Readonly<Record<string, string>> => {
  const manifest = {source: {repository: "https://github.com/danielcg-net/bizyeet-ai-tools", commit: sha, dirty: false}, artifact: {filename: tarball, sha256: hash("package bytes")}, verification: {installed_version: metadata.version, installed_help: true}, runtime: {npm: "11.19.1"}, lockfile_sha256: hash("lockfile")};
  const release = {package: metadata.name, version: metadata.version, source_sha: sha, run_id: "42", tag, tag_verified: true, channel: "beta", workflow: "release.yml", readiness, manifest, notes: "## [0.1.0-beta.1] - 2026-10-27\n\n- Install and verify tenant-authorized read commands.\n"};
  const files = {[tarball]: "package bytes", "build-manifest.json": JSON.stringify(manifest), "sbom.cdx.json": JSON.stringify({bomFormat: "CycloneDX"}), "release.json": JSON.stringify(release)};
  return {...Object.fromEntries(Object.entries(files).map(([name, text]) => [`bundle/${name}`, text])), "bundle/SHA256SUMS": Object.entries(files).map(([name,text]) => `${hash(text)}  ${name}\n`).join("")};
};

void test("actual inline source gate permits default unpublished candidate without tag/setup and rejects hostile dispatch", async (): Promise<void> => {
  await runInline(verification, fixture({readiness: null, environment: null, tagSha: null}), {}, {PUBLICATION_REQUESTED: "false"});
  await assert.rejects(runInline(verification, fixture({tagSha: "b".repeat(40)})), /tag differs/u);
  await assert.rejects(runInline(verification, fixture({readiness: null})), /missing source file/u);
  await assert.rejects(runInline(verification, fixture({environment: {...environment, can_admins_bypass: true}})), /human environment policy/u);
  await assert.rejects(runInline(verification, fixture({readiness: {...readiness, maintainer: {...readiness.maintainer, publisher: {...readiness.maintainer.publisher, trust_configured_at: "2020-01-01T00:00:00Z"}}}})), /trust window expired/u);
  await assert.rejects(runInline(verification, fixture({readiness: {...readiness, maintainer: {...readiness.maintainer, confirmed_at: "2999-01-01T00:00:00Z"}}})), /trust window expired/u);
  await assert.rejects(runInline(verification, fixture({environment: {...environment, protection_rules: [{type: "required_reviewers", prevent_self_review: false, reviewers: [{type: "Team", reviewer: {id: 123, type: "Team"}}]}]}})), /human environment policy/u);
  await assert.rejects(runInline(verification, fixture({policies: {total_count: 1, branch_policies: [{name: "*", type: "branch"}]}})), /human environment policy/u);
  await assert.rejects(runInline(verification, fixture({protected: false})), /main must be protected/u);
  await assert.rejects(runInline(verification, fixture({comparison: "diverged"})), /not merged main history/u);
  await assert.rejects(runInline(verification, fixture({context: {...context, eventName: "pull_request"}})), /Untrusted dispatch/u);
  await assert.rejects(runInline(verification, fixture({apiStatus: 403})), /API 403/u);
});

void test("actual inline bundle gate accepts exact trusted bundle and rejects tampering, missing evidence and cross-run substitution", async (): Promise<void> => {
  const files = bundleFiles();
  await runInline(verification, fixture(), files, {BUNDLE_REQUIRED: "true"});
  await assert.rejects(runInline(verification, fixture(), {...files, [`bundle/${tarball}`]: "altered"}, {BUNDLE_REQUIRED: "true"}), /digest differs/u);
  await assert.rejects(runInline(verification, fixture(), {...files, "bundle/extra.js": "malicious"}, {BUNDLE_REQUIRED: "true"}), /Unexpected bundle/u);
  await assert.rejects(runInline(verification, fixture({context: {...context, runId: 43}}), files, {BUNDLE_REQUIRED: "true"}), /identity or verification/u);
  await assert.rejects(runInline(verification, fixture({lock: "other lock"}), files, {BUNDLE_REQUIRED: "true"}), /Lockfile digest/u);
  await assert.rejects(runInline(verification, fixture(), {...files, "bundle/SHA256SUMS": ""}, {BUNDLE_REQUIRED: "true"}), /Checksum file/u);
});

const registryUrl = "https://registry.npmjs.org/@bizyeet%2fai-tools";
void test("actual registry gate separates unused version from package bootstrap/auth/network and malformed failures", async (): Promise<void> => {
  const files = bundleFiles();
  const packument = {name: metadata.name, versions: {}, "dist-tags": {}};
  const output = await runInline(registry, fixture({responses: {[registryUrl]: {status: 200, body: packument}}}), files);
  assert.match(output, /"exists","value":"false"/u);
  await assert.rejects(runInline(registry, fixture({responses: {[registryUrl]: {status: 404, body: {}}}}), files), /bootstrap/u);
  await assert.rejects(runInline(registry, fixture({responses: {[registryUrl]: {status: 401, body: {}}}}), files), /authentication/u);
  await assert.rejects(runInline(registry, fixture({responses: {[registryUrl]: {status: 200, body: "malformed"}}}), files));
  await assert.rejects(runInline(registry, fixture(), files), /network fixture unavailable/u);
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
  const archiveUrl = `https://registry.npmjs.org/@bizyeet/ai-tools/-/ai-tools-${metadata.version}.tgz`;
  const attestationsUrl = `https://registry.npmjs.org/-/npm/v1/attestations/@bizyeet%2fai-tools@${metadata.version}`;
  const dist = {tarball: archiveUrl, integrity: `sha512-${createHash("sha512").update("package bytes").digest("base64")}`, attestations: {url: attestationsUrl}};
  const packument = {name: metadata.name, versions: {[metadata.version]: {name: metadata.name, version: metadata.version, dist}}, "dist-tags": {beta: metadata.version}};
  const responses = {[registryUrl]: {status: 200, body: packument}, [archiveUrl]: {status: 200, body: "package bytes"}, [attestationsUrl]: {status: 200, body: {attestations: [{predicateType: "https://slsa.dev/provenance/v1", bundle: {fixture: true}}]}}};
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
  const resumed = await runInline(githubRelease, fixture({allowMutations: true, hideDraft: true, existingRelease: {...existingRelease, draft: true, assets: assets.slice(1)}}), files);
  assert.match(resumed, /mutation:upload:bizyeet-ai-tools/u);
  assert.match(resumed, /mutation:finalize/u);
  assert.doesNotMatch(resumed, /mutation:create/u);
  assert.equal(resumed.split("mutation:upload:").length, 2);
  await assert.rejects(runInline(githubRelease, fixture({existingRelease}), {...files, "bundle/release.json": (files["bundle/release.json"] ?? "").replace('"run_id":"42"', '"run_id":"43"')}), /digest differs/u);
});
