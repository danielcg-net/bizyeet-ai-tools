import * as files from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { constants, type Stats } from "node:fs";
import { isAbsolute, join } from "node:path";
import { secureWindowsExport } from "./export-security.js";

export const READ_OUTPUT_BYTE_LIMIT = 32 * 1024;
export type ReadExport = Readonly<{ path: string; bytes: number }>;
type ExportHandle = Pick<files.FileHandle, "writeFile" | "sync" | "close"> & Readonly<{ stat: () => Promise<Stats> }>;
type ExportOperations = Pick<typeof files, "mkdtemp" | "lstat" | "rm"> & Readonly<{
  open: (path: string, flags: number, mode: number) => Promise<ExportHandle>;
}>;
type ExportOptions = Readonly<{
  operations?: ExportOperations;
  platform?: NodeJS.Platform;
  temporaryRoot?: string;
  secureWindows?: typeof secureWindowsExport;
}>;

/** Write one bounded canonical read envelope, never a client/session object. */
export const exportReadResponse = async (serialized: string, options: ExportOptions = {}): Promise<ReadExport> => {
  const operations = options.operations ?? files;
  const platform = options.platform ?? process.platform;
  const windowsSecurity = options.secureWindows ?? secureWindowsExport;
  const content = `${serialized}\n`;
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > 1024 * 1024 + 1) throw new Error("Read export exceeds the response byte limit.");
  const temporaryRoot = options.temporaryRoot ?? tmpdir();
  if (!isAbsolute(temporaryRoot) || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(temporaryRoot)) throw new Error("Read export requires a safe absolute temporary directory.");
  const directory = await operations.mkdtemp(join(temporaryRoot, "bizyeet-export-"));
  const path = join(directory, `${randomUUID()}.json`);
  try {
    if (platform === "win32") await windowsSecurity(directory, true);
    const directoryStat = await operations.lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()
      || (platform !== "win32" && (directoryStat.uid !== process.getuid?.() || (directoryStat.mode & 0o077) !== 0))) throw new Error("Unsafe export directory.");
    const handle = await operations.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (platform === "win32" ? 0 : constants.O_NOFOLLOW), 0o600);
    try {
      const status = await handle.stat();
      if (!status.isFile() || status.nlink !== 1 || (platform !== "win32" && (status.uid !== process.getuid?.() || (status.mode & 0o077) !== 0))) throw new Error("Unsafe export file.");
      if (platform === "win32") await windowsSecurity(path, false);
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    return { path, bytes };
  } catch {
    // The entire newly created directory is owned by this export operation.
    try { await operations.rm(directory, { recursive: true, force: true }); }
    catch { throw new Error("Read export failed and cleanup could not be confirmed. Inspect private export directories before continuing."); }
    throw new Error("Read export failed. No response data was printed; check local storage protection before retrying.");
  }
};
