import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as files from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { exportReadResponse } from "./read-export.js";
import { secureWindowsExport, windowsExportProcessOptions } from "./export-security.js";

const executeDiagnostic = promisify(execFile);
const diagnosticStages = Object.freeze([
  ["Import-Module -Name", "module"], ["$path =", "identity"], ["$item = Get-Item", "item"],
  ["  Set-Acl -LiteralPath", "set-acl"], ["$actual = Get-Acl", "get-acl"], ["$rules =", "verify"],
] as const);
const instrumentAcl = (script: string): string => [
  "[Console]::Error.WriteLine('acl-stage:start')",
  ...script.split("\n").flatMap((line) => {
    const stage = diagnosticStages.find(([prefix]) => line.startsWith(prefix));
    return stage ? [`[Console]::Error.WriteLine('acl-stage:${stage[1]}')`, line] : [line];
  }),
].join("\n");

void test("ACL diagnostics add fixed stage labels without changing script operations", () => {
  const original = diagnosticStages.map(([prefix]) => `${prefix} synthetic-operation`).join("\n");
  const instrumented = instrumentAcl(original);
  assert.equal(instrumented.split("\n").filter((line) => !line.startsWith("[Console]::Error.WriteLine('acl-stage:")).join("\n"), original);
  assert.equal(instrumented.split("\n").filter((line) => line.startsWith("[Console]::Error.WriteLine('acl-stage:")).length, 7);
});

void test("Windows ACL execution has a bounded cold-start allowance", () => {
  assert.deepEqual(windowsExportProcessOptions, { timeout: 30_000, maxBuffer: 16_384, windowsHide: true });
  assert.ok(Object.isFrozen(windowsExportProcessOptions));
});

void test("Windows ACL timeout is not retried and no response file is opened", async (context) => {
  const root = await files.mkdtemp(join(tmpdir(), "export-acl-timeout-test-"));
  const open = context.mock.fn(files.open);
  const execute = context.mock.fn((): Promise<string> => Promise.reject(
    Object.assign(new Error("synthetic timeout"), { killed: true, signal: "SIGTERM", code: null })));
  try {
    await assert.rejects(exportReadResponse("synthetic-private-response", {
      platform: "win32", temporaryRoot: root, operations: { ...files, open },
      secureWindows: (path, mode) => secureWindowsExport(path, mode, execute, { SystemRoot: tmpdir() }),
    }), /No response data was printed/u);
    assert.equal(execute.mock.callCount(), 1);
    assert.equal(open.mock.callCount(), 0);
    assert.deepEqual(await files.readdir(root), []);
  } finally { await files.rm(root, { recursive: true, force: true }); }
});

void test("Windows native export ACL protects the directory and its new file", { skip: process.platform !== "win32" }, async (context) => {
  const secure = (path: string, mode: "directory" | "file" | "verify"): Promise<void> => secureWindowsExport(path, mode, async (executable, args, environment) => {
    const script = instrumentAcl(Buffer.from(args.at(-1) ?? "", "base64").toString("utf16le"));
    const started = performance.now();
    try {
      const result = await executeDiagnostic(executable, [...args.slice(0, -1), Buffer.from(script, "utf16le").toString("base64")], { env: environment, ...windowsExportProcessOptions });
      context.diagnostic(`ACL ${mode} completed in ${String(Math.round(performance.now() - started))}ms`);
      return result.stdout;
    } catch (error) {
      const stderr = error instanceof Error && "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
      const stages = stderr.split(/\r?\n/u).filter((line) => /^acl-stage:(?:start|module|identity|item|set-acl|get-acl|verify)$/u.test(line));
      context.diagnostic(`ACL ${mode} failed after ${String(Math.round(performance.now() - started))}ms; stages: ${stages.join(",") || "none"}`);
      throw error;
    }
  });
  const directory = await files.mkdtemp(join(tmpdir(), "export-native-acl-test-"));
  try {
    context.diagnostic("Establishing current-user directory ACL");
    await secure(directory, "directory");
    context.diagnostic("Directory ACL verified; creating empty synthetic file");
    const path = join(directory, "synthetic.json");
    const handle = await files.open(path, "wx", 0o600);
    try {
      context.diagnostic("Establishing current-user file owner and ACL before writing synthetic data");
      await secure(path, "file");
      await secure(path, "verify");
      await handle.writeFile("{}\n", "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    assert.equal(await files.readFile(path, "utf8"), "{}\n");
    await assert.rejects(secure(path, "file"), /Expected empty file/u);
    await secure(path, "verify");
  } finally { await files.rm(directory, { recursive: true, force: true }); }
});

void test("exports an exact canonical envelope to a unique private file", async () => {
  const response = JSON.stringify({ data: { items: [{ id: "synthetic-1" }] }, meta: { next_cursor: "opaque" } });
  const result = await exportReadResponse(response);
  try {
    assert.equal(await files.readFile(result.path, "utf8"), `${response}\n`);
    assert.equal(result.bytes, Buffer.byteLength(response) + 1);
    if (process.platform === "win32") await secureWindowsExport(result.path, "verify");
    else {
      assert.equal((await files.stat(result.path)).mode & 0o777, 0o600);
      assert.equal((await files.stat(dirname(result.path))).mode & 0o777, 0o700);
    }
  } finally { await files.rm(dirname(result.path), { recursive: true, force: true }); }
});

void test("Windows ACL failure occurs before opening a data file and cleans its directory", async (context) => {
  const root = await files.mkdtemp(join(tmpdir(), "export-acl-test-"));
  const open = context.mock.fn(files.open);
  try {
    await assert.rejects(exportReadResponse("synthetic-private-response", { platform: "win32", temporaryRoot: root,
      operations: { ...files, open }, secureWindows: () => Promise.reject(new Error("private ACL diagnostic")),
    }), /No response data was printed/u);
    assert.equal(open.mock.callCount(), 0);
    assert.deepEqual(await files.readdir(root), []);
  } finally { await files.rm(root, { recursive: true, force: true }); }
});

void test("ACL invocation keeps hostile path data outside executable script text", async () => {
  const path = join(tmpdir(), "literal-'$();[]-directory");
  await secureWindowsExport(path, "directory", (executable, args, environment) => {
    assert.equal(executable, join(tmpdir(), "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
    assert.equal(environment.BIZYEET_EXPORT_SECURITY_PATH, path);
    assert.equal(environment.BIZYEET_EXPORT_SECURITY_CREATE, "directory");
    assert.equal(args.at(-2), "-EncodedCommand");
    assert.equal(Buffer.from(args.at(-1) ?? "", "base64").toString("utf16le").includes(path), false);
    return Promise.resolve("private");
  }, { SystemRoot: tmpdir() });
  await assert.rejects(secureWindowsExport(path, "directory", () => Promise.resolve("unexpected"), { SystemRoot: tmpdir() }), /could not be verified/u);
});

void test("Windows file ACL failure closes the empty file without writing response data", async (context) => {
  const root = await files.mkdtemp(join(tmpdir(), "export-file-acl-test-"));
  const write = context.mock.fn((): Promise<void> => Promise.resolve());
  const security = context.mock.fn((_path: string, mode: "directory" | "file" | "verify"): Promise<void> =>
    mode === "file" ? Promise.reject(new Error("synthetic file ACL failure")) : Promise.resolve());
  try {
    await assert.rejects(exportReadResponse("synthetic-private-response", { temporaryRoot: root, platform: "win32", secureWindows: security,
      operations: { ...files, open: async (path, flags, mode) => {
        const handle = await files.open(path, flags, mode);
        return { stat: (): Promise<import("node:fs").Stats> => handle.stat(), writeFile: write,
          sync: (): Promise<void> => handle.sync(), close: (): Promise<void> => handle.close() };
      } },
    }), /No response data was printed/u);
    assert.deepEqual(security.mock.calls.map((call) => call.arguments[1]), ["directory", "file"]);
    assert.equal(write.mock.callCount(), 0);
    assert.deepEqual(await files.readdir(root), []);
  } finally { await files.rm(root, { recursive: true, force: true }); }
});

void test("oversized exports are rejected without creating an artifact", async (context) => {
  const mkdtemp = context.mock.fn(files.mkdtemp);
  await assert.rejects(exportReadResponse("x".repeat(1024 * 1024 + 1), { operations: { ...files, mkdtemp } }), /byte limit/u);
  assert.equal(mkdtemp.mock.callCount(), 0);
});

void test("Windows ACL subprocess excludes inherited PowerShell module paths in every casing", async () => {
  const environment = { SystemRoot: tmpdir(), PSModulePath: "incompatible-ps7", PSMODULEPATH: "incompatible-upper", psmodulepath: "incompatible-lower", SYNTHETIC_KEEP: "preserved" };
  await secureWindowsExport(join(tmpdir(), "synthetic"), "directory", (_executable, args, child) => {
    assert.equal(Object.keys(child).some((key) => key.toUpperCase() === "PSMODULEPATH"), false);
    assert.equal(child.SYNTHETIC_KEEP, "preserved");
    assert.equal(environment.PSModulePath, "incompatible-ps7");
    const script = Buffer.from(args.at(-1) ?? "", "base64").toString("utf16le");
    assert.ok(script.includes("Import-Module -Name (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1')"));
    return Promise.resolve("private");
  }, environment);
});

await Promise.all(["relative", "", `${tmpdir()}/unsafe\u009b`, `${tmpdir()}/unsafe\u202e`].map((temporaryRoot, index) =>
  test(`rejects unsafe temporary root ${String(index)}`, async (context) => {
    const mkdtemp = context.mock.fn(files.mkdtemp);
    await assert.rejects(exportReadResponse("{}", { temporaryRoot, operations: { ...files, mkdtemp } }), /safe absolute/u);
    assert.equal(mkdtemp.mock.callCount(), 0);
  })));

await Promise.all(["write", "sync", "close", "cleanup"].map((failure) =>
  test(`export ${failure} failure never reports a completed file`, async () => {
    const root = await files.mkdtemp(join(tmpdir(), "export-failure-test-"));
    try {
      await assert.rejects(exportReadResponse("synthetic-private-data", { temporaryRoot: root, operations: {
        ...files,
        rm: failure === "cleanup" ? (): Promise<never> => Promise.reject(new Error("private cleanup error")) : files.rm,
        open: async (path, flags, mode) => {
          const handle = await files.open(path, flags, mode);
          return {
            stat: (): Promise<import("node:fs").Stats> => handle.stat(),
            writeFile: async (content, options): Promise<void> => {
              await handle.writeFile(content, options);
              if (failure === "write" || failure === "cleanup") throw new Error("private partial write error");
            },
            sync: (): Promise<void> => failure === "sync" ? Promise.reject(new Error("private sync error")) : handle.sync(),
            close: async (): Promise<void> => { await handle.close(); if (failure === "close") throw new Error("private close error"); },
          };
        },
      } }), (error: unknown) => error instanceof Error
        && error.message.includes(failure === "cleanup" ? "cleanup could not be confirmed" : "No response data was printed")
        && !error.message.includes("synthetic-private-data"));
      const remaining = await files.readdir(root);
      assert.equal(remaining.length, failure === "cleanup" ? 1 : 0);
    } finally { await files.rm(root, { recursive: true, force: true }); }
  })));
