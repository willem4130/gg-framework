import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./system-prompt.js";
import type { LanguageId } from "./core/language-detector.js";

const tempDirs: string[] = [];

async function makeProject(files: Record<string, string> = {}): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "ggcoder-system-prompt-"));
  tempDirs.push(cwd);
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(cwd, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  }
  return cwd;
}

function sectionIndex(prompt: string, heading: string): number {
  const index = prompt.indexOf(heading);
  expect(index, `${heading} should exist`).toBeGreaterThanOrEqual(0);
  return index;
}

function toolsSection(prompt: string): string {
  const start = sectionIndex(prompt, "## Tools");
  const rest = prompt.slice(start);
  const next = rest.indexOf("\n\n## ", "## Tools".length);
  return next === -1 ? rest : rest.slice(0, next);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("buildSystemPrompt", () => {
  it("renders deterministic section order and keeps only the volatile date after the marker", async () => {
    const cwd = await makeProject({
      "CLAUDE.md": "Project rules win.",
      "package.json": JSON.stringify({ scripts: { check: "tsc --noEmit" } }),
      "tsconfig.json": "{}",
    });

    const prompt = await buildSystemPrompt(
      cwd,
      [{ name: "find-skills", description: "Find skills.", content: "", source: "test" }],
      false,
      undefined,
      ["read", "edit", "web_search", "enter_plan", "exit_plan", "skill"],
      new Set<LanguageId>(["typescript"]),
    );

    expect(prompt.startsWith("You are GG Coder by Ken Kai")).toBe(true);
    expect(sectionIndex(prompt, "## How to Talk")).toBeLessThan(
      sectionIndex(prompt, "## How to Work"),
    );
    expect(sectionIndex(prompt, "## How to Work")).toBeLessThan(
      sectionIndex(prompt, "## Research & Verification"),
    );
    expect(sectionIndex(prompt, "## Research & Verification")).toBeLessThan(
      sectionIndex(prompt, "## Code Quality"),
    );
    expect(sectionIndex(prompt, "## Code Quality")).toBeLessThan(sectionIndex(prompt, "## Tools"));
    expect(sectionIndex(prompt, "## Tools")).toBeLessThan(
      sectionIndex(prompt, "## Project Context"),
    );
    expect(sectionIndex(prompt, "## Project Context")).toBeLessThan(
      sectionIndex(prompt, "## Language Style Packs"),
    );
    expect(sectionIndex(prompt, "## Language Style Packs")).toBeLessThan(
      sectionIndex(prompt, "## Verification"),
    );
    expect(sectionIndex(prompt, "## Verification")).toBeLessThan(sectionIndex(prompt, "## Skills"));
    expect(sectionIndex(prompt, "## Skills")).toBeLessThan(sectionIndex(prompt, "## Environment"));

    const marker = "<!-- uncached -->";
    expect(prompt.match(new RegExp(marker, "g"))).toHaveLength(1);
    const afterMarker = prompt.slice(prompt.indexOf(marker) + marker.length).trim();
    expect(afterMarker).toMatch(/^Today's date: \d{1,2} [A-Za-z]+ \d{4}$/);
  });

  it("lists exactly available known tools and hides unavailable plan transition tools", async () => {
    const cwd = await makeProject();

    const normalPrompt = await buildSystemPrompt(cwd, undefined, false, undefined, [
      "read",
      "web_search",
      "exit_plan",
      "not_a_tool",
    ]);
    const normalTools = toolsSection(normalPrompt);
    expect(normalTools).toContain("**read**");
    expect(normalTools).toContain("**web_search**");
    expect(normalTools).not.toContain("**exit_plan**");
    expect(normalTools).not.toContain("not_a_tool");
    expect(normalTools).not.toContain("**edit**");

    const planPrompt = await buildSystemPrompt(cwd, undefined, true, undefined, [
      "read",
      "enter_plan",
      "exit_plan",
    ]);
    const planTools = toolsSection(planPrompt);
    expect(planTools).toContain("**read**");
    expect(planTools).toContain("**exit_plan**");
    expect(planTools).not.toContain("**enter_plan**");
  });

  it("places project-context precedence next to project context before style packs", async () => {
    const cwd = await makeProject({
      "AGENTS.md": "Use tabs for this fixture.",
      "tsconfig.json": "{}",
    });

    const prompt = await buildSystemPrompt(
      cwd,
      undefined,
      false,
      undefined,
      ["read"],
      new Set<LanguageId>(["typescript"]),
    );

    const projectContextIndex = sectionIndex(prompt, "## Project Context");
    const precedenceIndex = prompt.indexOf("**Highest precedence**", projectContextIndex);
    expect(precedenceIndex).toBeGreaterThan(projectContextIndex);
    expect(precedenceIndex).toBeLessThan(sectionIndex(prompt, "### AGENTS.md"));
    expect(sectionIndex(prompt, "## Project Context")).toBeLessThan(
      sectionIndex(prompt, "## Language Style Packs"),
    );
    expect(prompt).toContain("AGENTS.md / CLAUDE.md override Language Style Packs");
  });

  it("keeps kencode guidance concise while separating exploration from exact search", async () => {
    const cwd = await makeProject();
    const prompt = await buildSystemPrompt(cwd, undefined, false, undefined, [
      "mcp__kencode-search__exploreCodeSamples",
      "mcp__kencode-search__searchCode",
    ]);
    const tools = toolsSection(prompt);

    expect(tools).toContain("discover candidate repos/files and literal anchors");
    expect(tools).toContain("follow-up searchCode calls");
    expect(tools).toContain("literal text or RE2 regex");
    expect(tools).toContain("NOT semantic");
    expect(tools).toContain("path` is a literal file-path substring");
    expect(tools).not.toContain("zero hits, every time");
    expect(tools.length).toBeLessThan(750);
  });
});
