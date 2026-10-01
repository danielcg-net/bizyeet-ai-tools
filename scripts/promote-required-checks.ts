import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Check = Readonly<{ context: string; app_id: number | null }>;
type Protection = Readonly<{ strict: boolean; checks: readonly Check[] }>;
type Github = (method: "GET" | "PATCH", body?: Readonly<{ strict: true; checks: readonly Readonly<{ context: string; app_id: number }>[] }>) => Promise<unknown>;
const endpoint = "https://api.github.com/repos/danielcg-net/bizyeet-ai-tools/branches/main/protection/required_status_checks";
const actionsAppId = 15368;
const existingContexts = Object.freeze(["Test public scaffold", "Analyze JavaScript", "Review dependency changes", "Validate YouTrack delivery"]);
export const packageContexts = Object.freeze(["Package (ubuntu-latest, Node 24)", "Package (ubuntu-latest, Node 26)",
  "Package (macos-latest, Node 24)", "Package (macos-latest, Node 26)",
  "Package (windows-latest, Node 24)", "Package (windows-latest, Node 26)"]);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Parse only the live fields needed to preserve existing required checks and strictness. */
export const requiredChecks = (value: unknown): Protection => {
  if (!record(value) || value.strict !== true || !Array.isArray(value.checks)) {
    throw new Error("Expected strict branch protection with an explicit check list; no change applied.");
  }
  const checks: readonly Check[] = value.checks.map((entry: unknown): Check => {
    if (!record(entry) || typeof entry.context !== "string" || !entry.context ||
      !(entry.app_id === null || (Number.isInteger(entry.app_id) && Number(entry.app_id) >= -1))) {
      throw new Error("Unsupported required-check entry; no change applied.");
    }
    return { context: entry.context, app_id: entry.app_id as number | null };
  });
  if (new Set(checks.map((check) => check.context)).size !== checks.length ||
    existingContexts.some((context) => !checks.some((check) => check.context === context))) {
    throw new Error("Existing required checks changed or duplicated; no change applied.");
  }
  return { strict: true, checks };
};

/** Add only the six fork-verified package contexts, bound to the observed GitHub Actions app. */
export const requiredChecksPlan = (before: Protection): Readonly<{ changed: boolean; checks: readonly Readonly<{ context: string; app_id: number }>[] }> => {
  const existing = new Map(before.checks.map((check) => [check.context, check]));
  if (packageContexts.some((context) => {
    const check = existing.get(context);
    return check !== undefined && check.app_id !== actionsAppId;
  })) throw new Error("A package context has an unexpected producing app; no change applied.");
  return {
    changed: packageContexts.some((context) => !existing.has(context)),
    checks: [...before.checks.map((check) => ({ context: check.context, app_id: check.app_id ?? -1 })),
      ...packageContexts.filter((context) => !existing.has(context)).map((context) => ({ context, app_id: actionsAppId }))],
  };
};

/** Inspect by default; apply only after the reviewed change is merged, then verify the live result. */
export const promoteRequiredChecks = async (github: Github, apply: boolean): Promise<Readonly<{
  changed: boolean; protection: Protection; plannedChecks: readonly Readonly<{ context: string; app_id: number }>[];
}>> => {
  const before = requiredChecks(await github("GET"));
  const plan = requiredChecksPlan(before);
  if (!apply || !plan.changed) return { changed: false, protection: before, plannedChecks: plan.checks };
  await github("PATCH", { strict: true, checks: plan.checks });
  const after = requiredChecks(await github("GET"));
  const afterByContext = new Map(after.checks.map((check) => [check.context, check]));
  if (before.checks.some((check) => (afterByContext.get(check.context)?.app_id ?? -1) !== (check.app_id ?? -1)) ||
    packageContexts.some((context) => afterByContext.get(context)?.app_id !== actionsAppId)) {
    throw new Error("Required-check readback differs from the additive plan; inspect protection before retrying.");
  }
  return { changed: true, protection: after, plannedChecks: plan.checks };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--apply")) {
    throw new Error("Usage: npm run security:required-checks [-- --apply]");
  }
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GH_TOKEN with repository administration permission is required.");
  const github: Github = async (method, body) => {
    const response = await fetch(endpoint, {
      method,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub required-check request failed (HTTP ${String(response.status)}); no automatic retry.`);
    return response.json() as Promise<unknown>;
  };
  console.log(JSON.stringify(await promoteRequiredChecks(github, args[0] === "--apply")));
}
