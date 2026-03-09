export const MAX_LINES = 500;
export const MAX_CHARS = 100_000; // ~25,000 tokens at ~4 chars/token

export interface TruncateResult {
  content: string;
  truncated: boolean;
  totalLines: number;
  keptLines: number;
}

/**
 * Truncate from the end — keep the first N lines.
 * Used by the read tool.
 */
export function truncateHead(
  content: string,
  maxLines = MAX_LINES,
  maxChars = MAX_CHARS,
): TruncateResult {
  const lines = content.split("\n");
  const totalLines = lines.length;

  // Limit by line count
  let kept = lines.slice(0, maxLines);

  // Limit by character count
  let size = 0;
  let cutIndex = kept.length;
  for (let i = 0; i < kept.length; i++) {
    size += kept[i].length + 1; // +1 for newline
    if (size > maxChars) {
      cutIndex = i;
      break;
    }
  }
  kept = kept.slice(0, cutIndex);

  const truncated = kept.length < totalLines;
  return {
    content: kept.join("\n"),
    truncated,
    totalLines,
    keptLines: kept.length,
  };
}

/**
 * Truncate from the beginning — keep the last N lines.
 * Used by the bash tool.
 */
export function truncateTail(
  content: string,
  maxLines = MAX_LINES,
  maxChars = MAX_CHARS,
): TruncateResult {
  const lines = content.split("\n");
  const totalLines = lines.length;

  // Limit by line count — keep last N
  let kept = lines.slice(-maxLines);

  // Limit by character count — keep last N chars
  let size = 0;
  let cutIndex = 0;
  for (let i = kept.length - 1; i >= 0; i--) {
    size += kept[i].length + 1;
    if (size > maxChars) {
      cutIndex = i + 1;
      break;
    }
  }
  kept = kept.slice(cutIndex);

  const truncated = kept.length < totalLines;
  return {
    content: kept.join("\n"),
    truncated,
    totalLines,
    keptLines: kept.length,
  };
}
