import type { Token } from "marked";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";

/** Extract all plain text from a token tree. */
export function extractPlainText(tokens: Token[]): string {
  let text = "";
  for (const t of tokens) {
    const tok = t as Token & { tokens?: Token[]; text?: string };
    if (tok.tokens && Array.isArray(tok.tokens)) {
      text += extractPlainText(tok.tokens);
    } else if (typeof tok.text === "string") {
      text += tok.text;
    } else if ("raw" in t && typeof t.raw === "string") {
      text += t.raw;
    }
  }
  return text;
}

/** Measure the visual display width of a string (handles CJK, emoji, etc). */
export function visualWidth(str: string): number {
  return stringWidth(str);
}

/**
 * Force a string to exactly `width` visual columns.
 * Truncates if too wide (char-by-char to avoid splitting wide chars),
 * pads with spaces if too narrow.
 */
export function fitToWidth(str: string, width: number): string {
  const w = visualWidth(str);
  if (w === width) return str;
  if (w > width) {
    // Truncate character by character to avoid splitting wide chars
    let result = "";
    let resultWidth = 0;
    for (const ch of str) {
      const chW = visualWidth(ch);
      if (resultWidth + chW > width) break;
      result += ch;
      resultWidth += chW;
    }
    // Fill any remaining gap (e.g. wide char didn't fit, left 1 col)
    return result + " ".repeat(width - resultWidth);
  }
  return str + " ".repeat(width - w);
}

/**
 * Word-wrap plain text extracted from tokens into lines of at most `width`
 * visual columns. Uses `wrap-ansi` for wrapping, then force-clamps each line
 * to exactly `width` with `fitToWidth` to eliminate measurement mismatches.
 */
export function wrapPlainTextLines(tokens: Token[], width: number): string[] {
  // Collapse newlines/tabs to spaces — cell text should be a continuous paragraph
  const full = extractPlainText(tokens).replace(/[\n\r\t]+/g, " ");
  if (visualWidth(full) <= width) return [full];

  const wrapped = wrapAnsi(full, width, { hard: true, trim: true, wordWrap: true });
  const lines = wrapped.split("\n").filter((l) => l.length > 0);
  return lines.length > 0 ? lines : [""];
}

/**
 * Center a string within `width` visual columns.
 * Truncates if too wide, pads with spaces on both sides if too narrow.
 */
export function centerToWidth(str: string, width: number): string {
  const w = visualWidth(str);
  if (w >= width) return fitToWidth(str, width);
  const leftPad = Math.floor((width - w) / 2);
  return fitToWidth(" ".repeat(leftPad) + str, width);
}

/** Measure the visual display width of plain text in a token tree. */
export function plainTextLength(tokens: Token[]): number {
  return visualWidth(extractPlainText(tokens));
}
