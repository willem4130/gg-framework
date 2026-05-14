import { describe, it, expect } from "vitest";
import {
  fuzzyFindText,
  countOccurrences,
  generateDiff,
  findClosestSnippet,
  findOccurrenceLines,
} from "./edit-diff.js";

describe("fuzzyFindText", () => {
  it("finds exact match with usedFuzzy=false", () => {
    const content = "hello world\nfoo bar\n";
    const result = fuzzyFindText(content, "foo bar");
    expect(result.found).toBe(true);
    expect(result.usedFuzzy).toBe(false);
    expect(result.index).toBe(content.indexOf("foo bar"));
    expect(result.matchLength).toBe("foo bar".length);
  });

  it("returns not found for missing text", () => {
    const content = "hello world\n";
    const result = fuzzyFindText(content, "does not exist");
    expect(result.found).toBe(false);
    expect(result.index).toBe(-1);
    expect(result.matchLength).toBe(0);
  });

  it("fuzzy matches trailing whitespace differences with usedFuzzy=true", () => {
    const content = "line one   \nline two\n";
    const search = "line one\nline two";
    const result = fuzzyFindText(content, search);
    expect(result.found).toBe(true);
    expect(result.usedFuzzy).toBe(true);
  });

  it("fuzzy matches smart quotes to straight quotes", () => {
    const content = 'She said "hello"';
    const search = "She said \u201Chello\u201D";
    const result = fuzzyFindText(content, search);
    expect(result.found).toBe(true);
    expect(result.usedFuzzy).toBe(true);
  });
});

describe("countOccurrences", () => {
  it("counts single occurrence as 1", () => {
    const content = "abc def ghi";
    expect(countOccurrences(content, "def")).toBe(1);
  });

  it("counts multiple occurrences correctly", () => {
    const content = "aaa bbb aaa ccc aaa";
    expect(countOccurrences(content, "aaa")).toBe(3);
  });

  it("returns 0 for no match", () => {
    const content = "hello world";
    expect(countOccurrences(content, "xyz")).toBe(0);
  });

  it("falls back to fuzzy count when exact is 0", () => {
    // Exact won't match because of smart quotes, fuzzy should find 1
    const contentSmartQuote = "say \u201Chi\u201D and \u201Chi\u201D";
    const searchStraight = 'say "hi"';
    // Exact won't match because of smart quotes, fuzzy should find 1
    expect(countOccurrences(contentSmartQuote, searchStraight)).toBe(1);
  });
});

describe("findClosestSnippet", () => {
  const content = [
    "import { useState } from 'react';",
    "",
    "export function Counter() {",
    "  const [count, setCount] = useState(0);",
    "  return <div>{count}</div>;",
    "}",
  ].join("\n");

  it("finds the closest line by token overlap and returns numbered context", () => {
    const snippet = findClosestSnippet(content, "const [count, setCount] = useState(1);", 1);
    expect(snippet).not.toBeNull();
    expect(snippet).toContain("useState(0)");
    // Numbered (cat -n style)
    expect(snippet).toMatch(/^\s+\d+\t/m);
  });

  it("returns null when there are no shared tokens", () => {
    const snippet = findClosestSnippet(content, "completely unrelated zzzqqq xxx");
    expect(snippet).toBeNull();
  });

  it("returns null on empty oldText", () => {
    expect(findClosestSnippet(content, "")).toBeNull();
    expect(findClosestSnippet(content, "   \n\n")).toBeNull();
  });

  it("respects contextLines", () => {
    const snippet = findClosestSnippet(content, "const [count, setCount] = useState(1);", 0);
    expect(snippet).toBe("     4\t  const [count, setCount] = useState(0);");
  });

  it("returns multiple matches separated by --- when several regions tie", () => {
    const multi = [
      "function handleClick() {",
      "  setCount(count + 1);",
      "}",
      "",
      "function handleReset() {",
      "  setCount(0);",
      "}",
      "",
      "function handleDouble() {",
      "  setCount(count * 2);",
      "}",
    ].join("\n");

    const snippet = findClosestSnippet(multi, "setCount(count - 1);", 0, 3);
    expect(snippet).not.toBeNull();
    const parts = snippet!.split("\n---\n");
    expect(parts.length).toBeGreaterThanOrEqual(2);
    // Every part should reference setCount
    for (const p of parts) expect(p).toContain("setCount");
  });

  it("keeps a single match when one candidate dominates", () => {
    const snippet = findClosestSnippet(content, "const [count, setCount] = useState(1);", 1);
    // Only line 4 has the full token set; line 1 (just `useState`) is dropped
    // by the bestScore/3 cutoff.
    expect(snippet).not.toBeNull();
    expect(snippet!.split("\n---\n")).toHaveLength(1);
  });
});

describe("findOccurrenceLines", () => {
  it("returns 1-indexed line numbers and trimmed previews for every match", () => {
    const css = [
      ".timer { color: white; }",
      ".button { color: black; }",
      ".label { color: white; }",
      ".footer { color: white; }",
    ].join("\n");

    const matches = findOccurrenceLines(css, "color: white;");
    expect(matches).toEqual([
      { line: 1, preview: ".timer { color: white; }" },
      { line: 3, preview: ".label { color: white; }" },
      { line: 4, preview: ".footer { color: white; }" },
    ]);
  });

  it("caps results at `max` so dozens of matches stay compact", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `row ${i} }`);
    const matches = findOccurrenceLines(lines.join("\n"), "}", 4);
    expect(matches).toHaveLength(4);
    expect(matches[0].line).toBe(1);
  });

  it("falls back to fuzzy matching when exact yields zero", () => {
    const content = "say “hi”";
    const matches = findOccurrenceLines(content, 'say "hi"');
    expect(matches).toHaveLength(1);
    expect(matches[0].line).toBe(1);
  });

  it("returns empty array for no matches at all", () => {
    expect(findOccurrenceLines("hello world", "missing")).toEqual([]);
  });
});

describe("generateDiff", () => {
  it("produces diff with --- a/ and +++ b/ header", () => {
    const diff = generateDiff("hello\n", "hello\nworld\n", "test.txt");
    expect(diff).toContain("--- a/test.txt");
    expect(diff).toContain("+++ b/test.txt");
  });

  it("shows removed lines with - prefix and added lines with + prefix", () => {
    const diff = generateDiff("old line\n", "new line\n", "file.ts");
    expect(diff).toContain("-old line");
    expect(diff).toContain("+new line");
  });
});
