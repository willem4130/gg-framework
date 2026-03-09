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
