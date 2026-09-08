import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

type Policy = Readonly<{ enabled: boolean; allowed_actions: "all" | "local_only" | "selected"; sha_pinning_required: boolean }>;
type Github = (args: readonly string[]) => Promise<string>;
const endpoint = "repos/danielcg-net/bizyeet-ai-tools/actions/permissions";
const execute = promisify(execFile);

/** Parse only the policy fields needed for a narrow, explicit repository update. */
export const actionPolicy = (source: string): Policy => {
  const value: unknown = JSON.parse(source);
  if (typeof value !== "object" || value === null || !("enabled" in value)
    || !("allowed_actions" in value) || !("sha_pinning_required" in value)
    || typeof value.enabled !== "boolean" || typeof value.sha_pinning_required !== "boolean"
    || (value.allowed_actions !== "all" && value.allowed_actions !== "local_only" && value.allowed_actions !== "selected")) {
    throw new Error("GitHub returned an unsupported Actions policy; no change applied.");
  }
  return { enabled: value.enabled, allowed_actions: value.allowed_actions, sha_pinning_required: value.sha_pinning_required };
};

/** Inspect by default; explicitly apply SHA enforcement without changing the action allow policy. */
export const enforceActionPinning = async (github: Github, apply: boolean): Promise<Readonly<{ changed: boolean; policy: Policy }>> => {
  const before = actionPolicy(await github(["api", endpoint]));
  if (!apply || before.sha_pinning_required) return { changed: false, policy: before };
  await github(["api", endpoint, "--method", "PUT", "-F", `enabled=${String(before.enabled)}`,
    "-f", `allowed_actions=${before.allowed_actions}`, "-F", "sha_pinning_required=true"]);
  const after = actionPolicy(await github(["api", endpoint]));
  if (!after.sha_pinning_required || after.enabled !== before.enabled || after.allowed_actions !== before.allowed_actions) {
    throw new Error("Actions policy verification failed after update; inspect repository settings before retrying.");
  }
  return { changed: true, policy: after };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--apply")) {
    throw new Error("Usage: npm run security:actions [-- --apply]");
  }
  const github: Github = async (command) => (await execute("gh", command, { timeout: 30_000, maxBuffer: 64 * 1024 })).stdout;
  console.log(JSON.stringify(await enforceActionPinning(github, args[0] === "--apply")));
}
