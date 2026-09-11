import assert from "node:assert/strict";
import test from "node:test";
import * as files from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { exportReadResponse } from "./read-export.js";
import { secureWindowsExport } from "./export-security.js";

void test("Windows native export ACL protects the directory and its new file", { skip: process.platform !== "win32" }, async (context) => {
  const directory = await files.mkdtemp(join(tmpdir(), "export-native-acl-test-"));
  try {
    context.diagnostic("Establishing current-user directory ACL");
    await secureWindowsExport(directory, true);
    context.diagnostic("Directory ACL verified; creating empty synthetic file");
    const path = join(directory, "synthetic.json");
    const handle = await files.open(path, "wx", 0o600);
    try {
      context.diagnostic("Verifying inherited file ACL before writing synthetic data");
      await secureWindowsExport(path, false);
      await handle.writeFile("{}\n", "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    assert.equal(await files.readFile(path, "utf8"), "{}\n");
  } finally { await files.rm(directory, { recursive: true, force: true }); }
});

void test("exports an exact canonical envelope to a unique private file", async () => {
  const response = JSON.stringify({ data: { items: [{ id: "synthetic-1" }] }, meta: { next_cursor: "opaque" } });
  const result = await exportReadResponse(response);
  try {
    assert.equal(await files.readFile(result.path, "utf8"), `${response}\n`);
    assert.equal(result.bytes, Buffer.byteLength(response) + 1);
    if (process.platform === "win32") await secureWindowsExport(result.path, false);
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
  await secureWindowsExport(path, true, (executable, args, environment) => {
    assert.equal(executable, join(tmpdir(), "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
    assert.equal(environment.BIZYEET_EXPORT_SECURITY_PATH, path);
    assert.equal(environment.BIZYEET_EXPORT_SECURITY_CREATE, "directory");
    assert.equal(args.at(-2), "-EncodedCommand");
    assert.equal(Buffer.from(args.at(-1) ?? "", "base64").toString("utf16le").includes(path), false);
    return Promise.resolve("private");
  }, { SystemRoot: tmpdir() });
  await assert.rejects(secureWindowsExport(path, true, () => Promise.resolve("unexpected"), { SystemRoot: tmpdir() }), /could not be verified/u);
});

void test("oversized exports are rejected without creating an artifact", async (context) => {
  const mkdtemp = context.mock.fn(files.mkdtemp);
  await assert.rejects(exportReadResponse("x".repeat(1024 * 1024 + 1), { operations: { ...files, mkdtemp } }), /byte limit/u);
  assert.equal(mkdtemp.mock.callCount(), 0);
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
