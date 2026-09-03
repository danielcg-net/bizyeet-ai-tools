#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { profileName, readFallbackCredentials, readProfiles, removeFallbackCredentials } from "./profile-store.js";

export type CliResult = Readonly<{ exitCode: number; message: string; stream: "stderr" | "stdout" }>;
export type CliIo = Readonly<{ error: (message: string) => void; log: (message: string) => void }>;

type CliStorage = Readonly<{
  readCredentials: typeof readFallbackCredentials;
  readProfiles: typeof readProfiles;
  removeCredentials: typeof removeFallbackCredentials;
}>;

const storage: CliStorage = {
  readCredentials: readFallbackCredentials,
  readProfiles,
  removeCredentials: removeFallbackCredentials,
};

const helpMessage = [
  "Usage: bizyeet auth <login|status|logout> [--profile <name>]",
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

const hasOnlyProfileOption = (args: readonly string[]): boolean =>
  args.every((argument, index) => !argument.startsWith("--") || argument === "--profile" || args[index - 1] === "--profile");

const status = async (args: readonly string[], dependencies: CliStorage): Promise<CliResult> => {
  if (!hasOnlyProfileOption(args)) return invalidInput("auth status accepts only --profile.");
  try {
    const profile = profileFrom(args);
    const [profiles, credentials] = await Promise.all([dependencies.readProfiles(), dependencies.readCredentials()]);
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

const logout = async (args: readonly string[], dependencies: CliStorage): Promise<CliResult> => {
  if (!hasOnlyProfileOption(args)) return invalidInput("auth logout accepts only --profile.");
  try {
    const profile = profileFrom(args);
    await dependencies.removeCredentials(profile);
    return output({ logged_out: true, profile });
  } catch (error) {
    return invalidInput(error instanceof Error ? error.message : "Invalid logout request.");
  }
};

const unsupportedCommand = (command: string): CliResult =>
  result(1, errorEnvelope("invalid_request", `Unsupported command: ${command}. Run bizyeet --help.`), "stderr");

/** Resolves a CLI invocation without printing OAuth credentials or mutating user input. */
export const run = async (args: readonly string[], dependencies: CliStorage = storage): Promise<CliResult> => {
  const [first, second] = args;
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) return result(0, helpMessage, "stdout");
  if (first !== "auth") return unsupportedCommand(first ?? "");
  if (second === "status") return status(args.slice(2), dependencies);
  if (second === "logout") return logout(args.slice(2), dependencies);
  return unsupportedCommand(`auth ${second ?? ""}`.trim());
};

/** Writes the resolved CLI result only at the process boundary. */
export const execute = async (args: readonly string[], io: CliIo): Promise<number> => {
  const resolved = await run(args);
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
