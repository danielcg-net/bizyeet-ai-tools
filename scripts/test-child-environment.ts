import { join } from "node:path";

const operatingSystemKeys = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR"] as const;
const commandFiles = ["GITHUB_STEP_SUMMARY", "GITHUB_OUTPUT", "GITHUB_ENV", "GITHUB_PATH", "GITHUB_STATE"] as const;
const forbiddenOverride = /^(?:ACTIONS_|RUNNER_|GITHUB_(?!(?:RUN_ATTEMPT|RUN_ID|SHA)$)|GH_TOKEN$|GITHUB_TOKEN$|NPM_|NODE_AUTH_TOKEN$|NODE_OPTIONS$|NODE_PATH$|BASH_ENV$|ENV$|LD_|DYLD_)/u;

/** Give fixture subprocesses only OS essentials, explicit inputs and private command/config files. */
export const isolatedTestEnvironment = (root: string, inherited: NodeJS.ProcessEnv = process.env, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(operatingSystemKeys.flatMap((key) => inherited[key] === undefined ? [] : [[key, inherited[key]]])),
  ...Object.fromEntries(Object.entries(overrides).filter(([key]) => !forbiddenOverride.test(key.toUpperCase()))),
  HOME: root,
  USERPROFILE: root,
  APPDATA: join(root, "appdata"),
  LOCALAPPDATA: join(root, "localappdata"),
  npm_config_userconfig: join(root, "npm-user-config"),
  npm_config_globalconfig: join(root, "npm-global-config"),
  npm_config_cache: join(root, "npm-cache"),
  ...Object.fromEntries(commandFiles.map((key) => [key, join(root, key.toLowerCase())])),
});
