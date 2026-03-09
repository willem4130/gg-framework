import { describe, it, expect } from "vitest";
import { marked, type Token } from "marked";
import {
  centerToWidth,
  extractPlainText,
  fitToWidth,
  plainTextLength,
  visualWidth,
  wrapPlainTextLines,
} from "./table-text.js";

/** Helper: lex inline markdown and return the inner tokens of the first paragraph. */
function inlineTokens(md: string): Token[] {
  const tokens = marked.lexer(md);
  const first = tokens[0];
  if (first && "tokens" in first && Array.isArray(first.tokens)) {
    return first.tokens;
  }
  return tokens;
}

// ── extractPlainText ──────────────────────────────────────

describe("extractPlainText", () => {
  it("extracts plain text from simple text tokens", () => {
    const tokens = inlineTokens("hello world");
    expect(extractPlainText(tokens)).toBe("hello world");
  });

  it("extracts text from bold/italic tokens", () => {
    const tokens = inlineTokens("hello **bold** and *italic*");
    expect(extractPlainText(tokens)).toBe("hello bold and italic");
  });

  it("extracts text from inline code", () => {
    const tokens = inlineTokens("use `npm install` here");
    expect(extractPlainText(tokens)).toBe("use npm install here");
  });
});

// ── visualWidth ───────────────────────────────────────────

describe("visualWidth", () => {
  it("returns correct width for ASCII text", () => {
    expect(visualWidth("hello")).toBe(5);
  });

  it("counts CJK characters as width 2", () => {
    expect(visualWidth("あ")).toBe(2);
    expect(visualWidth("漢字")).toBe(4);
  });

  it("handles mixed ASCII and CJK", () => {
    expect(visualWidth("hi漢字")).toBe(6); // 2 + 4
  });
});

// ── fitToWidth ────────────────────────────────────────────

describe("fitToWidth", () => {
  it("pads short strings with spaces", () => {
    const result = fitToWidth("hi", 5);
    expect(visualWidth(result)).toBe(5);
    expect(result).toBe("hi   ");
  });

  it("returns string unchanged when already exact width", () => {
    const result = fitToWidth("hello", 5);
    expect(result).toBe("hello");
  });

  it("truncates strings that are too wide", () => {
    const result = fitToWidth("hello world", 5);
    expect(visualWidth(result)).toBe(5);
    expect(result).toBe("hello");
  });

  it("handles CJK truncation without splitting wide chars", () => {
    // "漢字漢" is 6 visual cols; fitting to 5 should take "漢字" (4) + 1 space
    const result = fitToWidth("漢字漢", 5);
    expect(visualWidth(result)).toBe(5);
    expect(result).toBe("漢字 ");
  });

  it("pads CJK strings correctly", () => {
    const result = fitToWidth("漢字", 6);
    expect(visualWidth(result)).toBe(6);
    expect(result).toBe("漢字  ");
  });

  it("handles empty string", () => {
    const result = fitToWidth("", 5);
    expect(visualWidth(result)).toBe(5);
    expect(result).toBe("     ");
  });

  it("handles emoji", () => {
    const result = fitToWidth("✅ Active", 12);
    expect(visualWidth(result)).toBe(12);
  });
});

// ── centerToWidth ─────────────────────────────────────────

describe("centerToWidth", () => {
  it("centers text with space padding", () => {
    const result = centerToWidth("hi", 6);
    expect(visualWidth(result)).toBe(6);
    expect(result).toBe("  hi  ");
  });

  it("centers odd-width text with extra space on right", () => {
    const result = centerToWidth("hi", 7);
    expect(visualWidth(result)).toBe(7);
    expect(result).toBe("  hi   ");
  });

  it("truncates text wider than width", () => {
    const result = centerToWidth("hello world", 5);
    expect(visualWidth(result)).toBe(5);
  });

  it("handles exact width", () => {
    const result = centerToWidth("hello", 5);
    expect(visualWidth(result)).toBe(5);
    expect(result).toBe("hello");
  });
});

// ── plainTextLength ───────────────────────────────────────

describe("plainTextLength", () => {
  it("returns correct length for plain text", () => {
    const tokens = inlineTokens("abc");
    expect(plainTextLength(tokens)).toBe(3);
  });

  it("returns length excluding markdown formatting", () => {
    const tokens = inlineTokens("**bold**");
    expect(plainTextLength(tokens)).toBe(4); // "bold"
  });

  it("returns visual width for CJK text", () => {
    const tokens = inlineTokens("漢字");
    expect(plainTextLength(tokens)).toBe(4); // 2 chars, each width 2
  });
});

// ── wrapPlainTextLines ────────────────────────────────────

describe("wrapPlainTextLines", () => {
  it("returns single line when text fits within width", () => {
    const tokens = inlineTokens("short text");
    expect(wrapPlainTextLines(tokens, 20)).toEqual(["short text"]);
  });

  it("wraps long text at word boundaries", () => {
    const tokens = inlineTokens("the quick brown fox jumps over the lazy dog");
    const lines = wrapPlainTextLines(tokens, 20);
    for (const line of lines) {
      expect(visualWidth(line)).toBeLessThanOrEqual(20);
    }
    expect(lines.join(" ")).toContain("quick");
    expect(lines.join(" ")).toContain("lazy");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("force-breaks words longer than width", () => {
    const tokens = inlineTokens("abcdefghijklmnopqrstuvwxyz");
    const lines = wrapPlainTextLines(tokens, 10);
    expect(lines[0]).toBe("abcdefghij");
    expect(lines[1]).toBe("klmnopqrst");
    expect(lines[2]).toBe("uvwxyz");
  });

  it("handles narrow width correctly", () => {
    const tokens = inlineTokens("hello world");
    const lines = wrapPlainTextLines(tokens, 5);
    for (const line of lines) {
      expect(visualWidth(line)).toBeLessThanOrEqual(5);
    }
    expect(lines.join("")).toContain("hello");
    expect(lines.join("")).toContain("world");
  });

  it("handles text with bold/italic formatting", () => {
    const tokens = inlineTokens("this is **very important** information that wraps");
    const lines = wrapPlainTextLines(tokens, 15);
    for (const line of lines) {
      expect(visualWidth(line)).toBeLessThanOrEqual(15);
    }
    const joined = lines.join(" ");
    expect(joined).toContain("important");
    expect(joined).toContain("wraps");
  });

  it("returns single empty-ish line for empty input", () => {
    const tokens = inlineTokens("");
    const lines = wrapPlainTextLines(tokens, 10);
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it("respects visual width for CJK characters when wrapping", () => {
    const tokens = inlineTokens("漢字 ab");
    const lines = wrapPlainTextLines(tokens, 5);
    for (const line of lines) {
      expect(visualWidth(line)).toBeLessThanOrEqual(5);
    }
    const joined = lines.join("");
    expect(joined).toContain("漢字");
    expect(joined).toContain("ab");
  });

  it("force-breaks CJK text that exceeds width", () => {
    const tokens = inlineTokens("漢字漢字漢字");
    const lines = wrapPlainTextLines(tokens, 5);
    for (const line of lines) {
      expect(visualWidth(line)).toBeLessThanOrEqual(5);
    }
    expect(lines.join("")).toBe("漢字漢字漢字");
  });

  it("preserves all content when wrapping a table cell description", () => {
    const longDescription =
      "This is a very long description that would normally cause a table to overflow beyond the terminal width and deform the layout";
    const tokens = inlineTokens(longDescription);
    const lines = wrapPlainTextLines(tokens, 30);

    for (const line of lines) {
      expect(visualWidth(line)).toBeLessThanOrEqual(30);
    }

    const reconstructed = lines.join(" ");
    for (const word of longDescription.split(" ")) {
      expect(reconstructed).toContain(word);
    }
  });

  it("every wrapped line fits after fitToWidth clamping", () => {
    const tokens = inlineTokens(
      "Provides a centralized Next.js dashboard with live-updating cards showing account statuses, recent automation activity, error logs, and per-platform engagement metrics at a glance.",
    );
    const width = 40;
    const lines = wrapPlainTextLines(tokens, width);
    for (const line of lines) {
      const fitted = fitToWidth(line, width);
      expect(visualWidth(fitted)).toBe(width);
    }
  });
});
