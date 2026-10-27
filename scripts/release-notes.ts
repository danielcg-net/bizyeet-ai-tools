export const RELEASE_NOTES_BYTE_LIMIT = 65_536;
export const CHANGELOG_SOURCE_BYTE_LIMIT = 1_048_576;

/** Extract exactly one reviewed version section with stable newlines and bounded UTF-8 output. */
export const canonicalReleaseNotes = (changelog: string, version: string): string => {
  const encoder = new TextEncoder();
  if (typeof changelog !== "string" || encoder.encode(changelog).byteLength > CHANGELOG_SOURCE_BYTE_LIMIT) throw new Error("Source CHANGELOG exceeds the UTF-8 byte limit.");
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(version)) throw new Error("Invalid canonical release version.");
  const normalized = changelog.replaceAll("\r\n", "\n");
  if (normalized.includes("\r")) throw new Error("Source CHANGELOG has unsupported line endings.");
  const sections = normalized.split(/^## /mu).slice(1).filter((section) => section.startsWith(`[${version}]`));
  if (sections.length !== 1) throw new Error("Source CHANGELOG must contain exactly one target version section.");
  const section = sections[0] ?? "";
  const heading = (section.split("\n")[0] ?? "").trimEnd();
  const prefix = `[${version}] - `;
  if (!heading.startsWith(prefix) || !/^\d{4}-\d{2}-\d{2}$/u.test(heading.slice(prefix.length))) throw new Error("Source CHANGELOG target heading is not canonical.");
  const notes = `## ${section.trim()}\n`;
  if (notes.length < 50 || encoder.encode(notes).byteLength > RELEASE_NOTES_BYTE_LIMIT) throw new Error("Canonical release notes exceed the UTF-8 budget or lack substantive content.");
  return notes;
};
