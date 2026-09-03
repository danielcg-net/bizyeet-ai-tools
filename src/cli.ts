#!/usr/bin/env node

export type CliResult = Readonly<{ exitCode: number; message: string }>;
export type CliIo = Readonly<{ error: (message: string) => void; log: (message: string) => void }>;

const helpMessage = [
  "bizyeet-ai-tools is in its public development bootstrap.",
  "No tenant operation is available yet.",
  "Future authentication will use OAuth; API keys, personal access tokens, and passwords are not accepted.",
].join("\\n");

const unsupportedCommand = (command: string): CliResult => ({
  exitCode: 1,
  message: `Unsupported command: ${command}. Run bizyeet --help.`,
});

/** Resolves a CLI invocation without mutating input or global process state. */
export const run = (args: readonly string[]): CliResult =>
  args.length === 0 || args.includes("--help") || args.includes("-h")
    ? { exitCode: 0, message: helpMessage }
    : unsupportedCommand(args[0] ?? "");

/** Writes the resolved CLI result at the process boundary. */
export const execute = (args: readonly string[], io: CliIo): number => {
  const result = run(args);
  const write = result.exitCode === 0 ? io.log : io.error;

  write(result.message);
  return result.exitCode;
};

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  process.exit(execute(process.argv.slice(2), console));
}
