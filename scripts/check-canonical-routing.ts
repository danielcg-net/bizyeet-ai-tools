import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { isCliEntrypoint } from "../src/cli.js";

export type RoutingViolation = Readonly<{ file: string; line: number; reason: string }>;
const providerImport = /(?:^|\/)(?:crm-ledger|crm-leads|zoho-crm|zoho-invoice|airtable)(?:[/.]|$)/i;
const providerUrl = /(?:https?:)?\/\/[^/]*(?:zohoapis\.[a-z.]+|api\.airtable\.com)(?:[/:]|$)/i;
const privateEndpoint = /\/api\/(?:dashboard\/crm|(?:dashboard\/)?(?:zoho|airtable))(?:[/?#]|$)/i;
const nodes = (node: ts.Node, source: ts.SourceFile): readonly ts.Node[] =>
  [node, ...node.getChildren(source).flatMap((child) => nodes(child, source))];

const textValue = (node: ts.Node, declarations: readonly ts.VariableDeclaration[], depth = 0): string | undefined => {
  if (depth > 20) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return textValue(node.expression, declarations, depth + 1);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = textValue(node.left, declarations, depth + 1);
    const right = textValue(node.right, declarations, depth + 1);
    return left === undefined && right === undefined ? undefined : `${left ?? "{dynamic}"}${right ?? "{dynamic}"}`;
  }
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span) =>
    `${textValue(span.expression, declarations, depth + 1) ?? "{dynamic}"}${span.literal.text}`).join("");
  if (ts.isIdentifier(node)) {
    const matches = declarations.filter((item) => ts.isIdentifier(item.name) && item.name.text === node.text);
    const initializer = matches.length === 1 ? matches[0]?.initializer : undefined;
    return initializer ? textValue(initializer, declarations, depth + 1) : undefined;
  }
  return undefined;
};

/** Inspect code, never execute it; comments and negative test fixtures are not runtime edges. */
export const inspectRouting = (file: string, code: string): readonly RoutingViolation[] => {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const all = nodes(source, source);
  const declarations = all.filter(ts.isVariableDeclaration);
  const findings = all.flatMap((node): readonly RoutingViolation[] => {
    const value = textValue(node, declarations);
    if (value === undefined) return [];
    const importNode = (
      ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent) ||
      (ts.isCallExpression(node.parent) && (node.parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.parent.expression) && node.parent.expression.text === "require")))
    );
    const reason = importNode && providerImport.test(value) ? "Provider/storage imports are private to the server canonical service."
      : providerUrl.test(value) || privateEndpoint.test(value) ? "Use OAuth canonical agent endpoints; provider and dashboard CRM URLs bypass that contract." : undefined;
    return reason ? [{ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, reason }] : [];
  });
  return findings.filter((finding, index) => findings.findIndex((other) => other.line === finding.line && other.reason === finding.reason) === index);
};

const sourceFiles = (directory: string): readonly string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? sourceFiles(path) : /\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
});

/** Check all shipped sources and executable scripts, with one exact checker self-exclusion. */
export const checkRepository = (root: string): readonly RoutingViolation[] => ["src", "scripts"].flatMap((directory) =>
  sourceFiles(join(root, directory)).filter((file) => relative(root, file) !== "scripts/check-canonical-routing.ts")
    .flatMap((file) => inspectRouting(relative(root, file), readFileSync(file, "utf8"))));

if (isCliEntrypoint(process.argv[1], realpathSync, fileURLToPath(import.meta.url))) {
  const findings = checkRepository(process.cwd());
  findings.forEach((finding) => { console.error(`${finding.file}:${String(finding.line)} ${finding.reason}`); });
  console.log(`Canonical routing boundary: ${String(findings.length)} violation(s).`);
  process.exit(findings.length === 0 ? 0 : 1);
}
