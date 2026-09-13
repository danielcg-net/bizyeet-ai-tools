#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { loginWithBrowser, loginWithDevice } from "./auth-session.js";
import { validOAuthScope } from "./oauth-scope.js";
import { refreshPersistenceMessages } from "./agent-client.js";
import { launchBrowser } from "./browser.js";
import { checkIdentity, getCustomer as getAgentCustomer, listCustomers as listAgentCustomers, previewCustomerUpdate, executeCustomerUpdate, customerUpdateStatus, type AgentResult, type CustomerListOptions, type PersistCredentials } from "./agent-client.js";
import { readChanges, readApprovalReceipt } from "./write-input.js";
import { credentialStore, isCommittedCredentialCleanupFailure } from "./credential-store.js";
import { isUncertainCredentialPersistence, uncertainCredentialPersistenceError } from "./credential-cleanup.js";
import { validResourceId } from "./canonical-crm-client.js";
import { CRM_SEARCH_LIMIT_MESSAGE } from "./search-contract.js";
import { exportReadResponse, READ_OUTPUT_BYTE_LIMIT } from "./read-export.js";
import { escapeDisplayJson } from "./display-json.js";
import { isUuid } from "./uuid.js";
import type { DeviceAuthorization } from "./oauth.js";
import { discoverOAuth, issuerOrigin, revokeRefreshToken } from "./oauth.js";
import { profileName, withProfileOperationLock, type ProfileOperationOutcome } from "./profile-store.js";
import { openLoopbackCallback } from "./loopback.js";
import { agentFailureExitCode, agentFailureMessage, isAgentFailure } from "./agent-error.js";

export type CliResult = Readonly<{ exitCode: number; message: string; stream: "stderr" | "stdout"; warnings?: readonly string[] }>;
export type CliIo = Readonly<{ error: (message: string) => void; log: (message: string) => void }>;

type CliStorage = Readonly<{
  withProfileLock?: <T>(profile: string, operation: () => Promise<T>) => Promise<ProfileOperationOutcome<T>>;
  readCredentials: (profile?: string) => Promise<import("./profile-store.js").CredentialCollection>;
  removeCredentials: (profile: string) => Promise<void>;
  saveCredentials: (profile: string, credentials: import("./profile-store.js").StoredCredentials) => Promise<void>;
}>;

type CliRuntime = Readonly<{
  exportReadResponse?: typeof exportReadResponse;
  previewCustomerUpdate?: (input: Omit<Parameters<typeof previewCustomerUpdate>[0], "fetcher" | "metadata" | "now">) => Promise<AgentResult>;
  executeCustomerUpdate?: (input: Omit<Parameters<typeof executeCustomerUpdate>[0], "fetcher" | "metadata" | "now">) => Promise<AgentResult>;
  customerUpdateStatus?: (input: Omit<Parameters<typeof customerUpdateStatus>[0], "fetcher" | "metadata" | "now">) => Promise<AgentResult>;
  readChanges?: typeof readChanges;
  readApprovalReceipt?: typeof readApprovalReceipt;
  checkIdentity?: (input: Readonly<{ credentials: import("./profile-store.js").StoredCredentials; persistCredentials: PersistCredentials; profile: import("./profile-store.js").Profile }>) => Promise<AgentResult>;
  getCustomer: (input: Readonly<{ credentials: import("./profile-store.js").StoredCredentials; persistCredentials: PersistCredentials; profile: import("./profile-store.js").Profile; resourceId: string }>) => Promise<AgentResult>;
  listCustomers: (input: Readonly<{ credentials: import("./profile-store.js").StoredCredentials; options: CustomerListOptions; persistCredentials: PersistCredentials; profile: import("./profile-store.js").Profile }>) => Promise<AgentResult>;
  loginBrowser: (input: Readonly<{ issuer: string; scope: string }>) => ReturnType<typeof loginWithBrowser>;
  loginDevice: (input: Parameters<typeof loginWithDevice>[0], onVerification: (device: DeviceAuthorization) => void) => ReturnType<typeof loginWithDevice>;
  revoke: (input: Readonly<{ credentials: import("./profile-store.js").StoredCredentials; profile: import("./profile-store.js").Profile }>) => Promise<void>;
}>;

const storage: CliStorage = {
  withProfileLock: withProfileOperationLock,
  readCredentials: credentialStore.read,
  removeCredentials: credentialStore.remove,
  saveCredentials: credentialStore.save,
};

const runtime: CliRuntime = {
  readChanges,
  readApprovalReceipt,
  previewCustomerUpdate: async (input) => previewCustomerUpdate({ ...input, fetcher: fetch, now: Date.now, metadata: () => discoverOAuth(new URL(input.profile.issuer), fetch) }),
  executeCustomerUpdate: async (input) => executeCustomerUpdate({ ...input, fetcher: fetch, now: Date.now, metadata: () => discoverOAuth(new URL(input.profile.issuer), fetch) }),
  customerUpdateStatus: async (input) => customerUpdateStatus({ ...input, fetcher: fetch, now: Date.now, metadata: () => discoverOAuth(new URL(input.profile.issuer), fetch) }),
  checkIdentity: async (input) => {
    const metadata = (): ReturnType<typeof discoverOAuth> => discoverOAuth(new URL(input.profile.issuer), fetch);
    return checkIdentity({ ...input, fetcher: fetch, metadata, now: Date.now });
  },
  getCustomer: async (input) => {
    const metadata = (): ReturnType<typeof discoverOAuth> => discoverOAuth(new URL(input.profile.issuer), fetch);
    return getAgentCustomer({ ...input, fetcher: fetch, metadata, now: Date.now });
  },
  listCustomers: async (input) => {
    const metadata = (): ReturnType<typeof discoverOAuth> => discoverOAuth(new URL(input.profile.issuer), fetch);
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
  "Usage: bizyeet auth <login|status|check|logout> [--profile <name>]",
  "       auth status inspects local credentials; auth check verifies current server access.",
  "       bizyeet customers list [--limit <1-100>] [--cursor <opaque>] [--search <text>] [--fields <name,...>] [--profile <name>] [--export]",
  "       bizyeet customers get <opaque-id> [--profile <name>] [--export]",
  "Read commands accept --export for a private local JSON file; responses above 32 KiB export automatically. No output-path argument or automatic pagination is supported.",
  "       bizyeet customers update preview <opaque-id> --input-stdin [--profile <name>]",
  "       bizyeet customers update execute <preview-id> --idempotency-key <uuid> [--receipt-stdin] [--profile <name>]",
  "       bizyeet customers update status <preview-id> --idempotency-key <uuid> [--profile <name>]",
  "Preview reads a bounded JSON changes object from stdin; review its approval_path in your signed-in dashboard.",
  "Execution prompts for a hidden approval receipt. Harnesses use a private pipe with --receipt-stdin; never put receipts in commands, shell history or chat.",
  "Generate and retain one UUID idempotency key for this execution. Never replace it to recover an uncertain outcome.",
  "       bizyeet --version",
  "       bizyeet diagnostics (local runtime and manual-update guidance; no network or credentials)",
  "Authentication uses OAuth with PKCE or Device Authorization; API keys, personal access tokens, and passwords are not accepted.",
  "All command output is structured JSON. OAuth token material is never printed.",
  "Headless POSIX operators may explicitly select BIZYEET_CREDENTIAL_STORE=file; use a dedicated profile and trusted private config directory. Default auto mode never downgrades denied native access.",
  "JSON is the default; an explicit --json may precede the command or follow its arguments.",
].join("\n");

const packageVersion = (): string => {
  const packageMetadata: unknown = createRequire(import.meta.url)("../../package.json");
  if (typeof packageMetadata !== "object" || packageMetadata === null || typeof (packageMetadata as Record<string, unknown>).version !== "string") throw new Error("The installed package version is invalid.");
  return (packageMetadata as Record<string, unknown>).version as string;
};

const diagnostics = (): Readonly<Record<string, unknown>> => ({
  version: packageVersion(),
  runtime: { name: "node", version: process.versions.node, platform: process.platform, architecture: process.arch, required: ">=24", supported: Number(process.versions.node.split(".")[0]) >= 24 },
  authentication: { checked: false, next_step: "bizyeet auth check" },
  update: { checked: false, automatic: false, releases_url: "https://github.com/danielcg-net/bizyeet-ai-tools/releases", guidance: "Review the official release notes and installation instructions before updating. This command does not determine the latest release or install anything." },
});

const envelope = (data: Readonly<Record<string, unknown>>): string => escapeDisplayJson(JSON.stringify({
  data,
  meta: { contract_version: "v1", request_id: crypto.randomUUID() },
}));

const errorEnvelope = (code: string, message: string): string => escapeDisplayJson(JSON.stringify({
  error: { code, details: {}, message, request_id: crypto.randomUUID(), retryable: false },
}));

const result = (exitCode: number, message: string, stream: CliResult["stream"]): CliResult => ({ exitCode, message, stream });
const output = (data: Readonly<Record<string, unknown>>): CliResult => result(0, envelope(data), "stdout");
const invalidInput = (message: string): CliResult => result(2, errorEnvelope("invalid_request", message), "stderr");
const authenticationRequired = (): CliResult => result(3, errorEnvelope("authentication_required", "Run auth login before using this profile."), "stderr");

const profileInputMessages = new Set([
  "XDG_CONFIG_HOME must be a nonempty absolute directory.",
  "BIZYEET_CREDENTIAL_STORE must be auto or file.",
  "Use --profile once with a valid profile name.", "Profile names use lowercase letters, digits, and hyphens only.",
]);
const safeValidationMessages = new Set([
  ...profileInputMessages,
  "OAuth registration does not permit secretless login with the selected flow and refresh tokens. Contact your tenant administrator before retrying.",
  "Windows OAuth credentials require the native credential manager; plaintext fallback is unavailable.",
  "Write input is invalid, oversized, cancelled or expired.",
  "Preview changes require piped JSON with --input-stdin.",
  "Use hidden terminal entry, or --receipt-stdin with a pipe.",
  "--limit must be an integer from 1 to 100.", "Cursor is invalid.", "Customer ID is invalid.",
  CRM_SEARCH_LIMIT_MESSAGE, "Requested fields are invalid.",
  "Stored BizYeet credentials are invalid.", "Credential fallback file permissions are unsafe; expected mode 0600.",
  "Credential fallback file permissions are unsafe; expected an owner-only regular file with mode 0600.",
  "Credential fallback directory is unsafe; expected an owner-only directory with mode 0700.",
  "Credential fallback file must not be a symbolic link.",
  "customers list accepts --cursor, --fields, --limit, --profile, --search, and --export only.",
  "customers get requires one opaque ID and optional --profile.",
  ...["--cursor", "--fields", "--limit", "--profile", "--search", "--issuer", "--scope", "--idempotency-key"].map((option) => `Use ${option} once with a value.`),
]);
const safeLocalMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && safeValidationMessages.has(error.message) ? error.message : fallback;

const profileFailure = (error: unknown, fallback: string): CliResult =>
  error instanceof Error && profileInputMessages.has(error.message) ? invalidInput(error.message)
    : result(1, errorEnvelope("internal_error", safeLocalMessage(error, fallback)), "stderr");

const valuesFor = (args: readonly string[], option: string): readonly string[] =>
  args.flatMap((argument, index) => argument === option ? [args[index + 1] ?? ""]
    : argument.startsWith(`${option}=`) ? [argument.slice(option.length + 1)] : []);

const profileFrom = (args: readonly string[]): string => {
  const profiles = valuesFor(args, "--profile");
  if (profiles.length > 1 || profiles.some((value) => !value)) throw new Error("Use --profile once with a valid profile name.");
  return profileName(profiles[0]);
};

const hasOnlyOptions = (args: readonly string[], valueOptions: readonly string[], flagOptions: readonly string[] = []): boolean =>
  args.every((argument, index) =>
    valueOptions.includes(args[index - 1] ?? "")
      ? !argument.startsWith("--")
      : valueOptions.includes(argument) || valueOptions.some((option) => argument.startsWith(`${option}=`)) || flagOptions.includes(argument),
  );

const status = async (args: readonly string[], dependencies: CliStorage): Promise<CliResult> => {
  if (!hasOnlyOptions(args, ["--profile"])) return invalidInput("auth status accepts only --profile.");
  try {
    const profile = profileFrom(args);
    const credentials = await dependencies.readCredentials(profile);
    const current = credentials[profile];
    const configured = current?.profile;
    if (!configured) return authenticationRequired();
    return output({
      authenticated: new Date(current.expiresAt).getTime() > Date.now(),
      verification: "local_only",
      expires_at: current.expiresAt,
      issuer: configured.issuer,
      profile,
      scope: current.scope,
    });
  } catch (error) {
    return profileFailure(error, "Could not read this profile. Check credential storage and configuration.");
  }
};

const logout = async (args: readonly string[], dependencies: CliStorage, execution: CliRuntime): Promise<CliResult> => {
  if (!hasOnlyOptions(args, ["--profile"])) return invalidInput("auth logout accepts only --profile.");
  try {
    const name = profileFrom(args);
    const credentials = await dependencies.readCredentials(name);
    const current = credentials[name];
    const profile = current?.profile;
    const remoteRevoked = Boolean(profile && current.refreshToken);
    if (profile && current.refreshToken) {
      try {
        await execution.revoke({ credentials: current, profile });
      } catch {
        return result(1, errorEnvelope("request_unavailable", "Could not confirm server revocation. Credentials were retained; retry auth logout when the service is available."), "stderr");
      }
    }
    await dependencies.removeCredentials(name);
    return output({ logged_out: true, profile: name, revocation: remoteRevoked ? "confirmed" : "local_only" });
  } catch (error) {
    return profileFailure(error, "Could not clear this profile. Check credential storage and configuration.");
  }
};

const oneOption = (args: readonly string[], option: string, fallback?: string): string => {
  const values = valuesFor(args, option);
  if (values.length > 1 || values.some((value) => !value)) throw new Error(`Use ${option} once with a value.`);
  return values[0] ?? fallback ?? "";
};

const loginOptions = (args: readonly string[]): Readonly<{ name: string; issuer: string; scope: string }> | CliResult => {
  try {
    const name = profileFrom(args);
    const issuer = oneOption(args, "--issuer");
    const scope = oneOption(args, "--scope", "customers.read");
    // RFC 6749 section 3.3: scope-token *(SP scope-token), no quote/backslash.
    if (!validOAuthScope(scope)) return invalidInput("Use nonempty OAuth scope tokens separated by one space, without quotes, backslashes or non-ASCII characters.");
    if (!issuer) return invalidInput("auth login requires --issuer.");
    return { name, issuer: issuerOrigin(issuer).origin, scope };
  } catch (error) {
    return invalidInput(safeLocalMessage(error, "Use a valid HTTPS issuer origin and login options."));
  }
};

const login = async (args: readonly string[], dependencies: CliStorage, execution: CliRuntime, onVerification: (device: DeviceAuthorization) => void): Promise<CliResult> => {
  if (!hasOnlyOptions(args, ["--issuer", "--profile", "--scope"], ["--device"])) return invalidInput("auth login accepts --device, --issuer, --profile, and --scope only.");
  const parsed = loginOptions(args);
  if ("exitCode" in parsed) return parsed;
  const { name: profileNameValue, issuer, scope } = parsed;
  try {
    const credentials = await dependencies.readCredentials(profileNameValue);
    const previousCredentials = credentials[profileNameValue];
    const previousProfile = previousCredentials?.profile;
    const existingClientId = previousProfile?.issuer === issuer && previousProfile.deviceGrantVerified === true
      && previousProfile.deviceRegistrationVersion === 1
      ? previousProfile.clientId : undefined;
    if (previousCredentials?.refreshToken) {
      if (!previousProfile) return result(3, errorEnvelope("authentication_required", "This legacy profile has no bound issuer. Revoke its access in dashboard settings and run auth logout before replacing it."), "stderr");
      try {
        await execution.revoke({ credentials: previousCredentials, profile: previousProfile });
      } catch {
        return result(1, errorEnvelope("request_unavailable", "Could not retire the previous grant. Credentials were retained and no new login started; retry when the service is available."), "stderr");
      }
    }
    const completed = args.includes("--device")
      ? await execution.loginDevice({ ...(existingClientId ? { clientId: existingClientId, deviceRegistrationVersion: 1 as const } : {}), issuer, scope }, onVerification)
      : await execution.loginBrowser({ issuer, scope });
    try {
      await dependencies.saveCredentials(profileNameValue, { ...completed.credentials, profile: completed.profile });
    } catch (error) {
      if (isUncertainCredentialPersistence(error)) return result(1, errorEnvelope("internal_error", uncertainCredentialPersistenceError().message), "stderr");
      if (isCommittedCredentialCleanupFailure(error)) return result(1, errorEnvelope("internal_error",
        "Credentials were saved and access was retained, but credential storage cleanup failed. Check storage and abandoned locks before retrying."), "stderr");
      try {
        await execution.revoke({ credentials: completed.credentials, profile: completed.profile });
      } catch {
        return result(3, errorEnvelope("authentication_required", "Credential persistence failed and the new grant could not be revoked. Revoke the new connection in dashboard settings before retrying login."), "stderr");
      }
      return result(3, errorEnvelope("authentication_required", "Credential persistence failed. The new grant was revoked; check credential storage before retrying login."), "stderr");
    }
    return output({ authenticated: true, expires_at: completed.credentials.expiresAt, issuer: completed.profile.issuer, profile: profileNameValue, scope: completed.credentials.scope });
  } catch (error) {
    return result(3, errorEnvelope("authentication_required", safeLocalMessage(error, "OAuth login failed. Check the issuer, approval status and credential storage, then try again.")), "stderr");
  }
};

const unsupportedCommand = (command: string): CliResult =>
  result(2, errorEnvelope("invalid_request", `Unsupported command: ${command}. Run bizyeet --help.`), "stderr");

const authenticatedProfile = async (args: readonly string[], dependencies: CliStorage): Promise<Readonly<{ credentials: import("./profile-store.js").StoredCredentials; name: string; profile: import("./profile-store.js").Profile }> | CliResult> => {
  const name = profileFrom(args);
  const credentials = await dependencies.readCredentials(name);
  const current = credentials[name];
  const profile = current?.profile;
  return profile ? { credentials: current, name, profile } : authenticationRequired();
};

const checkAuthentication = async (args: readonly string[], dependencies: CliStorage, execution: CliRuntime): Promise<CliResult> => {
  if (!hasOnlyOptions(args, ["--profile"])) return invalidInput("auth check accepts only --profile.");
  try {
    const selected = await authenticatedProfile(args, dependencies);
    if ("exitCode" in selected) return selected;
    if (!execution.checkIdentity) throw new Error("Identity diagnostic is unavailable.");
    return resourceOutput(await execution.checkIdentity({ credentials: selected.credentials, profile: selected.profile,
      persistCredentials: (credentials) => dependencies.saveCredentials(selected.name, credentials),
    }));
  } catch (error) {
    return requestFailure(error);
  }
};

const requestFailure = (error: unknown): CliResult => {
  const failure = error instanceof Error ? error.cause : error;
  if (isAgentFailure(failure)) return result(agentFailureExitCode(failure), JSON.stringify({ error: {
    code: failure.code === "authorization_required" ? "authentication_required" : failure.code,
    message: agentFailureMessage(failure), request_id: failure.requestId, retryable: failure.retryable, details: {},
  } }), "stderr");
  const message = error instanceof Error ? error.message : "The agent request failed.";
  if (Object.values(refreshPersistenceMessages).some((value) => value === message)) return result(1, errorEnvelope("internal_error", message), "stderr");
  if (safeValidationMessages.has(message)) return invalidInput(message);
  if (message.includes("session expired") || message.includes("auth login") || message.includes("OAuth refresh")) return authenticationRequired();
  if (message.includes("authorization_denied")) return result(4, errorEnvelope("authorization_denied", "You do not have permission for this operation."), "stderr");
  if (message.includes("not_found") || message.includes("conflict")) return result(6, errorEnvelope("not_found", "The requested resource is unavailable."), "stderr");
  if (message.includes("rate_limited")) return result(7, errorEnvelope("rate_limited", "The service is temporarily rate limited."), "stderr");
  return result(1, errorEnvelope("internal_error", "The agent service could not complete this request."), "stderr");
};

const resourceOutput = (outcome: AgentResult): CliResult => result(0, escapeDisplayJson(JSON.stringify(outcome.response)), "stdout");

const readOutput = async (outcome: AgentResult, explicit: boolean, execution: CliRuntime): Promise<CliResult> => {
  const serialized = JSON.stringify(outcome.response);
  const printable = escapeDisplayJson(serialized);
  if (!explicit && Buffer.byteLength(printable, "utf8") <= READ_OUTPUT_BYTE_LIMIT) return result(0, printable, "stdout");
  try {
    const exported = await (execution.exportReadResponse ?? exportReadResponse)(serialized);
    const response = outcome.response;
    const meta: unknown = typeof response === "object" && response !== null && "meta" in response ? response.meta : undefined;
    const cursor = typeof meta === "object" && meta !== null && "next_cursor" in meta ? meta.next_cursor : undefined;
    return output({ exported: true, path: exported.path, bytes: exported.bytes,
      ...(typeof cursor === "string" ? { next_cursor: cursor } : {}) });
  } catch {
    return result(1, errorEnvelope("internal_error", "Read export failed. No response data was printed. Inspect private export directories for incomplete files and check local storage protection before retrying."), "stderr");
  }
};

const customerListOptions = (args: readonly string[]): CustomerListOptions => {
  if (!hasOnlyOptions(args, ["--cursor", "--fields", "--limit", "--profile", "--search"], ["--export"])) throw new Error("customers list accepts --cursor, --fields, --limit, --profile, --search, and --export only.");
  const rawLimit = oneOption(args, "--limit", "25");
  const fields = oneOption(args, "--fields", "").split(",").filter(Boolean);
  return {
    ...(oneOption(args, "--cursor", "") ? { cursor: oneOption(args, "--cursor", "") } : {}),
    ...(fields.length ? { fields } : {}),
    limit: Number(rawLimit),
    ...(oneOption(args, "--search", "") ? { search: oneOption(args, "--search", "") } : {}),
  };
};

const beforeSeparator = (args: readonly string[]): readonly string[] =>
  args.includes("--") ? args.slice(0, args.indexOf("--")) : args;

const resourceTarget = (args: readonly string[], valueOptions: readonly string[], flags: readonly string[] = []): Readonly<{ id: string; options: readonly string[] }> | undefined => {
  const separator = args.indexOf("--");
  const positional = separator < 0
    ? args.findIndex((argument, index) => !argument.startsWith("--") && !valueOptions.includes(args[index - 1] ?? ""))
    : separator + 1;
  const id = args[positional];
  const options = separator < 0 ? args.filter((_argument, index) => index !== positional) : args.slice(0, separator);
  if (id === undefined || (separator >= 0 && positional !== args.length - 1)
    || !validResourceId(id) || !hasOnlyOptions(options, valueOptions, flags)) return undefined;
  return { id, options };
};

const customers = async (args: readonly string[], dependencies: CliStorage, execution: CliRuntime): Promise<CliResult> => {
  const [command, ...options] = args;
  if (command === "update") return customerUpdate(options, dependencies, execution);
  try {
    if (beforeSeparator(options).filter((option) => option === "--export").length > 1) return invalidInput("Use --export only once.");
    const listOptions = command === "list" ? customerListOptions(options) : undefined;
    const target = command === "get" ? resourceTarget(options, ["--profile"], ["--export"]) : undefined;
    if (command === "get" && !target) return invalidInput("customers get requires one opaque ID and optional --profile.");
    if (command !== "list" && command !== "get") return unsupportedCommand(`customers ${command ?? ""}`.trim());
    const authenticated = await authenticatedProfile(target?.options ?? options, dependencies);
    if ("exitCode" in authenticated) return authenticated;
    const persistCredentials: PersistCredentials = (credentials) => dependencies.saveCredentials(authenticated.name, credentials);
    const explicit = beforeSeparator(options).includes("--export");
    if (listOptions) return await readOutput(await execution.listCustomers({ credentials: authenticated.credentials, options: listOptions, persistCredentials, profile: authenticated.profile }), explicit, execution);
    return await readOutput(await execution.getCustomer({ credentials: authenticated.credentials, persistCredentials, profile: authenticated.profile, resourceId: target?.id ?? "" }), explicit, execution);
  } catch (error) {
    return requestFailure(error);
  }
};

const customerUpdate = async (args: readonly string[], dependencies: CliStorage, execution: CliRuntime): Promise<CliResult> => {
  const [mode, ...targetArgs] = args;
  if (mode !== "preview" && mode !== "execute" && mode !== "status") return invalidInput("Use customers update preview, execute, or status.");
  const target = resourceTarget(targetArgs, mode === "preview" ? ["--profile"] : ["--profile", "--idempotency-key"], mode === "preview" ? ["--input-stdin"] : mode === "execute" ? ["--receipt-stdin"] : []);
  if (!target) return invalidInput("Unsupported update target or option. Receipts and changes must never be passed as argument values.");
  const { id, options } = target;
  if (options.filter((value) => value === "--input-stdin" || value === "--receipt-stdin").length > 1) return invalidInput("Use each input flag only once.");
  if (mode === "preview" && !options.includes("--input-stdin")) return invalidInput("Preview changes require piped JSON with --input-stdin.");
  try {
    const key = mode !== "preview" ? oneOption(options, "--idempotency-key", "") : "";
    if (mode !== "preview" && (!isUuid(id) || !isUuid(key))) return invalidInput("Execution and status require a preview UUID and --idempotency-key UUID.");
    const selected = await authenticatedProfile(options, dependencies);
    if ("exitCode" in selected) return selected;
    const session = { credentials: selected.credentials, profile: selected.profile,
      persistCredentials: (credentials: import("./profile-store.js").StoredCredentials): Promise<void> => dependencies.saveCredentials(selected.name, credentials) };
    if (mode === "preview") {
      if (!execution.readChanges || !execution.previewCustomerUpdate) throw new Error("Write runtime unavailable");
      return resourceOutput(await execution.previewCustomerUpdate({ ...session, proposal: { resource_id: id, changes: await execution.readChanges() } }));
    }
    if (mode === "status") {
      if (!execution.customerUpdateStatus) throw new Error("Status runtime unavailable");
      return resourceOutput(await execution.customerUpdateStatus({ ...session, query: { preview_id: id, idempotency_key: key } }));
    }
    if (!execution.readApprovalReceipt || !execution.executeCustomerUpdate) throw new Error("Write runtime unavailable");
    return resourceOutput(await execution.executeCustomerUpdate({ ...session, approval: { preview_id: id, idempotency_key: key,
      approval_receipt: await execution.readApprovalReceipt(options.includes("--receipt-stdin")) } }));
  } catch (error) { return requestFailure(error); }
};

/** Resolves a CLI invocation without printing OAuth credentials or mutating user input. */
export const run = async (args: readonly string[], dependencies: CliStorage = storage, execution: CliRuntime = runtime, onVerification: (device: DeviceAuthorization) => void = () => undefined): Promise<CliResult> => {
  const optionArgs = beforeSeparator(args);
  if (args[0] === "--json" || (!args.includes("--") && args.at(-1) === "--json")) {
    const normalized = args[0] === "--json" ? args.slice(1) : args.slice(0, -1);
    if (beforeSeparator(normalized).includes("--json")) return invalidInput("Use --json only once.");
    const resolved = await run(normalized, dependencies, execution, onVerification);
    return resolved.exitCode === 0 && (normalized.length === 0 || beforeSeparator(normalized).includes("--help") || beforeSeparator(normalized).includes("-h"))
      ? output({ help: resolved.message }) : resolved;
  }
  const [first, second] = args;
  if (args.length === 1 && (first === "--version" || first === "version")) return output({ version: packageVersion() });
  if (first === "diagnostics") return args.length === 1 ? output(diagnostics()) : invalidInput("diagnostics accepts no arguments other than --json.");
  if (args.length === 0 || optionArgs.includes("--help") || optionArgs.includes("-h")) return result(0, helpMessage, "stdout");
  if (dependencies.withProfileLock && (first === "customers" || first === "auth")) {
    try {
      if (first === "auth" && second === "login") {
        const parsed = loginOptions(args.slice(2));
        if ("exitCode" in parsed) return parsed;
      }
      const { withProfileLock, ...unlockedStorage } = dependencies;
      const outcome = await withProfileLock(profileFrom(optionArgs), () => run(args, unlockedStorage, execution, onVerification));
      return outcome.cleanupFailed ? { ...outcome.result, warnings: [
        "The operation result is preserved, but profile-lock cleanup failed. Do not repeat a completed mutation. Stop commands and recover the abandoned profile lock before continuing.",
      ] } : outcome.result;
    } catch (error) {
      return profileFailure(error, "Profile operation failed. Stop concurrent commands, check credential storage and retry.");
    }
  }
  if (first === "customers") return customers(args.slice(1), dependencies, execution);
  if (first !== "auth") return unsupportedCommand(first ?? "");
  if (second === "login") return login(args.slice(2), dependencies, execution, onVerification);
  if (second === "status") return status(args.slice(2), dependencies);
  if (second === "check") return checkAuthentication(args.slice(2), dependencies, execution);
  if (second === "logout") return logout(args.slice(2), dependencies, execution);
  return unsupportedCommand(`auth ${second ?? ""}`.trim());
};

/** Writes the resolved CLI result only at the process boundary. */
export const execute = async (args: readonly string[], io: CliIo): Promise<number> => {
  const resolved = await run(args, storage, runtime, (device) => {
    io.error(escapeDisplayJson(JSON.stringify({ data: { user_code: device.userCode, verification_uri: device.verificationUriComplete ?? device.verificationUri }, meta: { contract_version: "v1" } })));
  });
  (resolved.stream === "stdout" ? io.log : io.error)(resolved.message);
  resolved.warnings?.forEach((message) => { io.error(escapeDisplayJson(JSON.stringify({ warning: { code: "profile_lock_cleanup_failed", message } }))); });
  return resolved.exitCode;
};

/** Compares real paths so invocation through an npm bin symlink runs the CLI. */
export const isCliEntrypoint = (
  entrypointPath: string | undefined,
  resolvePath: (path: string) => string,
  modulePath: string,
): boolean => entrypointPath !== undefined && resolvePath(entrypointPath) === resolvePath(modulePath);

if (isCliEntrypoint(process.argv[1], realpathSync, fileURLToPath(import.meta.url))) {
  const exitCode = await execute(process.argv.slice(2), console);
  // Process status is external I/O: let native cleanup and stdout drain normally.
  // eslint-disable-next-line no-restricted-syntax -- Sole process-boundary assignment; application data stays immutable.
  process.exitCode = exitCode;
}
