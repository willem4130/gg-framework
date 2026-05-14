import { diffLines } from "diff";

/**
 * Normalize text for fuzzy matching:
 * - Strip trailing whitespace per line
 * - Replace smart quotes with straight quotes
 * - Replace unicode dashes with hyphens
 */
function normalizeForFuzzyMatch(text: string): string {
  return text
    .replace(/[^\S\n]+$/gm, "") // trailing whitespace per line
    .replace(/[\u2018\u2019]/g, "'") // smart single quotes
    .replace(/[\u201C\u201D]/g, '"') // smart double quotes
    .replace(/[\u2013\u2014]/g, "-"); // en/em dashes
}

/**
 * Find text in content, trying exact match first then fuzzy.
 */
export function fuzzyFindText(
  content: string,
  oldText: string,
): { found: boolean; index: number; matchLength: number; usedFuzzy: boolean } {
  // Exact match first
  const exactIndex = content.indexOf(oldText);
  if (exactIndex !== -1) {
    return { found: true, index: exactIndex, matchLength: oldText.length, usedFuzzy: false };
  }

  // Fuzzy match: normalize both sides
  const normalizedContent = normalizeForFuzzyMatch(content);
  const normalizedOld = normalizeForFuzzyMatch(oldText);

  const fuzzyIndex = normalizedContent.indexOf(normalizedOld);
  if (fuzzyIndex !== -1) {
    // Map back to original content: find the actual length in original
    // Since normalization only changes per-character substitutions and trailing whitespace,
    // we need to find the original range.
    // Strategy: match line by line to find the original span.
    const normalizedBefore = normalizedContent.slice(0, fuzzyIndex);
    const linesBefore = normalizedBefore.split("\n").length - 1;
    const normalizedMatch = normalizedContent.slice(fuzzyIndex, fuzzyIndex + normalizedOld.length);
    const matchLineCount = normalizedMatch.split("\n").length;

    const contentLines = content.split("\n");
    const matchLines = contentLines.slice(linesBefore, linesBefore + matchLineCount);
    const originalMatch = matchLines.join("\n");

    // Find actual index of the first match line start
    let actualIndex = 0;
    for (let i = 0; i < linesBefore; i++) {
      actualIndex += contentLines[i].length + 1; // +1 for \n
    }

    return {
      found: true,
      index: actualIndex,
      matchLength: originalMatch.length,
      usedFuzzy: true,
    };
  }

  return { found: false, index: -1, matchLength: 0, usedFuzzy: false };
}

/**
 * Count occurrences of oldText in content (exact first, then fuzzy).
 */
export function countOccurrences(content: string, oldText: string): number {
  // Try exact first
  let count = 0;
  let pos = 0;
  while ((pos = content.indexOf(oldText, pos)) !== -1) {
    count++;
    pos += oldText.length;
  }
  if (count > 0) return count;

  // Fuzzy count
  const normalizedContent = normalizeForFuzzyMatch(content);
  const normalizedOld = normalizeForFuzzyMatch(oldText);
  pos = 0;
  while ((pos = normalizedContent.indexOf(normalizedOld, pos)) !== -1) {
    count++;
    pos += normalizedOld.length;
  }
  return count;
}

function tokenize(line: string): string[] {
  return line
    .split(/[^A-Za-z0-9_]+/)
    .filter((t) => t.length >= 2)
    .map((t) => t.toLowerCase());
}

/**
 * When old_text isn't found, locate up to `maxResults` lines in `content` with
 * the highest token-overlap to the first non-empty line of `oldText` and
 * return ±contextLines around each as numbered snippets, joined by `---`.
 * Returns null if there's no plausible match (no shared tokens at all).
 * Cuts retry loops by showing the model what's actually in the file at the
 * expected location(s) — multiple results help disambiguate when several
 * regions look similar (e.g. repeated function bodies).
 */
export function findClosestSnippet(
  content: string,
  oldText: string,
  contextLines = 3,
  maxResults = 3,
): string | null {
  const oldFirstLine = oldText.split("\n").find((l) => l.trim().length > 0);
  if (!oldFirstLine) return null;
  const oldTokens = new Set(tokenize(oldFirstLine));
  if (oldTokens.size === 0) return null;

  const lines = content.split("\n");
  const candidates: { line: number; score: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineTokens = tokenize(lines[i]);
    if (lineTokens.length === 0) continue;
    let overlap = 0;
    for (const t of lineTokens) if (oldTokens.has(t)) overlap++;
    if (overlap > 0) candidates.push({ line: i, score: overlap });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score || a.line - b.line);
  const bestScore = candidates[0].score;
  // Drop candidates that are dramatically weaker than the best match —
  // keeps the snippet focused instead of dumping the whole file.
  const minScore = Math.max(1, Math.ceil(bestScore / 3));
  const top = candidates.filter((c) => c.score >= minScore).slice(0, maxResults);

  // Render in source order so line numbers ascend down the snippet.
  top.sort((a, b) => a.line - b.line);

  const renderRange = (centerLine: number): string => {
    const start = Math.max(0, centerLine - contextLines);
    const end = Math.min(lines.length, centerLine + contextLines + 1);
    return lines
      .slice(start, end)
      .map((l, i) => `${String(start + i + 1).padStart(6, " ")}\t${l}`)
      .join("\n");
  };

  return top.map((c) => renderRange(c.line)).join("\n---\n");
}

/**
 * Locate every occurrence of `text` in `content` and return the 1-indexed line
 * number plus a trimmed preview of that line. Tries exact first, then the same
 * fuzzy normalization as `countOccurrences` so the line numbers match what the
 * caller saw in `countOccurrences`. Capped at `max` so error messages stay
 * compact when a token like `}` matches dozens of times.
 */
export function findOccurrenceLines(
  content: string,
  text: string,
  max = 6,
): { line: number; preview: string }[] {
  const collectOffsets = (haystack: string, needle: string): number[] => {
    if (!needle) return [];
    const offsets: number[] = [];
    let pos = 0;
    while ((pos = haystack.indexOf(needle, pos)) !== -1) {
      offsets.push(pos);
      pos += needle.length;
    }
    return offsets;
  };

  let source = content;
  let offsets = collectOffsets(content, text);
  if (offsets.length === 0) {
    source = normalizeForFuzzyMatch(content);
    offsets = collectOffsets(source, normalizeForFuzzyMatch(text));
  }

  const out: { line: number; preview: string }[] = [];
  for (const offset of offsets.slice(0, max)) {
    const before = source.slice(0, offset);
    const line = before.split("\n").length;
    const lineStart = before.lastIndexOf("\n") + 1;
    const nextNewline = source.indexOf("\n", lineStart);
    const lineText = source.slice(lineStart, nextNewline === -1 ? undefined : nextNewline);
    out.push({ line, preview: lineText.trim() });
  }
  return out;
}

/**
 * Generate a unified diff string.
 */
export function generateDiff(oldContent: string, newContent: string, filePath: string): string {
  const changes = diffLines(oldContent, newContent);
  const lines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  for (const change of changes) {
    const prefix = change.added ? "+" : change.removed ? "-" : " ";
    const changeLines = change.value.replace(/\n$/, "").split("\n");
    for (const line of changeLines) {
      lines.push(`${prefix}${line}`);
    }
  }

  return lines.join("\n");
}
