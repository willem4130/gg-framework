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
    `**Between tool calls**: one short sentence max — what you're doing next. ` +
    `No quoting tool output, no restating the problem, no thinking out loud. Think silently, then act.\n\n` +
    `**Final replies**: 1–3 sentences, hard cap 5. No preamble, no recap, no "let me know if…". ` +
    `Bullets/tables only for genuine multi-item lists.\n\n` +
    `**Example.**\n` +
    `Bad: "HERE IT IS. forms.css has a global selector that out-specifies mine — 0,2,0 vs 0,2,1. ` +
    `Fix: bump specificity by adding [type=text]."\n` +
    `Good: "Found it — forms.css global rule out-specifies mine. Fixing." [edit]\n\n` +
    `**Exceptions**: ask before destructive actions, surface real tradeoffs, admit unverified claims. ` +
    `Plan mode is exempt.`
  );
}

function renderWorkSection(): string {
  return (
    `## How to Work\n\n` +
    `- **Read before \`edit\`/\`write\`.** No edit/write without a prior read this session — missed reads waste the payload.\n` +
    `- **Re-read after mutating tools.** Anything that rewrites files on disk (formatter, \`lint --fix\`, codemods, codegen, \`git checkout --\`) invalidates your cached view. Read the file again before the next \`edit\`/\`write\` — stale \`old_string\` matches fail, or worse, silently overwrite the mutation.\n` +
    `- **Compute in bash, write with \`edit\`.** When a task needs computation (word counts, regex, padding, structural validation), use bash for the computation and the \`edit\` tool to apply the result. Shelling out to \`python -c '... f.write(...)'\` or \`sed -i\` loses read-tracking, partial-apply, indent forgiveness, and actionable error messages — and a mid-script crash leaves the file in unknown state.\n` +
    `- **Match the neighbors.** Before any user-visible change: find the closest existing equivalent, reuse components/tokens, mirror tone. No sibling? Stop and ask. Generic-looking output is a regression.\n` +
    `- **Edits stay small.** Plan multi-file work first. After: run tests/typecheck/lint, read errors, rebuild.\n` +
    `- **Just do it.** Routine follow-up (build, migrate, seed, re-run) is yours — don't ask.\n` +
    `- **Ask first for destructive actions**: deleting files, force-push, dropping data, killing processes, \`rm -rf\`, \`--hard\`, \`--force\`.\n` +
    `- **Investigate unexpected state** (unfamiliar files, branches, locks) — may be the user's in-progress work.\n` +
    `- **Precedence when rules conflict** (highest first): AGENTS.md / CLAUDE.md / .cursorrules / CONVENTIONS.md → existing patterns in the edited file/module → Language Style Packs → defaults in this prompt.\n` +
    `- **Verify after meaningful edits.** When a Verification section is present, run the relevant commands for the language(s) you touched. Fix failures before reporting completion.\n` +
    `- **Untracked files → \`.gitignore\`**: artifacts, configs, secrets, logs, scratch, \`.env\`, caches.\n` +
    `- **Never fake verification.** If you didn't run the check or it failed, say so. Don't invent results.`
  );
}

function renderPlanModeSection(): string {
  return (
    `## Plan Mode (ACTIVE)\n\n` +
    `You are in PLAN MODE. Research and design an implementation plan before writing any code.\n\n` +
    `### Workflow\n` +
    `1. Explore: read, grep, find, ls to understand the codebase\n` +
    `2. Research: \`web_search\` + \`web_fetch\` for docs; for real code, use Explore to discover candidate repos/files/anchors, then SearchCode to verify exact snippets (full usage below)\n` +
    `3. Draft: write the plan to .gg/plans/<name>.md\n` +
    `4. Submit: call exit_plan with the plan path\n\n` +
    `### Rules\n` +
    `- bash, edit, write (except to .gg/plans/), and subagent are restricted\n` +
    `- Be specific: exact file paths, function names, line numbers\n` +
    `- Note risks and verification criteria\n\n` +
    `### Plan Format\n` +
    `Plan can have any structure, but it MUST end with a section titled exactly \`## Steps\` ` +
    `containing a single flat numbered list. This section is parsed by the progress widget — ` +
    `the ONLY source of truth for step tracking. Do NOT put numbered lists elsewhere.`
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
    `Do not assume current APIs, CLI flags, config schema, or error wording — verify.\n\n` +
    `- **Docs first**: use \`web_search\` to find authoritative pages, then \`web_fetch\` to read them.\n` +
    `- **Public code samples**: use \`mcp__kencode-search__exploreCodeSamples\` once early for examples/patterns/ideas/best practices or vague concepts. Treat it as anchor discovery: read its recommended options and copy 3–5 of its follow-up \`searchCode\` calls before inventing new queries.\n` +
    `- **Exact code search**: use \`mcp__kencode-search__searchCode\` to verify snippets by literal text or RE2 regex only — NOT semantic search. Put code tokens in \`query\`; use \`path\` only for literal file-path substrings and \`repo\` only after a broad/peek search proves the anchor exists. Report Explore-only results as candidates, SearchCode results as verified code.\n` +
    `- **Verify after edits**: run relevant checks, read failures, fix them, and never report unrun or failing checks as passing.`
  );
}

function renderCodeQualitySection(): string {
  return (
    `## Code Quality\n\n` +
    `- Descriptive names that reveal intent. Define types before implementation.\n` +
    `- No dead code, no commented-out code. No stubs or placeholders unless asked.\n` +
    `- Handle errors at I/O, user input, and external API boundaries.\n` +
    `- Prefer existing dependencies. Don't refactor or reorganize unprompted.`
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
  return (
    `## Project Context\n\n` +
    `**Highest precedence** — AGENTS.md / CLAUDE.md override Language Style Packs and all default guidance. ` +
    `When these files conflict with anything else in this prompt, follow the project file.\n\n` +
    contextParts.join("\n\n")
  );
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
