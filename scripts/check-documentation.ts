import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { isCliEntrypoint } from "../src/cli.js";

type Token = Readonly<Record<string, unknown>>;
export type DocumentationFinding = Readonly<{ file: string; reason: string }>;

const tokens = (value: unknown): readonly Token[] => {
  if (Array.isArray(value)) return value.flatMap((item: unknown) => tokens(item));
  if (typeof value !== "object" || value === null) return [];
  const token = value as Token;
  return [token, ...Object.values(token).flatMap(tokens)];
};

const localLinkError = (file: string, href: string, files: ReadonlySet<string>): string | undefined => {
  if (/^(?:https?:\/\/|mailto:)/iu.test(href)) return URL.canParse(href) ? undefined : "Malformed external documentation URL.";
  if (/^[a-z][a-z0-9+.-]*:|^\/\//iu.test(href)) return "Unsupported documentation link scheme.";
  const path = href.split(/[?#]/u)[0] ?? "";
  try {
    const decoded = decodeURIComponent(path);
    if (decoded.includes("\\") || decoded.includes("\0")) return "Invalid repository link path.";
    const target = decoded === "" ? file : posix.normalize(posix.join(posix.dirname(file), decoded));
    if (decoded.startsWith("/") || target === ".." || target.startsWith("../")) return "Repository link escapes the source tree.";
    const directory = target.replace(/\/$/u, "");
    return files.has(target) || directory === "." || [...files].some((candidate): boolean => candidate.startsWith(`${directory}/`))
      ? undefined : "Repository link does not name a tracked file or directory.";
  } catch {
    return "Malformed percent encoding in repository link.";
  }
};

/** Inspect Markdown destinations and examples without rendering, fetching or executing them. */
export const inspectDocumentation = (
  file: string, source: string, files: ReadonlySet<string>, scripts: ReadonlySet<string>,
): readonly DocumentationFinding[] => tokens(marked.lexer(source, { gfm: true })).flatMap((token): readonly DocumentationFinding[] => {
  if ((token.type === "link" || token.type === "image") && typeof token.href === "string") {
    const reason = localLinkError(file, token.href, files);
    return reason === undefined ? [] : [{ file, reason }];
  }
  if (token.type !== "code" && token.type !== "codespan") return [];
  if (typeof token.text !== "string") return [];
  if (token.type === "code" && token.lang === "json") {
    try { JSON.parse(token.text); return []; }
    catch { return [{ file, reason: "JSON example is not valid JSON." }]; }
  }
  if (token.type === "code" && token.lang !== undefined && (typeof token.lang !== "string" || !["sh", "bash", "shell", "console"].includes(token.lang))) return [];
  return [...token.text.matchAll(/\bnpm run ([a-zA-Z0-9:_-]+)/gu)].flatMap((match): readonly DocumentationFinding[] =>
    scripts.has(match[1] ?? "") ? [] : [{ file, reason: "Documented npm run command is absent from package.json." }]);
});

const publicMarkdown = (file: string): boolean => /^(?:[^/]+\.md|docs\/.*\.md)$/u.test(file);
const readDocument = (root: string, file: string): string => {
  const path = resolve(root, file);
  const canonical = realpathSync(path);
  const inside = relative(root, canonical);
  const stat = lstatSync(path);
  if (isAbsolute(inside) || inside === ".." || inside.startsWith("../") || inside.startsWith("..\\") || stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024 * 1024) {
    throw new Error(`Documentation must be a regular in-repository file of at most 1 MiB: ${file}`);
  }
  return readFileSync(path, "utf8");
};

/** Check tracked public Markdown and package scripts from a repository root. */
export const checkDocumentation = (directory: string): readonly DocumentationFinding[] => {
  const root = realpathSync(directory);
  const files = new Set(execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }).split("\0").filter(Boolean));
  const metadata: unknown = JSON.parse(readDocument(root, "package.json"));
  if (typeof metadata !== "object" || metadata === null || !("scripts" in metadata) || typeof metadata.scripts !== "object" || metadata.scripts === null || Array.isArray(metadata.scripts) || Object.values(metadata.scripts).some((value: unknown): boolean => typeof value !== "string")) {
    throw new Error("package.json must declare scripts.");
  }
  const scripts = new Set(Object.keys(metadata.scripts));
  return [...files].filter(publicMarkdown).flatMap((file) => inspectDocumentation(file, readDocument(root, file), files, scripts));
};

if (isCliEntrypoint(process.argv[1], realpathSync, fileURLToPath(import.meta.url))) {
  const findings = checkDocumentation(process.cwd());
  findings.forEach((finding): void => { console.error(`${finding.file}: ${finding.reason}`); });
  console.log(`Documentation contracts: ${String(findings.length)} violation(s).`);
  process.exit(findings.length === 0 ? 0 : 1);
}
