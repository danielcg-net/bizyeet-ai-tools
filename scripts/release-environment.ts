import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Actor = Readonly<{ id: number; login: string }>;
type Response = Readonly<{ status: number; data: unknown }>;
type Request = Readonly<{ method: "GET" | "PUT" | "POST"; path: string; body?: unknown }>;
type Github = (request: Request) => Promise<Response>;
type Gate = Readonly<{ id: number; main: boolean }>;
type Snapshot = Readonly<{ actor: Actor; gate: Gate | null }>;
type Plan = Readonly<{ action: "create" | "resume" | "unchanged"; reviewer: Actor; environment_id: number | null }>;
const repository = "danielcg-net/bizyeet-ai-tools";
const root = `repos/${repository}`;
const environment = `${root}/environments/npm-release`;
const policies = `${environment}/deployment-branch-policies`;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const fail = (message: string): never => { throw new Error(message); };
const ok = (response: Response, status = 200): unknown => response.status === status ? response.data : fail(`GitHub returned HTTP ${String(response.status)}; stop and inspect before retrying.`);

const actorFrom = (value: unknown): Actor => {
  if (!record(value) || value.type !== "User" || !positiveId(value.id) || typeof value.login !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(value.login)) return fail("Expected an authenticated human GitHub User with a valid ID/login.");
  return { id: value.id, login: value.login };
};

const gateFrom = (value: unknown, actor: Actor): number => {
  if (!record(value) || !positiveId(value.id) || value.name !== "npm-release" || value.can_admins_bypass !== false || !record(value.deployment_branch_policy) || value.deployment_branch_policy.protected_branches !== false || value.deployment_branch_policy.custom_branch_policies !== true || !Array.isArray(value.protection_rules)) return fail("Existing environment differs from the reviewed gate; no update is permitted.");
  const rules: readonly unknown[] = value.protection_rules;
  const reviewers = rules.filter((rule) => record(rule) && rule.type === "required_reviewers");
  const branchMarkers = rules.filter((rule) => record(rule) && rule.type === "branch_policy");
  if (reviewers.length !== 1 || branchMarkers.length > 1 || rules.some((rule) => !record(rule) || !["required_reviewers", "branch_policy", "wait_timer"].includes(String(rule.type)) || (rule.type === "wait_timer" && rule.wait_timer !== 0)) || rules.filter((rule) => record(rule) && rule.type === "wait_timer").length > 1) return fail("Unexpected effective environment protection; preserve it for operator review.");
  const review = reviewers[0];
  if (!record(review) || review.prevent_self_review !== false || !Array.isArray(review.reviewers) || review.reviewers.length !== 1) return fail("Environment reviewer policy differs; no update is permitted.");
  const entry: unknown = review.reviewers[0];
  if (!record(entry) || entry.type !== "User" || !record(entry.reviewer) || entry.reviewer.type !== "User" || entry.reviewer.id !== actor.id || entry.reviewer.login !== actor.login) return fail("Environment reviewer is not the current authorized human; no update is permitted.");
  return value.id;
};

const mainPolicy = (value: unknown): boolean => {
  if (!record(value) || !Number.isSafeInteger(value.total_count) || !Array.isArray(value.branch_policies) || value.total_count !== value.branch_policies.length || value.branch_policies.length > 1) return fail("Unexpected or incomplete deployment branch policies; no change is permitted.");
  if (value.branch_policies.length === 0) return false;
  const policy: unknown = value.branch_policies[0];
  if (!record(policy) || !positiveId(policy.id) || policy.name !== "main" || policy.type !== "branch") return fail("Only the exact main branch policy is permitted; existing policies are preserved.");
  return true;
};

const requireAbsentInventory = (value: unknown): void => {
  if (!record(value) || !Number.isSafeInteger(value.total_count) || !Array.isArray(value.environments) || value.total_count !== value.environments.length || value.environments.length > 100) return fail("Environment inventory is incomplete; absence cannot be established.");
  const entries: readonly unknown[] = value.environments;
  if (entries.some((entry) => !record(entry) || !positiveId(entry.id) || typeof entry.name !== "string" || entry.name.length === 0 || entry.name.length > 255)) return fail("Environment inventory is malformed; absence cannot be established.");
  const names = entries.map((entry) => record(entry) && typeof entry.name === "string" ? entry.name.toLowerCase() : "");
  const ids = entries.map((entry) => record(entry) ? entry.id : null);
  if (new Set(names).size !== entries.length || new Set(ids).size !== entries.length || names.includes("npm-release")) return fail("Environment inventory conflicts with not-found; no creation is permitted.");
};

const inspect = async (github: Github): Promise<Snapshot> => {
  const actor = actorFrom(ok(await github({ method: "GET", path: "user" })));
  const repo = ok(await github({ method: "GET", path: root }));
  if (!record(repo) || repo.full_name !== repository || repo.private !== false || !record(repo.permissions) || repo.permissions.admin !== true) return fail("Current human must administer the exact public release repository.");
  const response = await github({ method: "GET", path: environment });
  if (response.status === 404 && record(response.data) && response.data.message === "Not Found") {
    requireAbsentInventory(ok(await github({ method: "GET", path: `${root}/environments?per_page=100` })));
    return { actor, gate: null };
  }
  const id = gateFrom(ok(response), actor);
  return { actor, gate: { id, main: mainPolicy(ok(await github({ method: "GET", path: `${policies}?per_page=100` }))) } };
};

/** Plan only creation or explicitly identified partial recovery, preserving existing policy. */
export const releaseEnvironmentPlan = (snapshot: Snapshot, resumeId?: number): Plan => {
  if (resumeId !== undefined && (!positiveId(resumeId) || snapshot.gate?.id !== resumeId)) return fail("Resume ID must equal the known partially created environment ID.");
  if (!snapshot.gate) return { action: "create", reviewer: snapshot.actor, environment_id: null };
  if (snapshot.gate.main) return { action: "unchanged", reviewer: snapshot.actor, environment_id: snapshot.gate.id };
  if (resumeId !== snapshot.gate.id) return fail(`Missing main policy: inspect environment ${String(snapshot.gate.id)}; resume only a known partial creation with --resume-environment-id.`);
  return { action: "resume", reviewer: snapshot.actor, environment_id: snapshot.gate.id };
};

const desired = (actor: Actor): unknown => ({ wait_timer: 0, prevent_self_review: false, can_admins_bypass: false, reviewers: [{ type: "User", id: actor.id }], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } });

/** Read/plan by default; explicit apply creates the human gate before adding main, with no updates/deletes. */
export const setupReleaseEnvironment = async (github: Github, apply = false, resumeId?: number): Promise<Readonly<{ changed: boolean; plan: Plan }>> => {
  const before = await inspect(github);
  const plan = releaseEnvironmentPlan(before, resumeId);
  if (!apply || plan.action === "unchanged") return { changed: false, plan };
  const fresh = await inspect(github);
  if (JSON.stringify(fresh) !== JSON.stringify(before)) return fail("Environment or authenticated identity changed since planning; no mutation attempted.");
  const id = plan.action === "create" ? gateFrom(ok(await github({ method: "PUT", path: environment, body: desired(before.actor) })), before.actor) : plan.environment_id;
  if (!positiveId(id)) return fail("Missing created environment identity; stop before creating branch policy.");
  try {
    const created = await inspect(github);
    if (created.actor.id !== before.actor.id || created.actor.login !== before.actor.login || created.gate?.id !== id) return fail("Created environment/actor readback differs.");
    if (!created.gate.main) {
      const policy = ok(await github({ method: "POST", path: policies, body: { name: "main", type: "branch" } }), 200);
      if (!record(policy) || !positiveId(policy.id) || policy.name !== "main" || policy.type !== "branch") return fail("Created main policy response differs.");
    }
    const after = await inspect(github);
    if (after.actor.id !== before.actor.id || after.actor.login !== before.actor.login || after.gate?.id !== id || !after.gate.main) return fail("Final environment readback differs.");
    return { changed: true, plan: { ...plan, environment_id: id } };
  } catch {
    return fail(`Setup outcome unverified for environment ${String(id)}; no automatic retry or policy rollback. Inspect the human gate, then use --apply --resume-environment-id ${String(id)} only for this known creation; an already exact gate is verified without writes.`);
  }
};

/** Validate the small operator interface before issuing even a read request. */
export const releaseEnvironmentArguments = (args: readonly string[]): Readonly<{ apply: boolean; resumeId?: number }> => {
  const allowed = args.length === 0 || (args.length === 1 && args[0] === "--apply") || (args.length === 2 && args[0] === "--resume-environment-id") || (args.length === 3 && args[0] === "--apply" && args[1] === "--resume-environment-id");
  if (!allowed) return fail("Usage: node dist/scripts/release-environment.js [--apply] [--resume-environment-id ID]");
  const rawId = args.at(-1);
  const resume = args.includes("--resume-environment-id");
  if (resume && (!rawId || !/^[1-9][0-9]*$/.test(rawId) || !positiveId(Number(rawId)))) return fail("Resume ID must be a positive safe integer.");
  return { apply: args.includes("--apply"), ...(resume ? { resumeId: Number(rawId) } : {}) };
};

/** Parse gh's bounded HTTP envelope without echoing upstream content or authentication diagnostics. */
export const releaseEnvironmentResponse = (source: string): Response => {
  const normalized = source.replaceAll("\r\n", "\n");
  const boundary = normalized.indexOf("\n\n");
  const status = /^HTTP\/[0-9.]+ ([0-9]{3})\b/.exec(normalized)?.[1];
  if (boundary < 0 || !status) return fail("GitHub CLI returned an invalid HTTP envelope.");
  try { return { status: Number(status), data: JSON.parse(normalized.slice(boundary + 2)) as unknown }; }
  catch { return fail("GitHub CLI returned invalid JSON; no automatic retry."); }
};

const githubCli: Github = (request) => new Promise((accept, reject) => {
  const command = ["api", "--hostname", "github.com", "--include", "--method", request.method, "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28", request.path, ...(request.body === undefined ? [] : ["--input", "-"])];
  const child = execFile("gh", command, { encoding: "utf8", timeout: 30_000, maxBuffer: 256 * 1024 }, (error, stdout) => {
    // gh exits nonzero on HTTP 404; retain only the parsed envelope, never stderr/token diagnostics.
    if (error && !("code" in error && error.code === 1 && stdout.startsWith("HTTP/"))) {
      reject(new Error("GitHub CLI request failed or exceeded its bound; no automatic retry."));
      return;
    }
    try { accept(releaseEnvironmentResponse(stdout)); } catch { reject(new Error("GitHub CLI response was invalid; no automatic retry.")); }
  });
  child.stdin?.on("error", () => { reject(new Error("GitHub CLI input failed; no automatic retry.")); });
  child.stdin?.end(request.body === undefined ? undefined : JSON.stringify(request.body));
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = releaseEnvironmentArguments(process.argv.slice(2));
  console.log(JSON.stringify(await setupReleaseEnvironment(githubCli, options.apply, options.resumeId)));
}
