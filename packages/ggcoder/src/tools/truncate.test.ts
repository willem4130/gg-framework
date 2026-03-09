import { describe, it, expect } from "vitest";
import { truncateHead, truncateTail } from "./truncate.js";

// ── truncateHead ───────────────────────────────────────────

describe("truncateHead", () => {
  it("returns content unchanged when within limits", () => {
    const content = "line1\nline2\nline3";
    const result = truncateHead(content);
    expect(result.truncated).toBe(false);
    expect(result.content).toBe(content);
    expect(result.totalLines).toBe(3);
    expect(result.keptLines).toBe(3);
  });

  it("truncates by line count", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i}`);
    const content = lines.join("\n");
    const result = truncateHead(content, 5);
    expect(result.truncated).toBe(true);
    expect(result.keptLines).toBe(5);
    expect(result.totalLines).toBe(10);
    expect(result.content).toBe(lines.slice(0, 5).join("\n"));
  });

  it("truncates by character count", () => {
    // 5 lines of 10 chars each + 4 newlines = 54 chars
    const lines = Array.from({ length: 5 }, () => "abcdefghij");
    const content = lines.join("\n");
    // maxChars = 25 → should keep ~2 lines (10+1+10+1 = 22 < 25, next would be 33 > 25)
    const result = truncateHead(content, 500, 25);
    expect(result.truncated).toBe(true);
    expect(result.keptLines).toBe(2);
  });

  it("handles empty content", () => {
    const result = truncateHead("");
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("");
    expect(result.totalLines).toBe(1); // split("") gives [""]
    expect(result.keptLines).toBe(1);
  });

  it("handles single line", () => {
    const result = truncateHead("hello world", 500, 100_000);
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("hello world");
  });

  it("line limit takes precedence when hit first", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `${i}`);
    const content = lines.join("\n");
    // Short lines, many of them — line limit (3) hit before char limit
    const result = truncateHead(content, 3, 100_000);
    expect(result.keptLines).toBe(3);
    expect(result.truncated).toBe(true);
  });
});

// ── truncateTail ───────────────────────────────────────────

describe("truncateTail", () => {
  it("returns content unchanged when within limits", () => {
    const content = "line1\nline2\nline3";
    const result = truncateTail(content);
    expect(result.truncated).toBe(false);
    expect(result.content).toBe(content);
    expect(result.totalLines).toBe(3);
    expect(result.keptLines).toBe(3);
  });

  it("keeps last N lines", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i}`);
    const content = lines.join("\n");
    const result = truncateTail(content, 3);
    expect(result.truncated).toBe(true);
    expect(result.keptLines).toBe(3);
    expect(result.totalLines).toBe(10);
    expect(result.content).toBe(lines.slice(7).join("\n"));
  });

  it("truncates by character count keeping tail", () => {
    const lines = Array.from({ length: 5 }, () => "abcdefghij");
    const content = lines.join("\n");
    // maxChars = 25 → keep last ~2 lines
    const result = truncateTail(content, 500, 25);
    expect(result.truncated).toBe(true);
    expect(result.keptLines).toBe(2);
    // Should contain the last 2 lines
    expect(result.content).toBe(lines.slice(3).join("\n"));
  });

  it("handles empty content", () => {
    const result = truncateTail("");
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("");
  });

  it("handles single line", () => {
    const result = truncateTail("hello world", 500, 100_000);
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("hello world");
  });

  it("line limit takes precedence when hit first", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `${i}`);
    const content = lines.join("\n");
    const result = truncateTail(content, 3, 100_000);
    expect(result.keptLines).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.content).toBe(lines.slice(97).join("\n"));
  });
});
