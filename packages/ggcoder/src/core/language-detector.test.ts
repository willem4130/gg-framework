import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectLanguages,
  isStrictSuperset,
  languagesToSortedArray,
  type LanguageId,
} from "./language-detector.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lang-detect-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function touch(rel: string): void {
  const full = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, "");
}

describe("detectLanguages", () => {
  it("returns an empty set for an empty directory", () => {
    expect(detectLanguages(tmpDir).size).toBe(0);
  });

  it("detects TypeScript via tsconfig.json", () => {
    touch("tsconfig.json");
    touch("package.json");
    const detected = detectLanguages(tmpDir);
    expect(detected.has("typescript")).toBe(true);
    // JS is suppressed when TS is present
    expect(detected.has("javascript")).toBe(false);
  });

  it("detects JavaScript only when no tsconfig", () => {
    touch("package.json");
    const detected = detectLanguages(tmpDir);
    expect(detected.has("javascript")).toBe(true);
    expect(detected.has("typescript")).toBe(false);
  });

  it("detects Python via pyproject.toml", () => {
    touch("pyproject.toml");
    expect(detectLanguages(tmpDir).has("python")).toBe(true);
  });

  it("detects Go via go.mod", () => {
    touch("go.mod");
    expect(detectLanguages(tmpDir).has("go")).toBe(true);
  });

  it("detects Rust via Cargo.toml", () => {
    touch("Cargo.toml");
    expect(detectLanguages(tmpDir).has("rust")).toBe(true);
  });

  it("detects multiple languages in a polyglot repo", () => {
    touch("package.json");
    touch("tsconfig.json");
    touch("pyproject.toml");
    touch("Cargo.toml");
    const detected = detectLanguages(tmpDir);
    expect(detected.has("typescript")).toBe(true);
    expect(detected.has("python")).toBe(true);
    expect(detected.has("rust")).toBe(true);
    expect(detected.has("javascript")).toBe(false); // suppressed by TS
  });

  it("detects extension-only languages (C, SQL, Bash)", () => {
    touch("script.sh");
    touch("query.sql");
    touch("main.c");
    const detected = detectLanguages(tmpDir);
    expect(detected.has("bash")).toBe(true);
    expect(detected.has("sql")).toBe(true);
    expect(detected.has("c")).toBe(true);
  });

  it("prefers C++ over C when .cpp sources exist alongside headers", () => {
    touch("src/main.cpp");
    touch("src/util.h");
    const detected = detectLanguages(tmpDir);
    expect(detected.has("cpp")).toBe(true);
    expect(detected.has("c")).toBe(false);
  });

  it("does not crash on unreadable subdirs", () => {
    touch("tsconfig.json");
    // Pretend `src/` exists but is unreadable — just don't create it.
    expect(() => detectLanguages(tmpDir)).not.toThrow();
  });
});

describe("isStrictSuperset", () => {
  it("returns true when next has all of prev plus more", () => {
    const prev = new Set<LanguageId>(["typescript"]);
    const next = new Set<LanguageId>(["typescript", "python"]);
    expect(isStrictSuperset(next, prev)).toBe(true);
  });

  it("returns false when sets are equal", () => {
    const a = new Set<LanguageId>(["typescript", "python"]);
    const b = new Set<LanguageId>(["typescript", "python"]);
    expect(isStrictSuperset(a, b)).toBe(false);
  });

  it("returns false when next is missing a member of prev", () => {
    const prev = new Set<LanguageId>(["typescript", "python"]);
    const next = new Set<LanguageId>(["typescript", "rust"]);
    expect(isStrictSuperset(next, prev)).toBe(false);
  });

  it("returns false when next is smaller", () => {
    const prev = new Set<LanguageId>(["typescript", "python"]);
    const next = new Set<LanguageId>(["typescript"]);
    expect(isStrictSuperset(next, prev)).toBe(false);
  });
});

describe("languagesToSortedArray", () => {
  it("returns a deterministic sorted order", () => {
    const set = new Set<LanguageId>(["rust", "typescript", "python"]);
    expect(languagesToSortedArray(set)).toEqual(["python", "rust", "typescript"]);
  });
});
