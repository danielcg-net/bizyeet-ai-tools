#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loginWithBrowser, loginWithDevice } from "./auth-session.js";
import { launchBrowser } from "./browser.js";
import { getCustomer as getAgentCustomer, listCustomers as listAgentCustomers, type AgentResult, type CustomerListOptions } from "./agent-client.js";
import { credentialStore } from "./credential-store.js";
import type { DeviceAuthorization } from "./oauth.js";
import { discoverOAuth, revokeRefreshToken } from "./oauth.js";
import { profileName, readProfiles, saveProfile } from "./profile-store.js";
import { openLoopbackCallback } from "./loopback.js";

export type CliResult = Readonly<{ exitCode: number; message: string; stream: "stderr" | "stdout" }>;
export type CliIo = Readonly<{ error: (message: string) => void; log: (message: string) => void }>;

type CliStorage = Readonly<{
  readCredentials: (profile?: string) => Promise<import("./profile-store.js").CredentialCollection>;
  readProfiles: typeof readProfiles;
  removeCredentials: (profile: string) => Promise<void>;
  saveCredentials: (profile: string, credentials: import("./profile-store.js").StoredCredentials) => Promise<void>;
  saveProfile: typeof saveProfile;
}>;

type CliRuntime = Readonly<{
  getCustomer: (input: Readonly<{ credentials: import("./profile-store.js").StoredCredentials; profile: import("./profile-store.js").Profile; resourceId: string }>) => Promise<AgentResult>;
  listCustomers: (input: Readonly<{ credentials: import("./profile-store.js").StoredCredentials; options: CustomerListOptions; profile: import("./profile-store.js").Profile }>) => Promise<AgentResult>;
  loginBrowser: (input: Readonly<{ issuer: string; scope: string }>) => ReturnType<typeof loginWithBrowser>;
  loginDevice: (input: Readonly<{ clientId?: string; issuer: string; scope: string }>, onVerification: (device: DeviceAuthorization) => void) => ReturnType<typeof loginWithDevice>;
  revoke: (input: Readonly<{ credentials: import("./profile-store.js").StoredCredentials; profile: import("./profile-store.js").Profile }>) => Promise<void>;
}>;

const storage: CliStorage = {
  readCredentials: credentialStore.read,
  readProfiles,
  removeCredentials: credentialStore.remove,
  saveCredentials: credentialStore.save,
  saveProfile,
};

const runtime: CliRuntime = {
  getCustomer: async (input) => {
    const metadata = await discoverOAuth(new URL(input.profile.issuer), fetch);
    return getAgentCustomer({ ...input, fetcher: fetch, metadata, now: Date.now });
  },
  listCustomers: async (input) => {
    const metadata = await discoverOAuth(new URL(input.profile.issuer), fetch);
    return listAgentCustomers({ ...input, fetcher: fetch, metadata, now: Date.now });
  },
  loginBrowser: (input) => loginWithBrowser(input, { fetcher: fetch, launchBrowser, now: Date.now, openCallback: openLoopbackCallback }),
  loginDevice: (input, onVerification) => loginWithDevice(input, { fetcher: fetch, now: Date.now, onVerification }),
  revoke: async (input) => {
    const metadata = await discoverOAuth(new URL(input.profile.issuer), fetch);
    await revokeRefreshToken({ clientId: input.profile.clientId, fetcher: fetch, metadata, refreshToken: input.credentials.refreshToken });
  },
};

const helpMessage = [
  "Usage: bizyeet auth <login|status|logout> [--profile <name>]",
  "       bizyeet customers list [--limit <1-100>] [--cursor <opaque>] [--search <text>] [--fields <name,...>] [--profile <name>]",
  "       bizyeet customers get <opaque-id> [--profile <name>]",
  "Authentication uses OAuth with PKCE only; API keys, personal access tokens, and passwords are not accepted.",
  "All command output is structured JSON. OAuth token material is never printed.",
].join("\n");

const envelope = (data: Readonly<Record<string, unknown>>): string => JSON.stringify({
  data,
  meta: { contract_version: "v1", request_id: crypto.randomUUID() },
});

const errorEnvelope = (code: string, message: string): string => JSON.stringify({
  error: { code, details: {}, message, request_id: crypto.randomUUID(), retryable: false },
});

const result = (exitCode: number, message: string, stream: CliResult["stream"]): CliResult => ({ exitCode, message, stream });
const output = (data: Readonly<Record<string, unknown>>): CliResult => result(0, envelope(data), "stdout");
const invalidInput = (message: string): CliResult => result(2, errorEnvelope("invalid_request", message), "stderr");
const authenticationRequired = (): CliResult => result(3, errorEnvelope("authentication_required", "Run auth login before using this profile."), "stderr");

const valuesFor = (args: readonly string[], option: string): readonly string[] =>
  args.flatMap((argument, index) => argument === option ? [args[index + 1] ?? ""] : []);

const profileFrom = (args: readonly string[]): string => {
  const profiles = valuesFor(args, "--profile");
  if (profiles.length > 1 || profiles.some((value) => !value)) throw new Error("Use --profile once with a valid profile name.");
  return profileName(profiles[0]);
};

const hasOnlyOptions = (args: readonly string[], allowed: readonly string[]): boolean =>
  args.every((argument, index) => !argument.startsWith("--") || allowed.includes(argument) || allowed.includes(args[index - 1] ?? ""));

const status = async (args: readonly string[], dependencies: CliStorage): Promise<CliResult> => {
  if (!hasOnlyOptions(args, ["--profile"])) return invalidInput("auth status accepts only --profile.");
  try {
    const profile = profileFrom(args);
    const [profiles, credentials] = await Promise.all([dependencies.readProfiles(), dependencies.readCredentials(profile)]);
    const configured = profiles[profile];
    const current = credentials[profile];
    if (!configured || !current) return authenticationRequired();
    return output({
      authenticated: new Date(current.expiresAt).getTime() > Date.now(),
      expires_at: current.expiresAt,
      issuer: configured.issuer,
      profile,
      scope: current.scope,
    });
  } catch (error) {
    return invalidInput(error instanceof Error ? error.message : "Invalid auth status request.");
  }
};

const logout = async (args: readonly string[], dependencies: CliStorage, execution: CliRuntime): Promise<CliResult> => {
  if (!hasOnlyOptions(args, ["--profile"])) return invalidInput("auth logout accepts only --profile.");
  try {
    const name = profileFrom(args);
    const [profiles, credentials] = await Promise.all([dependencies.readProfiles(), dependencies.readCredentials(name)]);
    const profile = profiles[name];
    const current = credentials[name];
    const remoteRevoked = profile && current?.refreshToken
      ? await execution.revoke({ credentials: current, profile }).then(() => true).catch(() => false)
      : false;
    await dependencies.removeCredentials(name);
    return output({ logged_out: true, profile: name, revocation: remoteRevoked ? "confirmed" : "local_only" });
  } catch (error) {
    return invalidInput(error instanceof Error ? error.message : "Invalid logout request.");
  }
};

const oneOption = (args: readonly string[], option: string, fallback?: string): string => {
  const values = valuesFor(args, option);
  if (values.length > 1 || values.some((value) => !value)) throw new Error(`Use ${option} once with a value.`);
  return values[0] ?? fallback ?? "";
};

const login = async (args: readonly string[], dependencies: CliStorage, execution: CliRuntime, onVerification: (device: DeviceAuthorization) => void): Promise<CliResult> => {
  if (!hasOnlyOptions(args, ["--device", "--issuer", "--profile", "--scope"])) return invalidInput("auth login accepts --device, --issuer, --profile, and --scope only.");
  try {
    const profileNameValue = profileFrom(args);
    const issuer = oneOption(args, "--issuer");
    const scope = oneOption(args, "--scope", "customers.read");
    if (!issuer) return invalidInput("auth login requires --issuer.");
    const profiles = await dependencies.readProfiles();
    const existingClientId = profiles[profileNameValue]?.issuer === issuer ? profiles[profileNameValue].clientId : undefined;
    const completed = args.includes("--device")
      ? await execution.loginDevice({ ...(existingClientId ? { clientId: existingClientId } : {}), issuer, scope }, onVerification)
      : await execution.loginBrowser({ issuer, scope });
    await Promise.all([
      dependencies.saveProfile(profileNameValue, completed.profile),
      dependencies.saveCredentials(profileNameValue, completed.credentials),
    ]);
    return output({ authenticated: true, expires_at: completed.credentials.expiresAt, issuer: completed.profile.issuer, profile: profileNameValue, scope: completed.credentials.scope });
  } catch (error) {
    return result(3, errorEnvelope("authentication_required", error instanceof Error ? error.message : "OAuth login failed."), "stderr");
  }
};

const unsupportedCommand = (command: string): CliResult =>
  result(1, errorEnvelope("invalid_request", `Unsupported command: ${command}. Run bizyeet --help.`), "stderr");

const authenticatedProfile = async (args: readonly string[], dependencies: CliStorage): Promise<Readonly<{ credentials: import("./profile-store.js").StoredCredentials; name: string; profile: import("./profile-store.js").Profile }> | CliResult> => {
  const name = profileFrom(args);
  const [profiles, credentials] = await Promise.all([dependencies.readProfiles(), dependencies.readCredentials(name)]);
  const profile = profiles[name];
  const current = credentials[name];
  return profile && current ? { credentials: current, name, profile } : authenticationRequired();
};

const requestFailure = (error: unknown): CliResult => {
  const message = error instanceof Error ? error.message : "The agent request failed.";
  if (/must be|invalid|Cursor|Customer ID|Search|fields/u.test(message)) return invalidInput(message);
  if (message.includes("session expired") || message.includes("auth login") || message.includes("OAuth refresh")) return authenticationRequired();
  if (message.includes("authorization_denied")) return result(4, errorEnvelope("authorization_denied", "You do not have permission for this operation."), "stderr");
  if (message.includes("not_found") || message.includes("conflict")) return result(6, errorEnvelope("not_found", "The requested resource is unavailable."), "stderr");
  if (message.includes("rate_limited")) return result(7, errorEnvelope("rate_limited", "The service is temporarily rate limited."), "stderr");
  return result(1, errorEnvelope("internal_error", "The agent service could not complete this request."), "stderr");
};

const resourceOutput = async (outcome: AgentResult, name: string, dependencies: CliStorage): Promise<CliResult> => {
  await dependencies.saveCredentials(name, outcome.credentials);
  return result(0, JSON.stringify(outcome.response), "stdout");
};

const customerListOptions = (args: readonly string[]): CustomerListOptions => {
  if (!hasOnlyOptions(args, ["--cursor", "--fields", "--limit", "--profile", "--search"])) throw new Error("customers list accepts --cursor, --fields, --limit, --profile, and --search only.");
  const rawLimit = oneOption(args, "--limit", "25");
  const fields = oneOption(args, "--fields", "").split(",").filter(Boolean);
  return {
    ...(oneOption(args, "--cursor", "") ? { cursor: oneOption(args, "--cursor", "") } : {}),
    ...(fields.length ? { fields } : {}),
    limit: Number(rawLimit),
    ...(oneOption(args, "--search", "") ? { search: oneOption(args, "--search", "") } : {}),
  };
};

const customers = async (args: readonly string[], dependencies: CliStorage, execution: CliRuntime): Promise<CliResult> => {
  const [command, ...options] = args;
  try {
    const authenticated = await authenticatedProfile(options, dependencies);
    if ("exitCode" in authenticated) return authenticated;
    if (command === "list") return await resourceOutput(await execution.listCustomers({ credentials: authenticated.credentials, options: customerListOptions(options), profile: authenticated.profile }), authenticated.name, dependencies);
    if (command === "get") {
      const identifiers = options.filter((argument, index) => !argument.startsWith("--") && options[index - 1] !== "--profile");
      if (identifiers.length !== 1 || !hasOnlyOptions(options, ["--profile"])) return invalidInput("customers get requires one opaque ID and optional --profile.");
      return await resourceOutput(await execution.getCustomer({ credentials: authenticated.credentials, profile: authenticated.profile, resourceId: identifiers[0] ?? "" }), authenticated.name, dependencies);
    }
    return unsupportedCommand(`customers ${command ?? ""}`.trim());
  } catch (error) {
    return requestFailure(error);
  }
};

/** Resolves a CLI invocation without printing OAuth credentials or mutating user input. */
export const run = async (args: readonly string[], dependencies: CliStorage = storage, execution: CliRuntime = runtime, onVerification: (device: DeviceAuthorization) => void = () => undefined): Promise<CliResult> => {
  const [first, second] = args;
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) return result(0, helpMessage, "stdout");
  if (first === "customers") return customers(args.slice(1), dependencies, execution);
  if (first !== "auth") return unsupportedCommand(first ?? "");
  if (second === "login") return login(args.slice(2), dependencies, execution, onVerification);
  if (second === "status") return status(args.slice(2), dependencies);
  if (second === "logout") return logout(args.slice(2), dependencies, execution);
  return unsupportedCommand(`auth ${second ?? ""}`.trim());
};

/** Writes the resolved CLI result only at the process boundary. */
export const execute = async (args: readonly string[], io: CliIo): Promise<number> => {
  const resolved = await run(args, storage, runtime, (device) => {
    io.error(JSON.stringify({ data: { user_code: device.userCode, verification_uri: device.verificationUriComplete ?? device.verificationUri }, meta: { contract_version: "v1" } }));
  });
  (resolved.stream === "stdout" ? io.log : io.error)(resolved.message);
  return resolved.exitCode;
};

/** Compares real paths so invocation through an npm bin symlink runs the CLI. */
export const isCliEntrypoint = (
  entrypointPath: string | undefined,
  resolvePath: (path: string) => string,
  modulePath: string,
): boolean => entrypointPath !== undefined && resolvePath(entrypointPath) === resolvePath(modulePath);

if (isCliEntrypoint(process.argv[1], realpathSync, fileURLToPath(import.meta.url))) {
  void execute(process.argv.slice(2), console).then((exitCode) => process.exit(exitCode));
}
