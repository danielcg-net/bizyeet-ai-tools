import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import parseShell from "shell-quote/parse.js";
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

type ShellLineState = Readonly<{ quote: "single" | "double" | "none"; escaped: boolean; comment: boolean; boundary: boolean; descriptorDigits: number; text: string }>;

// shell-quote ignores newlines and treats a comment as the rest of its input.
// Separate physical command lines, but retain quoted newlines and join escaped
// continuations. NUL is reserved for our boundaries and dynamic-value sentinel.
const shellLines = (source: string, bashExample: boolean): readonly string[] => {
  if (source.includes("\0")) throw new Error("NUL is not supported in shell examples.");
  const initial: ShellLineState = { quote: "none", escaped: false, comment: false, boundary: true, descriptorDigits: 0, text: "" };
  const completed = Array.from(source.replace(/\r\n/gu, "\n")).reduce<ShellLineState>((state, character) => {
    if (state.escaped) return character === "\n" ? { ...state, escaped: false }
      : { ...state, escaped: false, boundary: false, descriptorDigits: 0, text: `${state.text}\\${character}` };
    if (state.comment) return character === "\n"
      ? { ...initial, text: `${state.text}\0` } : { ...state, text: state.text + character };
    if (character === "\\" && state.quote !== "single") return { ...state, escaped: true };
    if (character === "'" && state.quote !== "double") return { ...state, boundary: false, descriptorDigits: 0,
      quote: state.quote === "single" ? "none" : "single", text: state.text + character };
    if (character === '"' && state.quote !== "single") return { ...state, boundary: false, descriptorDigits: 0,
      quote: state.quote === "double" ? "none" : "double", text: state.text + character };
    if (state.quote !== "none") return { ...state, text: state.text + character };
    if (character === "\n") return { ...initial, text: `${state.text}\0` };
    // Drop only an unquoted all-digit word immediately adjacent to a redirect:
    // 2>out is a descriptor, while "2">out and 2 >out have a script operand 2.
    const redirectDescriptor = state.descriptorDigits > 0 && (character === ">" || character === "<");
    // shell-quote splits Bash &> / &>> into a background boundary and redirect.
    // Normalize only adjacent unquoted/unescaped syntax, never a literal '&' or &&.
    const combinedOutput = bashExample && character === ">" && state.boundary && state.text.endsWith("&") && !state.text.endsWith("&&");
    const prefix = combinedOutput ? state.text.slice(0, -1)
      : redirectDescriptor ? state.text.slice(0, -state.descriptorDigits) : state.text;
    const literal = character === "#" && !state.boundary ? "\\#" : character;
    return { ...state, comment: character === "#" && state.boundary,
      descriptorDigits: /[0-9]/u.test(character) && (state.boundary || state.descriptorDigits > 0) ? state.descriptorDigits + 1 : 0,
      boundary: /[\s;|&()<>]/u.test(character), text: prefix + literal };
  }, initial);
  if (completed.quote !== "none" || completed.escaped) throw new Error("Incomplete shell example.");
  return completed.text.split("\0");
};

type ShellWord = ReturnType<typeof parseShell>[number];
type OperandState = Readonly<{ found: boolean; target: boolean; operand: ShellWord | undefined }>;
const scriptOperand = (words: readonly ShellWord[]): ShellWord | undefined => {
  const initial: OperandState = { found: false, target: false, operand: undefined };
  const selected = words.reduce<OperandState>((state, word) => {
    if (state.found) return state;
    if (state.target) return typeof word === "string" || ("op" in word && word.op === "glob")
      ? initial : { found: true, target: false, operand: "\0invalid redirect\0" };
    if (typeof word === "object") {
      if ("comment" in word || ("op" in word && [";", ";;", "&&", "||", "|", "|&", "&", ")"].includes(word.op))) return { ...initial, found: true };
      if ("op" in word && [">", ">>", ">&", "<", "<&", "<<<"].includes(word.op)) return { ...initial, target: true };
    }
    return { found: true, target: false, operand: word };
  }, initial);
  return selected.target ? "\0missing redirect target\0" : selected.operand;
};

const commandPosition = (words: readonly ShellWord[]): boolean => {
  const position = words.reduce<Readonly<{ command: boolean; target: boolean }>>((state, word) => {
    if (state.target) return { ...state, target: false };
    if (typeof word === "object" && "op" in word) {
      if ([";", ";;", "&&", "||", "|", "|&", "&", "("].includes(word.op)) return { command: true, target: false };
      if ([">", ">>", ">&", "<", "<&", "<<<"].includes(word.op)) return { ...state, target: true };
    }
    return { command: false, target: false };
  }, { command: true, target: false });
  return position.command && !position.target;
};

const scriptFindings = (file: string, source: string, scripts: ReadonlySet<string>, consoleExample: boolean, bashExample: boolean): readonly DocumentationFinding[] => {
  if (!/\bnpm\b/u.test(source)) return [];
  try {
    // Preserve expansions as an impossible literal operand, never read the
    // process environment or allow an unset suffix to become a valid prefix.
    return shellLines(source, bashExample).flatMap((line): readonly DocumentationFinding[] => {
      const words = parseShell(consoleExample ? line.replace(/^\s*\$\s+/u, "") : line, () => "\0dynamic\0");
      return words.flatMap((word, index): readonly DocumentationFinding[] => {
        if (word !== "npm" || words[index + 1] !== "run" || !commandPosition(words.slice(0, index))) return [];
        const operand = scriptOperand(words.slice(index + 2));
        // Bare npm run lists available scripts; prose also names this command.
        if (operand === undefined) return [];
        return typeof operand === "string" && !operand.includes("\0") && scripts.has(operand)
          ? [] : [{ file, reason: "Documented npm run command is absent from package.json or is not a literal script name." }];
      });
    });
  } catch {
    return [{ file, reason: "Cannot tokenize documented npm command without shell evaluation." }];
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
  const language = typeof token.lang === "string" ? token.lang.trim().split(/\s+/u)[0]?.toLowerCase() : undefined;
  if (token.type === "code" && language === "json") {
    try { JSON.parse(token.text); return []; }
    catch { return [{ file, reason: "JSON example is not valid JSON." }]; }
  }
  if (token.type === "code" && language !== undefined && !["sh", "bash", "shell", "console"].includes(language)) return [];
  return scriptFindings(file, token.text, scripts, language === "console", language === "bash");
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
