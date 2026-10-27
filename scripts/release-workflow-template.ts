import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument, stringify } from "yaml";
import { releaseReviewInput, renderReleaseReview } from "./release-review-summary.js";

// Single authoring source for reviewed inline code. Privileged jobs never load
// this file or repository code; the generated workflow contains static copies.
export const sourceAndCandidateScript = String.raw`const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const repo = 'danielcg-net/bizyeet-ai-tools';
const [owner, name] = repo.split('/');
const get = async (route, parameters = {}) => (await github.request('GET ' + route, { owner, repo: name, ...parameters })).data;
const fail = message => { throw new Error(message); };
if (context.repo.owner + '/' + context.repo.repo !== repo || context.eventName !== 'workflow_dispatch' || context.ref !== 'refs/heads/main' || !/^[a-f0-9]{40}$/.test(context.sha)) fail('Untrusted dispatch source');
const branch = await get('/repos/{owner}/{repo}/branches/main');
if (!branch.protected) fail('main must be protected');
const comparison = await get('/repos/{owner}/{repo}/compare/{basehead}', { basehead: context.sha + '...main' });
if (!['identical', 'ahead'].includes(comparison.status)) fail('Dispatch SHA is not merged main history');
const tag = process.env.RELEASE_TAG;
if (!/^v\d+\.\d+\.\d+-beta\.[1-9][0-9]*$/.test(tag)) fail('Only numbered beta tags are supported');
if (process.env.PUBLICATION_REQUESTED === 'true') {
const ref = await get('/repos/{owner}/{repo}/git/ref/tags/{tag}', { tag });
const target = ref.object.type === 'tag' ? (await get('/repos/{owner}/{repo}/git/tags/{tag_sha}', { tag_sha: ref.object.sha })).object : ref.object;
if (target.type !== 'commit' || target.sha !== context.sha) fail('Existing immutable tag differs from dispatch SHA');
}
const content = async path => {
  const response = await get('/repos/{owner}/{repo}/contents/{path}', { path, ref: context.sha });
  if (response.type !== 'file' || response.encoding !== 'base64') fail('Expected source file');
  return JSON.parse(Buffer.from(response.content, 'base64').toString('utf8'));
};
const metadata = await content('package.json');
if (metadata.name !== '@bizyeet/ai-tools' || 'v' + metadata.version !== tag || metadata.private !== false || metadata.publishConfig?.registry !== 'https://registry.npmjs.org' || metadata.publishConfig?.access !== 'public' || metadata.publishConfig?.tag !== 'beta' || metadata.repository?.url !== 'git+https://github.com/danielcg-net/bizyeet-ai-tools.git') fail('Reviewed metadata identity differs');
if (process.env.PUBLICATION_REQUESTED === 'true') {
  const ready = await content('scripts/release-readiness.json');
  const maintainer = ready.maintainer;
  const publisher = maintainer?.publisher;
  const configured = Date.parse(publisher?.trust_configured_at);
  if (publisher?.direct_publish_allowed !== true || typeof publisher.first_publish_succeeded !== 'boolean' || !Number.isFinite(configured) || configured > Date.now() || Date.parse(maintainer.confirmed_at) > Date.now()) fail('Publisher attestation identity/configuration is invalid');
  if (ready.schema_version !== 1 || ready.repository !== repo || ready.package !== metadata.name || ready.version !== metadata.version || ready.tag !== tag || ready.workflow !== 'release.yml' || ready.environment !== 'npm-release' || !/^[A-Za-z0-9-]+$/.test(maintainer?.login ?? '') || ![maintainer.ownership_evidence_url, maintainer.publisher_evidence_url].every(url => typeof url === 'string' && /^https:\/\/\S+$/.test(url)) || !Number.isFinite(Date.parse(maintainer.confirmed_at)) || typeof maintainer.prevent_self_review !== 'boolean' || !Array.isArray(maintainer.reviewer_ids) || maintainer.reviewer_ids.length === 0 || !maintainer.reviewer_ids.every(id => Number.isSafeInteger(id) && id > 0) || new Set(maintainer.reviewer_ids).size !== maintainer.reviewer_ids.length) fail('Missing reviewed maintainer ownership/OIDC configuration attestation');
  const environment = await get('/repos/{owner}/{repo}/environments/npm-release');
  const policies = await get('/repos/{owner}/{repo}/environments/npm-release/deployment-branch-policies', { per_page: 100 });
  const rules = environment.protection_rules.filter(rule => rule.type === 'required_reviewers');
  const reviewers = rules[0]?.reviewers ?? [];
  const ids = reviewers.filter(entry => entry.type === 'User' && entry.reviewer?.type === 'User').map(entry => entry.reviewer.id);
  if (environment.name !== 'npm-release' || environment.can_admins_bypass !== false || rules.length !== 1 || reviewers.length !== ids.length || ids.length === 0 || new Set(ids).size !== ids.length || JSON.stringify(ids.toSorted()) !== JSON.stringify(maintainer.reviewer_ids.toSorted()) || rules[0].prevent_self_review !== maintainer.prevent_self_review || environment.deployment_branch_policy?.protected_branches !== false || environment.deployment_branch_policy?.custom_branch_policies !== true || policies.total_count !== 1 || policies.branch_policies.length !== 1 || policies.branch_policies[0].name !== 'main' || policies.branch_policies[0].type !== 'branch') fail('Protected human environment policy differs or is unverifiable');
}
if (process.env.BUNDLE_REQUIRED === 'true') {
  const files = await fs.readdir('bundle', { withFileTypes: true });
  const tarball = 'bizyeet-ai-tools-' + metadata.version + '.tgz';
  const expected = [tarball, 'sbom.cdx.json', 'build-manifest.json', 'release.json', 'SHA256SUMS'];
  if (files.length !== expected.length || files.some(entry => !entry.isFile() || !expected.includes(entry.name))) fail('Unexpected bundle file or symlink');
  if ((await Promise.all(files.map(entry => fs.lstat('bundle/' + entry.name)))).some(entry => entry.size > 20971520)) fail('Oversized candidate evidence');
  const release = JSON.parse(await fs.readFile('bundle/release.json', 'utf8'));
  const manifest = JSON.parse(await fs.readFile('bundle/build-manifest.json', 'utf8'));
  const sbom = JSON.parse(await fs.readFile('bundle/sbom.cdx.json', 'utf8'));
  if (release.source_sha !== context.sha || release.run_id !== String(context.runId) || release.tag !== tag || release.version !== metadata.version || release.channel !== 'beta' || release.workflow !== 'release.yml' || release.package !== metadata.name || JSON.stringify(release.manifest) !== JSON.stringify(manifest) || manifest.source?.commit !== context.sha || manifest.source?.dirty !== false || manifest.source?.repository !== 'https://github.com/' + repo || manifest.artifact?.filename !== tarball || manifest.verification?.installed_version !== metadata.version || manifest.verification?.installed_help !== true || !manifest.runtime?.npm || !manifest.lockfile_sha256 || typeof release.notes !== 'string' || release.notes.length < 50 || sbom.bomFormat !== 'CycloneDX') fail('Bundle identity or verification evidence differs');
  const sums = (await fs.readFile('bundle/SHA256SUMS', 'utf8')).trimEnd().split('\n');
  if (sums.length !== 4 || new Set(sums.map(line => line.slice(66))).size !== 4) fail('Checksum file is incomplete');
  await Promise.all(sums.map(async (line, index) => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    if (!match || !expected.includes(match[2]) || match[2] === 'SHA256SUMS') fail('Invalid checksum entry #' + String(index + 1));
    const hash = crypto.createHash('sha256').update(await fs.readFile('bundle/' + match[2])).digest('hex');
    if (hash !== match[1] || (match[2] === tarball && hash !== manifest.artifact.sha256)) fail('Artifact digest differs: ' + match[2]);
  }));
  const lock = await get('/repos/{owner}/{repo}/contents/package-lock.json', { ref: context.sha });
  if (crypto.createHash('sha256').update(Buffer.from(lock.content, 'base64')).digest('hex') !== manifest.lockfile_sha256) fail('Lockfile digest differs');
  if (process.env.PUBLICATION_REQUESTED === 'true' && (release.tag_verified !== true || JSON.stringify(release.readiness) !== JSON.stringify(await content('scripts/release-readiness.json')))) fail('Readiness attestation differs');
  core.setOutput('tarball', tarball);
  core.setOutput('version', metadata.version);
  core.setOutput('digest', manifest.artifact.sha256);
  await fs.writeFile('release-notes.md', release.notes, { flag: 'wx' });


}
core.setOutput('version', metadata.version);
`;

export const registryScript = String.raw`const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const release = JSON.parse(await fs.readFile('bundle/release.json', 'utf8'));
const fail = message => { throw new Error(message); };
const get = async url => {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (![200, 404].includes(response.status)) fail('Registry authentication/network/service error: ' + response.status);
  return response;
};
const readJson = async response => {
  const reader = response.body?.getReader();
  if (!reader) fail('Missing registry body');
  const drain = async (size, chunks) => {
    const next = await reader.read();
    if (next.done) return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const total = size + next.value.byteLength;
    if (chunks.length >= 1024) { await reader.cancel(); fail('Overly fragmented registry JSON'); }
    if (total > 4194304) { await reader.cancel(); fail('Oversized registry JSON'); }
    return drain(total, [...chunks, Buffer.from(next.value)]);
  };
  return drain(0, []);
};
const hashArchive = async response => {
  const reader = response.body?.getReader();
  if (!reader) fail('Missing archive body');
  const sha256 = crypto.createHash('sha256');
  const sha512 = crypto.createHash('sha512');
  const drain = async (size, chunks) => {
    const next = await reader.read();
    if (next.done) return {sha256: sha256.digest('hex'), integrity: 'sha512-' + sha512.digest('base64')};
    const total = size + next.value.byteLength;
    if (chunks >= 4096) { await reader.cancel(); fail('Overly fragmented published archive'); }
    if (total > 20971520) { await reader.cancel(); fail('Oversized published archive'); }
    sha256.update(next.value); sha512.update(next.value);
    return drain(total, chunks + 1);
  };
  return drain(0, 0);
};
const response = await get('https://registry.npmjs.org/@bizyeet%2fai-tools');
if (response.status === 404) fail('Package ownership/bootstrap is not established; do not publish a placeholder');
const packument = await readJson(response);
const record = value => typeof value === 'object' && value !== null && !Array.isArray(value);
if (!record(packument) || !record(packument.versions) || !record(packument['dist-tags']) || packument.name !== '@bizyeet/ai-tools' || !packument.versions || !packument['dist-tags']) fail('Malformed registry package');
const priorRelease = await github.rest.repos.getReleaseByTag({owner:'danielcg-net',repo:'bizyeet-ai-tools',tag:release.tag}).then(response => response.data).catch(error => { if (error.status === 404) return null; throw error; });
if (priorRelease && (priorRelease.tag_name !== release.tag || priorRelease.body !== release.notes || priorRelease.prerelease !== true)) fail('Existing GitHub release differs; stop before npm publication');
if (process.env.EXPECTED_BETA !== undefined && (packument['dist-tags'].beta ?? '') !== process.env.EXPECTED_BETA) fail('Concurrent beta mapping changed before publication');
if (process.env.EXPECTED_LATEST !== undefined && (packument['dist-tags'].latest ?? '') !== process.env.EXPECTED_LATEST) fail('Concurrent latest mapping changed; no automatic repair');
core.setOutput('latest-before', packument['dist-tags'].latest ?? '');
core.setOutput('beta-before', packument['dist-tags'].beta ?? '');
if (!Object.values(packument['dist-tags']).every(value => typeof value === 'string' && value.length <= 128)) fail('Malformed registry channel values');
if (Object.hasOwn(packument.versions, release.version) && !record(packument.versions[release.version])) fail('Malformed registry version entry');
const existing = packument.versions[release.version];
if (!existing && priorRelease) fail('Existing GitHub release without matching npm publication');
if (!existing) {
  const publisher = release.readiness?.maintainer?.publisher;
  const configured = Date.parse(publisher?.trust_configured_at);
  if (publisher?.direct_publish_allowed !== true || typeof publisher.first_publish_succeeded !== 'boolean' || !Number.isFinite(configured) || configured > Date.now() || (!publisher.first_publish_succeeded && Date.now() - configured > 172800000)) fail('Initial publisher trust window expired or is unverifiable; new publication forbidden');
  if (Number(process.env.GITHUB_RUN_ATTEMPT ?? '1') > 1) fail('Previous run attempt has no reconciled publication; fresh reviewed run required, never blindly retry');
  if (process.env.REQUIRE_PUBLISHED === 'true') fail('Publish outcome is absent/ambiguous; reconcile before retry');
  core.setOutput('exists', 'false');
  core.setOutput('beta-before', packument['dist-tags'].beta ?? '');
} else {
  if (packument['dist-tags'].beta !== release.version) fail('Concurrent beta-channel change; maintainer reconciliation required');
  const dist = existing.dist;
  if (existing.name !== release.package || existing.version !== release.version || dist?.tarball !== 'https://registry.npmjs.org/@bizyeet/ai-tools/-/ai-tools-' + release.version + '.tgz' || typeof dist.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+=*$/.test(dist.integrity) || typeof dist.attestations?.url !== 'string' || !['https://registry.npmjs.org/-/npm/v1/attestations/@bizyeet%2fai-tools@' + release.version, 'https://registry.npmjs.org/-/npm/v1/attestations/@bizyeet%2Fai-tools@' + release.version].includes(dist.attestations.url)) fail('Registry metadata/provenance identity differs');
  const archive = await get(dist.tarball);
  if (archive.status !== 200) fail('Published bytes unavailable');
  const bytes = await hashArchive(archive);
  if (bytes.sha256 !== release.manifest.artifact.sha256 || bytes.integrity !== dist.integrity) fail('Published bytes/integrity differ');
  const attestations = await get(dist.attestations.url);
  if (attestations.status !== 200) fail('npm provenance unavailable');
  const evidence = await readJson(attestations);
  const entries = evidence.attestations?.filter(entry => entry.predicateType === 'https://slsa.dev/provenance/v1');
  if (entries?.length !== 1 || !entries[0].bundle) fail('npm provenance bundle missing or ambiguous');
  const provenanceText = JSON.stringify(entries[0].bundle);
  await fs.writeFile('npm-provenance.json', provenanceText, { flag: 'wx' }).catch(async error => {
    if (error.code !== 'EEXIST' || await fs.readFile('npm-provenance.json', 'utf8') !== provenanceText) throw error;
  });
  core.setOutput('exists', 'true');
}
`;

export const githubReleaseScript = String.raw`const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const release = JSON.parse(await fs.readFile('bundle/release.json', 'utf8'));
const [owner, repo] = ['danielcg-net', 'bizyeet-ai-tools'];
const fail = message => { throw new Error(message); };
const assets = (await fs.readdir('bundle')).map(name => ({ name, path: 'bundle/' + name })).concat([{name:'provenance.sigstore.json',path:'signed/provenance.sigstore.json'}, {name:'npm-provenance.json',path:'npm-provenance.json'}]);
const existing = await github.rest.repos.getReleaseByTag({ owner, repo, tag: release.tag }).then(response => response.data).catch(async error => {
  if (error.status !== 404) throw error;
  const releases = (await github.rest.repos.listReleases({owner, repo, per_page: 100})).data.filter(entry => entry.tag_name === release.tag);
  if (releases.length > 1) fail('Ambiguous existing drafts; stop for maintainer reconciliation');
  return releases[0] ?? null;
});
if (existing && (existing.tag_name !== release.tag || existing.body !== release.notes || !existing.prerelease || existing.assets.some(asset => !assets.some(expected => expected.name === asset.name)))) fail('Existing release differs; no overwrite');
if (existing) {
  await Promise.all(existing.assets.map(async current => {
    const asset = assets.find(entry => entry.name === current.name);
    const digest = 'sha256:' + crypto.createHash('sha256').update(await fs.readFile(asset.path)).digest('hex');
    if (current.digest !== digest) fail('Existing release asset digest differs');
  }));
  if (!existing.draft && existing.assets.length !== assets.length) fail('Published release is incomplete; do not change assets');
}
if (existing && !existing.draft) {
  core.notice('Verified already complete matching release; platform immutable=' + String(existing.immutable));
} else {
  const draft = existing ?? (await github.rest.repos.createRelease({owner,repo,tag_name:release.tag,target_commitish:context.sha,name:release.tag,body:release.notes,draft:true,prerelease:true,make_latest:'false'})).data;
  await assets.filter(asset => !draft.assets.some(current => current.name === asset.name)).reduce(async (previous, asset) => {
    await previous;
    const data = await fs.readFile(asset.path);
    await github.rest.repos.uploadReleaseAsset({owner,repo,release_id:draft.id,name:asset.name,data,headers:{'content-type':'application/octet-stream','content-length':data.length}});
  }, Promise.resolve());
  const completed = (await github.rest.repos.getRelease({owner,repo,release_id:draft.id})).data;
  if (completed.assets.length !== assets.length) fail('Draft asset upload is incomplete; leave draft for same-run reconciliation');
  await Promise.all(assets.map(async asset => {
    const current = completed.assets.find(entry => entry.name === asset.name);
    const digest = 'sha256:' + crypto.createHash('sha256').update(await fs.readFile(asset.path)).digest('hex');
    if (!current || current.digest !== digest) fail('Uploaded release asset differs; leave draft and stop');
  }));
  const published = (await github.rest.repos.updateRelease({owner,repo,release_id:draft.id,draft:false,prerelease:true,make_latest:'false'})).data;
  core.notice('Published matching prerelease; platform immutable=' + String(published.immutable));
}
`;

export const releaseReviewScript = `const fs = require('node:fs/promises');
const readReview = ${releaseReviewInput.toString().replaceAll("\r\n", "\n")};
const renderReview = ${renderReleaseReview.toString().replaceAll("\r\n", "\n")};
if (!process.env.GITHUB_STEP_SUMMARY) throw new Error('Missing workflow summary destination');
const release = JSON.parse(await fs.readFile('bundle/release.json', 'utf8'));
const review = readReview(release, {
  PUBLICATION_REQUESTED: process.env.PUBLICATION_REQUESTED,
  RELEASE_TAG: process.env.RELEASE_TAG,
  CANDIDATE_ARTIFACT_ID: process.env.CANDIDATE_ARTIFACT_ID,
  PROVENANCE_ARTIFACT_ID: process.env.PROVENANCE_ARTIFACT_ID,
  GITHUB_SHA: context.sha,
  GITHUB_RUN_ID: String(context.runId),
  REVIEW_ATTESTED: "true"
});
await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, renderReview(review));`;

const templates: Readonly<Record<string, string>> = {"Present attested candidate before approval":releaseReviewScript,"Revalidate exact source, tag, policy and candidate":sourceAndCandidateScript,"Reconcile registry before any publish":registryScript,"Recheck captured registry mapping immediately before publication":registryScript,"Verify registry bytes, beta mapping and retrieve npm provenance":registryScript,"Create immutable matching prerelease or verify complete outcome":githubReleaseScript};

type Mapping = Readonly<Record<string, unknown>>;
const record = (value: unknown): value is Mapping => typeof value === "object" && value !== null && !Array.isArray(value);
const templateFor = (step: unknown): string | undefined => record(step) && typeof step.name === "string" ? templates[step.name] : undefined;
/** Fail drift checks without regenerating or trusting modified workflow code. */
export const releaseTemplateErrors = (workflow: Mapping): readonly string[] => {
  const jobs = record(workflow.jobs) ? workflow.jobs : {};
  const steps = Object.values(jobs).flatMap((job) => record(job) && Array.isArray(job.steps) ? job.steps as readonly unknown[] : []);
  return Object.entries(templates).flatMap(([name, expected]) => {
    const copies = steps.filter((step) => record(step) && step.name === name);
    return copies.length > 0 && copies.every((step) => record(step) && record(step.with) && step.with.script === expected) ? [] : [`release.yml: inline template drift (${name})`];
  });
};
/** Explicit authoring helper; never called automatically by npm run check. */
export const renderReleaseWorkflow = (source: string): string => {
  const workflow: unknown = parseDocument(source).toJS({maxAliasCount: 0});
  if (!record(workflow) || !record(workflow.jobs)) throw new Error("Invalid release workflow.");
  const jobs = Object.fromEntries(Object.entries(workflow.jobs).map(([name, job]) => {
    if (!record(job) || !Array.isArray(job.steps)) throw new Error("Invalid release job.");
    const steps = (job.steps as readonly unknown[]).map((step) => {
      const script = templateFor(step);
      return script && record(step) && record(step.with) ? {...step, with: {...step.with, script}} : step;
    });
    return [name, {...job, steps}];
  }));
  return stringify(JSON.parse(JSON.stringify({...workflow, jobs})) as unknown, {lineWidth: 0});
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = new URL("../../.github/workflows/release.yml", import.meta.url);
  const source = await readFile(path, "utf8");
  if (process.argv[2] === "--write" && process.argv.length === 3) await writeFile(path, renderReleaseWorkflow(source));
  else throw new Error("Usage: node dist/scripts/release-workflow-template.js --write (explicit authoring only)");
}
