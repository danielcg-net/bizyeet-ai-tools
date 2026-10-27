import { join } from "node:path";

// Windows PowerShell rebuilds its system module paths from ProgramFiles.
// Keep installation roots, never the parent user/module/config paths.
const operatingSystemKeys = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "TEMP", "TMP", "TMPDIR"] as const;
const fixtureKeys = new Set<string>([...operatingSystemKeys, "RELEASE_TAG", "PUBLICATION_REQUESTED", "BUNDLE_REQUIRED", "GITHUB_RUN_ATTEMPT", "GITHUB_SHA", "GITHUB_RUN_ID", "CANDIDATE_ARTIFACT_ID", "PROVENANCE_ARTIFACT_ID", "REVIEW_ATTESTED", "EXPECTED_BETA", "EXPECTED_LATEST", "REQUIRE_PUBLISHED", "BIZYEET_CREDENTIAL_STORE", "XDG_CONFIG_HOME", "NODE_EXTRA_CA_CERTS"]);
const commandFiles = ["GITHUB_STEP_SUMMARY", "GITHUB_OUTPUT", "GITHUB_ENV", "GITHUB_PATH", "GITHUB_STATE"] as const;
const forbiddenOverride = /^(?:ACTIONS_|RUNNER_|GITHUB_(?!(?:RUN_ATTEMPT|RUN_ID|SHA)$)|GH_TOKEN$|GITHUB_TOKEN$|NPM_|NODE_AUTH_TOKEN$|NODE_OPTIONS$|NODE_PATH$|BASH_ENV$|ENV$|LD_|DYLD_)/u;

/** Give fixture subprocesses only OS essentials, explicit inputs and private command/config files. */
export const isolatedTestEnvironment = (root: string, inherited: NodeJS.ProcessEnv = process.env, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(operatingSystemKeys.flatMap((key) => inherited[key] === undefined ? [] : [[key, inherited[key]]])),
  ...Object.fromEntries(Object.entries(overrides).filter(([key]) => fixtureKeys.has(key) && !forbiddenOverride.test(key.toUpperCase()))),
  HOME: root,
  USERPROFILE: root,
  APPDATA: join(root, "appdata"),
  LOCALAPPDATA: join(root, "localappdata"),
  npm_config_userconfig: join(root, "npm-user-config"),
  npm_config_globalconfig: join(root, "npm-global-config"),
  npm_config_cache: join(root, "npm-cache"),
  ...Object.fromEntries(commandFiles.map((key) => [key, join(root, key.toLowerCase())])),
});
