import { lstat, realpath } from "node:fs/promises";
import { delimiter, isAbsolute, join, posix, win32 } from "node:path";

// Windows PowerShell rebuilds its system module paths from ProgramFiles.
// Keep installation roots, never the parent user/module/config paths.
const operatingSystemKeys = ["SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "TEMP", "TMP", "TMPDIR"] as const;
const fixtureKeys = new Set<string>([...operatingSystemKeys, "RELEASE_TAG", "PUBLICATION_REQUESTED", "BUNDLE_REQUIRED", "GITHUB_RUN_ATTEMPT", "GITHUB_SHA", "GITHUB_RUN_ID", "CANDIDATE_ARTIFACT_ID", "PROVENANCE_ARTIFACT_ID", "REVIEW_ATTESTED", "EXPECTED_BETA", "EXPECTED_LATEST", "REQUIRE_PUBLISHED", "BIZYEET_CREDENTIAL_STORE", "XDG_CONFIG_HOME", "NODE_EXTRA_CA_CERTS"]);
const commandFiles = ["GITHUB_STEP_SUMMARY", "GITHUB_OUTPUT", "GITHUB_ENV", "GITHUB_PATH", "GITHUB_STATE"] as const;
const forbiddenOverride = /^(?:ACTIONS_|RUNNER_|GITHUB_(?!(?:RUN_ATTEMPT|RUN_ID|SHA)$)|GH_TOKEN$|GITHUB_TOKEN$|NPM_|NODE_AUTH_TOKEN$|NODE_OPTIONS$|NODE_PATH$|BASH_ENV$|ENV$|LD_|DYLD_)/u;

const windowsValue = (environment: NodeJS.ProcessEnv, key: string): string | undefined => {
  const values = Object.entries(environment).filter(([name, value]) => name.toUpperCase() === key.toUpperCase() && value !== undefined).map(([, value]) => value);
  if (new Set(values).size > 1) throw new Error("Conflicting Windows fixture OS-key aliases.");
  return values[0];
};

/** Project only known OS essentials, with Windows casing and alias conflicts handled explicitly. */
export const fixtureOperatingSystemEnvironment = (inherited: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv =>
  Object.fromEntries(operatingSystemKeys.filter((key, index) => platform !== "win32" || operatingSystemKeys.findIndex((candidate) => candidate.toUpperCase() === key.toUpperCase()) === index).flatMap((key) => {
    const value = platform === "win32" ? windowsValue(inherited, key) : inherited[key];
    return value === undefined ? [] : [[key, value]];
  }));

const fixtureOverrides = (overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const allowed = Object.fromEntries(Object.entries(overrides).filter(([key]) => fixtureKeys.has(key) && !forbiddenOverride.test(key.toUpperCase())));
  return process.platform === "win32" ? {
    ...Object.fromEntries(Object.entries(allowed).filter(([key]) => !operatingSystemKeys.some((candidate) => candidate.toUpperCase() === key.toUpperCase()))),
    ...fixtureOperatingSystemEnvironment(allowed),
  } : allowed;
};

/** Derive fixture executable search directories without consulting inherited PATH. */
export const fixtureSystemPath = (inherited: NodeJS.ProcessEnv = process.env,
  runtime: Readonly<{platform: NodeJS.Platform; execPath: string}> = process): string => {
  const paths = runtime.platform === "win32" ? win32 : posix;
  const separator = runtime.platform === "win32" ? ";" : ":";
  const absolute = (value: string | undefined): string => {
    if (!value || !paths.isAbsolute(value) || value.includes(separator) || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)) throw new Error("Fixture runtime paths must be absolute and exclude controls or path delimiters.");
    return paths.normalize(value);
  };
  const directories = [paths.dirname(absolute(runtime.execPath)), ...(runtime.platform === "win32"
    ? [paths.join(absolute(windowsValue(inherited, "SystemRoot")), "System32"), paths.join(absolute(windowsValue(inherited, "ProgramFiles")), "OpenSSL", "bin")]
    : ["/usr/bin", "/bin"])];
  return directories.filter((value, index) => directories.findIndex((candidate) => runtime.platform === "win32" ? candidate.toLowerCase() === value.toLowerCase() : candidate === value) === index).join(separator);
};

/** Give fixture subprocesses only OS essentials, explicit inputs and private command/config files. */
export const isolatedTestEnvironment = (root: string, inherited: NodeJS.ProcessEnv = process.env, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...fixtureOperatingSystemEnvironment(inherited),
  ...fixtureOverrides(overrides),
  HOME: root,
  USERPROFILE: root,
  APPDATA: join(root, "appdata"),
  LOCALAPPDATA: join(root, "localappdata"),
  npm_config_userconfig: join(root, "npm-user-config"),
  npm_config_globalconfig: join(root, "npm-global-config"),
  npm_config_cache: join(root, "npm-cache"),
  PSModuleAnalysisCachePath: join(root, "powershell-module-cache"),
  ...Object.fromEntries(commandFiles.map((key) => [key, join(root, key.toLowerCase())])),
  PATH: fixtureSystemPath(inherited),
});

/** Add only the installed package's validated bin directory in its private fixture root. */
export const installedBinEnvironment = async (root: string, base: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> => {
  if (!isAbsolute(root) || root.includes(delimiter) || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(root)) throw new Error("Installed fixture root must be an absolute private directory.");
  const status = await lstat(root);
  const canonicalRoot = await realpath(root);
  const bin = join(root, "node_modules", ".bin");
  const binStatus = await lstat(bin);
  const canonicalBin = await realpath(bin);
  const uid = process.getuid?.();
  if (!status.isDirectory() || status.isSymbolicLink() || !binStatus.isDirectory() || binStatus.isSymbolicLink()
    || canonicalBin !== join(canonicalRoot, "node_modules", ".bin")
    || (process.platform !== "win32" && (status.uid !== uid || (status.mode & 0o077) !== 0 || binStatus.uid !== uid || (binStatus.mode & 0o022) !== 0))
    || base.HOME !== root || base.USERPROFILE !== root || base.PATH !== fixtureSystemPath()
    || Object.keys(base).some((key) => key.toUpperCase() === "PATH" && key !== "PATH")) throw new Error("Installed fixture bin requires an owned private root and canonical isolated search path.");
  return {...base, PATH: `${canonicalBin}${delimiter}${base.PATH}`};
};
