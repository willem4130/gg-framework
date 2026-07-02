import { describe, it, expect, beforeAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { buildKenSystemPrompt, buildKenAutopilotSystemPrompt } from "./ken-prompt.js";
import { INJECTED_PROMPT_LABEL } from "./ken-context.js";

// No CLAUDE.md/AGENTS.md up the tree from tmpdir, so the appended project-
// context section is empty and these assertions stay focused on the persona.
const TEST_CWD = os.tmpdir();

describe("buildKenAutopilotSystemPrompt — verdict contract", () => {
  let prompt: string;
  beforeAll(async () => {
    prompt = await buildKenAutopilotSystemPrompt(TEST_CWD);
  });

  it("teaches all four verdict keywords", () => {
    for (const keyword of ["PROMPT", "ALL_CLEAR", "IGNORE", "HUMAN"]) {
      expect(prompt).toContain(keyword);
    }
  });

  it("routes end-of-turn questions/options/plans to HUMAN, never PROMPT", () => {
    // Leak regression: without this rule, GG Coder ending with "want me to…?"
    // or an A/B/C menu reads as "unfinished" and Ken answers for the user.
    expect(prompt).toContain("asking the ");
    expect(prompt).toContain("presenting options");
    expect(prompt).toContain("never answer on the user's behalf");
    expect(prompt).toContain("submitting a plan for approval");
  });

  it("tells Ken injected transcript lines are his own, not user asks", () => {
    expect(prompt).toContain("Ken autopilot (injected)");
    expect(prompt).toContain("Judge only against the original user request");
  });

  it("anchors ALL_CLEAR judgment to the pinned Original user request section", () => {
    expect(prompt).toContain("Original ");
    expect(prompt).toContain("user request' section");
    expect(prompt).toContain("never a later injected prompt");
  });

  it("keeps the injected label byte-identical to the digest renderer's", () => {
    // The system prompt names the label in prose; the digest emits it. If the
    // label constant drifts, the prompt's rule points at nothing.
    expect(INJECTED_PROMPT_LABEL).toContain("Ken autopilot (injected)");
    expect(prompt).toContain("Ken autopilot (injected)");
  });

  it("forbids commentary before or after the keyword line", () => {
    // Leak regression: Ken once prefaced ALL_CLEAR with a recap/opinion ("The
    // label is now a plain non-clickable span... Typecheck passed.\nALL_CLEAR"),
    // which the parser couldn't read as a bare verdict and surfaced as a raw
    // HUMAN bubble. The prompt must explicitly ban prose around the keyword.
    expect(prompt).toContain("nothing before it");
    expect(prompt).toContain("never add commentary");
    expect(prompt).toContain("no recap of what you found");
  });
});

describe("buildKenSystemPrompt — chat mode unaffected", () => {
  it("keeps the chat output contract (prompt fence) and no verdict keywords", async () => {
    const prompt = await buildKenSystemPrompt(TEST_CWD);
    expect(prompt).toContain("Send to GG Coder");
    // The verdict contract is autopilot-only.
    expect(prompt).not.toContain("ALL_CLEAR");
  });
});

describe("buildKenSystemPrompt / buildKenAutopilotSystemPrompt — project context", () => {
  it("folds project context into the cached system prompt, not the per-turn digest", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ken-prompt-test-"));
    await fs.writeFile(path.join(dir, "CLAUDE.md"), "Build a todo app.");
    try {
      const chat = await buildKenSystemPrompt(dir);
      const autopilot = await buildKenAutopilotSystemPrompt(dir);
      expect(chat).toContain("Build a todo app.");
      expect(autopilot).toContain("Build a todo app.");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
