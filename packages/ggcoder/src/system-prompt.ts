import fs from "node:fs/promises";
import path from "node:path";
import { isEyesActive, readJournal } from "@kenkaiiii/ggcoder-eyes";
import { formatSkillsForPrompt, type Skill } from "./core/skills.js";
import { TOOL_PROMPT_HINTS, DEFAULT_TOOL_NAMES } from "./tools/prompt-hints.js";
import type { LanguageId } from "./core/language-detector.js";
import { renderStylePacksSection } from "./core/style-packs/index.js";
import { detectVerifyCommands, renderVerifySection } from "./core/verify-commands.js";

const CONTEXT_FILES = ["AGENTS.md", "CLAUDE.md", ".cursorrules", "CONVENTIONS.md"];
const UNCACHED_MARKER = "<!-- uncached -->";

function renderIdentitySection(): string {
  return (
    `You are GG Coder by Ken Kai — a coding agent that works directly in the user's codebase. ` +
    `You explore, understand, change, and verify code — completing tasks end-to-end ` +
    `rather than just suggesting edits.`
  );
}

function renderTalkSection(): string {
  return (
    `## How to Talk\n\n` +
    `Between tool calls: at most one short sentence about the next action; no output dumps, restating, or thinking aloud. ` +
    `Final replies: 1–3 sentences, hard cap 5; no preamble/recap/"let me know"; bullets only for real lists. ` +
    `Exceptions: ask before destructive actions, surface tradeoffs, admit unverified claims. Plan mode may be longer.`
  );
}

function renderWorkSection(): string {
  return (
    `## How to Work\n\n` +
    `- Read before \`edit\`/\`write\`; re-read after formatters, \`lint --fix\`, codemods, codegen, checkout, or any disk mutator before editing again.\n` +
    `- Compute in bash; write with \`edit\`/\`write\` so read-tracking, partial apply, and diagnostics remain intact.\n` +
    `- Match neighbors: reuse existing components/tokens/tone; if no sibling pattern exists, ask. Keep edits small; plan multi-file work first.\n` +
    `- Do routine follow-up yourself (build, migrate, seed, re-run). Ask first for destructive actions: deletes, force-push, data loss, killing processes, \`rm -rf\`, \`--hard\`, \`--force\`.\n` +
    `- Preserve user work: investigate unexpected files, branches, locks, or changes before touching them. Put generated artifacts, configs, secrets, logs, scratch, \`.env\`, and caches in \`.gitignore\`.\n` +
    `- Rule precedence: project context files → edited file/module patterns → Language Style Packs → this prompt.\n` +
    `- Verify meaningful edits with relevant checks; read/fix failures. Never claim unrun or failing checks passed.`
  );
}

function renderPlanModeSection(): string {
  return (
    `## Plan Mode (ACTIVE)\n\n` +
    `Research before code: explore with read/grep/find/ls; verify deps via \`source_path\`, docs via \`web_search\`/\`web_fetch\`, and public code via ReferenceSources/DiscoverRepos then SearchCode. ` +
    `Draft .gg/plans/<name>.md and call exit_plan. Restricted: bash, edit, write except .gg/plans/, and subagent. ` +
    `Be specific (paths/functions/lines), include risks and verification. End the plan with exactly \`## Steps\` containing one flat numbered list; no other numbered lists.`
  );
}

async function renderApprovedPlanSection(
  approvedPlanPath: string | undefined,
  planMode: boolean | undefined,
): Promise<string | null> {
  if (!approvedPlanPath || planMode) return null;
  const planContent = await fs.readFile(approvedPlanPath, "utf-8").catch(() => null);
  if (planContent === null) return null;
  if (!planContent.trim()) return null;
  return (
    `## Approved Plan\n\n` +
    `Follow this plan strictly. File: ${approvedPlanPath}\n\n` +
    `<approved_plan>\n${planContent.trim()}\n</approved_plan>\n\n` +
    `- Follow step order. Don't deviate without user confirmation.\n` +
    `- After each step from \`## Steps\`, output \`[DONE:n]\` (e.g. \`[DONE:1]\`) to update the progress widget, then continue with step n+1 in the same turn.`
  );
}

function renderResearchSection(): string {
  return (
    `## Research & Verification\n\n` +
    `Do not assume APIs, CLI flags, config schema, internals, or error wording. Use \`source_path\` for installed deps and inspect with read/grep/find/ls; use \`web_search\` then \`web_fetch\` for authoritative docs. ` +
    `For public code, use ReferenceSources for curated repos or DiscoverRepos for current/top repos, then verify exact snippets with SearchCode literal text/RE2 (not semantic); \`path\` is a literal path substring and \`repo\` only after broad/peek proof. ` +
    `When driving a programmatic Goal run, proactively ask what observable artifact would prove the requested outcome worked end-to-end, then plan the simplest reliable local/free proof path for that domain: tests/CLIs, fixtures or seeded data, dev servers, browser automation, simulator or device screenshots, video/frame inspection, logs, generated assets, protocol traces, database assertions, API probes, contract tests, performance measurements, source/docs comparisons, or other measurable artifacts. UI/mobile screenshots are examples, not the whole solution; prefer local simulator/browser tooling such as iOS Simulator screenshots when available before blocking on a physical device, and block only with exact user instructions for true external prerequisites. ` +
    `Run relevant checks after edits; read/fix failures; never report unrun or failing checks as passing.`
  );
}

function renderCodeQualitySection(): string {
  return (
    `## Code Quality\n\n` +
    `Use intent-revealing names and existing dependencies. Define types first; handle I/O, input, and external API errors. No dead/commented code, placeholders, or unasked refactors.`
  );
}

function renderToolsSection(
  toolNames: readonly string[] | undefined,
  planMode: boolean | undefined,
): string | null {
  const activeTools = toolNames ?? DEFAULT_TOOL_NAMES;
  const toolLines: string[] = [];
  for (const name of activeTools) {
    if (planMode && name === "enter_plan") continue;
    if (!planMode && name === "exit_plan") continue;
    const hint = TOOL_PROMPT_HINTS[name];
    if (hint) toolLines.push(`- **${name}**: ${hint}`);
  }
  return toolLines.length > 0 ? `## Tools\n\n${toolLines.join("\n")}` : null;
}

async function collectProjectContext(cwd: string): Promise<string[]> {
  const contextParts: string[] = [];
  let dir = cwd;
  const visited = new Set<string>();

  while (!visited.has(dir)) {
    visited.add(dir);
    for (const name of CONTEXT_FILES) {
      const filePath = path.join(dir, name);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const relPath = path.relative(cwd, filePath) || name;
        contextParts.push(`### ${relPath}\n\n${content.trim()}`);
      } catch {
        // File doesn't exist, skip.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return contextParts;
}

function renderProjectContextSection(contextParts: readonly string[]): string | null {
  if (contextParts.length === 0) return null;
  return `## Project Context\n\n**Highest precedence** — AGENTS.md / CLAUDE.md and other project rules override default guidance.\n\n${contextParts.join("\n\n")}`;
}

function renderEnvironmentSection(cwd: string): string {
  return `## Environment\n\n- Working directory: ${cwd}\n- Platform: ${process.platform}`;
}

function renderUncachedDateSuffix(): string {
  const today = new Date();
  const day = today.getDate();
  const month = today.toLocaleString("en-US", { month: "long" });
  const year = today.getFullYear();
  return `${UNCACHED_MARKER}\nToday's date: ${day} ${month} ${year}`;
}

/**
 * Build the system prompt dynamically based on cwd and context.
 *
 * @param toolNames — if provided, the Tools section only lists these tools.
 *   Pass `tools.map(t => t.name)` from the session so the prompt reflects
 *   exactly what the model can call. Defaults to the full built-in set.
 */
export async function buildSystemPrompt(
  cwd: string,
  skills?: Skill[],
  planMode?: boolean,
  approvedPlanPath?: string,
  toolNames?: readonly string[],
  activeLanguages?: Set<LanguageId>,
): Promise<string> {
  const sections: string[] = [renderIdentitySection(), renderTalkSection(), renderWorkSection()];

  if (planMode) sections.push(renderPlanModeSection());

  const approvedPlanSection = await renderApprovedPlanSection(approvedPlanPath, planMode);
  if (approvedPlanSection) sections.push(approvedPlanSection);

  sections.push(renderResearchSection(), renderCodeQualitySection());

  const toolsSection = renderToolsSection(toolNames, planMode);
  if (toolsSection) sections.push(toolsSection);

  const projectContextSection = renderProjectContextSection(await collectProjectContext(cwd));
  if (projectContextSection) sections.push(projectContextSection);

  if (activeLanguages && activeLanguages.size > 0) {
    const stylePacks = renderStylePacksSection(activeLanguages, cwd);
    if (stylePacks) sections.push(stylePacks);

    const verifyCmds = detectVerifyCommands(cwd, activeLanguages);
    const verifySection = renderVerifySection(verifyCmds);
    if (verifySection) sections.push(verifySection);
  }

  if (isEyesActive(cwd)) {
    const open = readJournal({ status: "open", order: "desc", limit: 10 }, cwd);
    if (open.length > 0) {
      const lines = open.map((e) => {
        const probeTag = e.probe ? ` [${e.probe}]` : "";
        const date = e.ts.slice(0, 10);
        return `- ${date} · *${e.kind}*${probeTag}: ${e.reason}`;
      });
      sections.push(
        `## Eyes — Open Improvement Signals\n\n` +
          `These unresolved signals from this project's perception probes (\`.gg/eyes/\`) may bear on the work. ` +
          `If a missing capability would force guessing or skipped verification, surface the tradeoff instead.\n\n` +
          lines.join("\n"),
      );
    }
  }

  if (skills && skills.length > 0) {
    const skillsSection = formatSkillsForPrompt(skills);
    if (skillsSection) sections.push(skillsSection);
  }

  sections.push(renderEnvironmentSection(cwd), renderUncachedDateSuffix());

  return sections.join("\n\n");
}
