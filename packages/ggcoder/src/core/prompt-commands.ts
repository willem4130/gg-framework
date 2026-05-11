/**
 * Prompt-template commands — slash commands that inject detailed prompts
 * into the agent loop. Each command maps to a full prompt the agent executes.
 */

export interface PromptCommand {
  name: string;
  aliases: string[];
  description: string;
  prompt: string;
}

export const PROMPT_COMMANDS: PromptCommand[] = [
  {
    name: "scan",
    aliases: [],
    description: "Find dead code, bugs, and security issues",
    prompt: `Find quick wins in this codebase. Spawn 5 sub-agents in parallel using the subagent tool (call the subagent tool 5 times in a single response, each with a different task), each focusing on one area. Adapt each area to what's relevant for THIS project's stack and architecture.

**Agent 1 - Performance**: Inefficient algorithms, unnecessary work, missing early returns, blocking operations, things that scale poorly

**Agent 2 - Dead Weight**: Unused code, unreachable paths, stale comments/TODOs, obsolete files, imports to nowhere

**Agent 3 - Lurking Bugs**: Unhandled edge cases, missing error handling, resource leaks, race conditions, silent failures

**Agent 4 - Security**: Hardcoded secrets, injection risks, exposed sensitive data, overly permissive access, unsafe defaults

**Agent 5 - Dependencies & Config**: Unused packages, vulnerable dependencies, misconfigured settings, dead environment variables, orphaned config files

## The Only Valid Findings

A finding is ONLY valid if it falls into one of these categories:

1. **Dead** - Code that literally does nothing. Unused, unreachable, no-op.
2. **Broken** - Will cause errors, crashes, or wrong behavior. Not "might" - WILL.
3. **Dangerous** - Security holes, data exposure, resource exhaustion.

That's it. Three categories. If it doesn't fit, don't report it.

**NOT valid findings:**
- "This works but could be cleaner" - NO
- "Modern best practice suggests..." - NO
- "This is verbose/repetitive but functional" - NO
- "You could use X instead of Y" - NO
- "This isn't how I'd write it" - NO

If the code works, isn't dangerous, and does something - leave it alone.

## Output Format

For each finding:
\`\`\`
[DEAD/BROKEN/DANGEROUS] file:line - What it is
Impact: What happens if left unfixed
\`\`\`

Finding nothing is a valid outcome. Most codebases don't have easy wins - that's fine.`,
  },
  {
    name: "verify",
    aliases: [],
    description: "Verify code against docs and best practices",
    prompt: `Verify this codebase against current best practices and official documentation. Spawn 8 sub-agents in parallel using the subagent tool (call the subagent tool 8 times in a single response, each with a different task), each focusing on one category. Each agent must VERIFY findings using real code samples or official docs - no assumptions allowed.

**Agent 1 - Core Framework**: Detect the main framework, verify usage patterns against official documentation

**Agent 2 - Dependencies/Libraries**: Check if library APIs being used are current or deprecated. Verify against library documentation

**Agent 3 - Language Patterns**: Identify the primary language, verify idioms and patterns are current

**Agent 4 - Configuration**: Examine build tools, bundlers, linters, and config files. Verify settings against current tool documentation

**Agent 5 - Security Patterns**: Review auth, data handling, secrets management. Verify against current security guidance and OWASP recommendations

**Agent 6 - Testing**: Identify test framework in use, verify testing patterns match current library recommendations

**Agent 7 - API/Data Handling**: Review data fetching, state management, storage patterns. Verify against current patterns and framework docs

**Agent 8 - Error Handling**: Examine error handling patterns, verify they match library documentation

## Agent Workflow

Each agent MUST follow this process:
1. **Identify** - What's relevant in THIS project for your category
2. **Find** - Locate specific implementations in the codebase
3. **Verify** - Check against real code or official docs
4. **Report** - Only report when verified current practice differs from codebase

## The Only Valid Findings

A finding is ONLY valid if:
1. **OUTDATED** - Works but uses old patterns with verified better alternatives
2. **DEPRECATED** - Uses APIs marked deprecated in current official docs
3. **INCORRECT** - Implementation contradicts official documentation

**NOT valid findings:**
- "I think there's a better way" without verification - NO
- "This looks old" without proof - NO
- Style preferences or subjective improvements - NO
- Anything not verified via real code or official docs - NO

## Output Format

For each finding:
\`\`\`
[OUTDATED/DEPRECATED/INCORRECT] file:line - What it is
Current: How it's implemented now
Verified: What the correct/current approach is
Source: URL to official docs or evidence
\`\`\`

No findings is a valid outcome. If implementations match current practices, that's good news.`,
  },
  {
    name: "research",
    aliases: [],
    description: "Research best tools, deps, and patterns",
    prompt: `Research the best tools, dependencies, and architecture for this project.

First, if it's not clear what the project is building, ask me to describe the features, target platform, and any constraints. If you can infer this from the codebase, proceed directly.

Then spawn 6 sub-agents in parallel using the subagent tool (call the subagent tool 6 times in a single response, each with a different task). Every agent must verify ALL recommendations - no training-data assumptions allowed.

**Agent 1 - Project Scan**: Read the current working directory. Catalog what already exists: config files, installed deps, directory structure, language/framework already chosen. Report exactly what's in place.

**Agent 2 - Stack Validation**: Research whether the current framework/language is the best choice for this project. Compare top 2-3 alternatives on performance, ecosystem, and developer experience. Pick ONE winner with evidence.

**Agent 3 - Core Dependencies**: For EACH feature, find the single best library for this stack. Confirm latest stable versions. No outdated packages. Output: package name, version, one-line purpose.

**Agent 4 - Dev Tooling**: Research the best dev tooling for this stack: package manager, bundler, linter, formatter, test framework, type checker. Pick ONE per category with exact versions.

**Agent 5 - Architecture**: Find how real projects of this type structure their code. Look for directory layouts, file naming conventions, and key patterns. Output a concrete directory tree and list of patterns.

**Agent 6 - Config & Integration**: Research required config files for the chosen stack and tools. Cover: linter config, formatter config, TS/type config, env setup, CI/CD basics.

## Agent Rules

1. Every recommendation MUST be verified - no guessing
2. Confirm latest stable versions - do not assume version numbers
3. Pick ONE best option per category - no "you could also use X"
4. No prose, no hedging, no alternatives lists - decisive answers only

## Output

After all agents complete, synthesize findings into a single RESEARCH.md file:

\`\`\`markdown
# RESEARCH: [short project description]
Generated: [today's date]
Stack: [framework + language + runtime]

## INSTALL
[exact shell commands - copy-paste ready]

## DEPENDENCIES
| package | version | purpose |
[each purpose max 5 words]

## DEV DEPENDENCIES
| package | version | purpose |

## CONFIG FILES TO CREATE
### [filename]
[exact file contents or key settings]

## PROJECT STRUCTURE
[tree showing recommended directories]

## SETUP STEPS
1. [concrete action]

## KEY PATTERNS
[brief list of architectural patterns]

## SOURCES
[URLs used for verification]
\`\`\`

Write the file, then summarize what was researched.`,
  },
  {
    name: "init",
    aliases: [],
    description: "Generate or update CLAUDE.md for this project",
    prompt: `Generate or update a minimal CLAUDE.md with project structure, guidelines, and quality checks.

## Step 1: Check if CLAUDE.md Exists

If CLAUDE.md exists:
- Read the existing file
- Preserve custom sections the user may have added
- Update the structure, quality checks, and organization rules

If CLAUDE.md does NOT exist:
- Create a new one from scratch

## Step 2: Analyze Project (Use Sub-agents in Parallel)

Spawn 3 sub-agents in parallel using the subagent tool (call the subagent tool 3 times in a single response):

1. **Project Purpose Agent**: Analyze README, package.json description, main files to understand what the project does
2. **Directory Structure Agent**: Map out the folder structure and what each folder contains
3. **Tech Stack Agent**: Identify languages, frameworks, tools, dependencies

Wait for all sub-agents to complete, then synthesize the information.

## Step 3: Detect Project Type & Commands

Check for config files:
- package.json -> JavaScript/TypeScript (extract lint, typecheck, server scripts)
- pyproject.toml or requirements.txt -> Python
- go.mod -> Go
- Cargo.toml -> Rust

Extract linting commands, typechecking commands, and server start command (if applicable).

## Step 4: Generate Project Tree

Create a concise tree structure showing key directories and files with brief descriptions.

## Step 5: Generate or Update CLAUDE.md

Create CLAUDE.md with: project description, project structure tree, organization rules (one file per component, single responsibility), and zero-tolerance code quality checks with the exact commands for this project.

Keep total file under 100 lines. If updating, preserve any custom sections the user added.

## Step 6: Restart Notice

End your reply with this exact notice so the user doesn't miss it:

> ⚠️ CLAUDE.md was created/updated. ggcoder loads it at startup, so **exit and restart ggcoder** (\`/quit\` then run \`ggcoder\` again) before continuing. Without a restart, I won't see the new context.`,
  },
  {
    name: "setup-lint",
    aliases: [],
    description: "Generate a /fix command for linting and typechecking",
    prompt: `Detect the project type and generate a /fix command for linting and typechecking.

## Step 1: Detect Project Type

Check for config files:
- package.json -> JavaScript/TypeScript
- pyproject.toml or requirements.txt -> Python
- go.mod -> Go
- Cargo.toml -> Rust
- composer.json -> PHP

Read the relevant config file to understand the project structure.

## Step 2: Check Existing Tools

Based on the project type, check if linting/typechecking tools are already configured:

- **JS/TS**: eslint, prettier, typescript — check package.json scripts and config files
- **Python**: mypy, pylint, black, ruff — check dependencies and config files
- **Go**: go vet, gofmt, staticcheck
- **Rust**: clippy, rustfmt

## Step 3: Install Missing Tools (if needed)

Only install what's missing. Use the detected package manager.

## Step 4: Generate /fix Command

Create the directory \`.gg/commands/\` if it doesn't exist, then write \`.gg/commands/fix.md\`:

\`\`\`markdown
---
name: fix
description: Run typechecking and linting, then spawn parallel agents to fix all issues
---

Run all linting and typechecking tools, collect errors, group them by domain, and use the subagent tool to spawn parallel sub-agents to fix them.

## Step 1: Run Checks

[INSERT PROJECT-SPECIFIC COMMANDS — e.g. npm run lint, npm run typecheck, etc.]

## Step 2: Collect and Group Errors

Parse the output. Group errors by domain:
- **Type errors**: Issues from TypeScript, mypy, etc.
- **Lint errors**: Issues from eslint, pylint, ruff, clippy, etc.
- **Format errors**: Issues from prettier, black, rustfmt, gofmt

## Step 3: Spawn Parallel Agents

For each domain with issues, use the subagent tool to spawn a sub-agent to fix all errors in that domain.

## Step 4: Verify

After all agents complete, re-run all checks to verify all issues are resolved.
\`\`\`

Replace [INSERT PROJECT-SPECIFIC COMMANDS] with the actual commands for the detected project.

## Step 5: Confirm

Report what was detected, what was installed, and that /fix is now available.`,
  },
  {
    name: "setup-commit",
    aliases: [],
    description: "Generate a /commit command with quality checks",
    prompt: `Detect the project type and generate a /commit command that enforces quality checks before committing.

## Step 1: Detect Project and Extract Commands

Check for config files and extract the lint/typecheck commands:
- package.json -> Extract lint, typecheck scripts
- pyproject.toml -> Use mypy, pylint/ruff
- go.mod -> Use go vet, gofmt
- Cargo.toml -> Use cargo clippy, cargo fmt --check

## Step 2: Generate /commit Command

Create the directory \`.gg/commands/\` if it doesn't exist, then write \`.gg/commands/commit.md\`:

\`\`\`markdown
---
name: commit
description: Run checks, commit with AI message, and push
---

1. Run quality checks:
   [PROJECT-SPECIFIC LINT/TYPECHECK COMMANDS]
   Fix ALL errors before continuing. Use auto-fix commands where available.

2. Review changes: run git status and git diff --staged and git diff

3. Stage relevant files with git add (specific files, not -A)

4. Generate a commit message:
   - Start with verb (Add/Update/Fix/Remove/Refactor)
   - Be specific and concise, one line preferred

5. Commit and push:
   git commit -m "your generated message"
   git push
\`\`\`

Replace [PROJECT-SPECIFIC LINT/TYPECHECK COMMANDS] with the actual commands.

Keep the command file under 20 lines.

## Step 3: Confirm

Report that /commit is now available with quality checks and AI-generated commit messages.`,
  },
  {
    name: "setup-tests",
    aliases: [],
    description: "Set up testing and generate a /test command",
    prompt: `Set up comprehensive testing for this project and generate a /test command.

## Step 1: Analyze Project

Detect the project type, framework, and architecture. Identify all critical business logic that needs testing.

## Step 2: Determine Testing Strategy

Use these tools based on project type (2025-2026 best practices):

| Language | Unit/Integration | E2E | Notes |
|----------|------------------|-----|-------|
| JS/TS | Vitest (not Jest) | Playwright | Vitest is faster, native ESM/TS. Use Testing Library for components. |
| Python | pytest | Playwright | pytest-django for Django, httpx+pytest-asyncio for FastAPI. |
| Go | testing + testify | httptest | testcontainers-go for integration. Table-driven tests. |
| Rust | #[test] + rstest | axum-test | assert_cmd for CLI, proptest for property-based. |
| PHP | Pest 4 (Laravel) / PHPUnit 12 | Laravel Dusk | Pest preferred for Laravel. |

## Step 3: Set Up Testing Infrastructure

Spawn 4 sub-agents in parallel using the subagent tool (call the subagent tool 4 times in a single response):

**Agent 1 - Dependencies & Config**: Install test frameworks and create config files
**Agent 2 - Unit Tests**: Create comprehensive unit tests for all business logic, utilities, and core functions
**Agent 3 - Integration Tests**: Create integration tests for APIs, database operations, and service interactions
**Agent 4 - E2E Tests** (if applicable): Create end-to-end tests for critical user flows

Each agent should create COMPREHENSIVE tests covering all critical code paths - not just samples.

## Step 4: Verify and Generate /test Command

Run the tests to verify everything works. Fix any issues.

Then create the directory \`.gg/commands/\` if it doesn't exist and write \`.gg/commands/test.md\` with:

\`\`\`markdown
---
name: test
description: Run tests, then spawn parallel agents to fix failures
---

Run all tests for this project, collect failures, and use the subagent tool to spawn parallel sub-agents to fix them.

## Step 1: Run Tests

[PROJECT-SPECIFIC TEST COMMANDS with options for watch mode, coverage, filtering]

## Step 2: If Failures

For each failing test, use the subagent tool to spawn a sub-agent to fix the underlying issue (not the test).

## Step 3: Re-run

Re-run tests to verify all fixes.
\`\`\`

Replace placeholders with the actual test commands for this project.

## Step 5: Report

Summarize what was set up, how many tests were created, and that /test is now available.`,
  },
  {
    name: "setup-update",
    aliases: [],
    description: "Generate an /update command for dependency updates",
    prompt: `Detect the project type and generate an /update command for dependency updates and deprecation fixes.

## Step 1: Detect Project Type & Package Manager

Check for config files and lock files:
- package.json + package-lock.json -> npm
- package.json + yarn.lock -> yarn
- package.json + pnpm-lock.yaml -> pnpm
- pyproject.toml + poetry.lock -> poetry
- requirements.txt -> pip
- go.mod -> Go
- Cargo.toml -> Rust

## Step 2: Generate /update Command

Create the directory \`.gg/commands/\` if it doesn't exist, then write \`.gg/commands/update.md\`:

\`\`\`markdown
---
name: update
description: Update dependencies, fix deprecations and warnings
---

## Step 1: Check for Updates

[OUTDATED CHECK COMMAND for detected package manager]

## Step 2: Update Dependencies

[UPDATE COMMAND + SECURITY AUDIT]

## Step 3: Check for Deprecations & Warnings

Run a clean install and read ALL output carefully. Look for:
- Deprecation warnings
- Security vulnerabilities
- Peer dependency warnings
- Breaking changes

## Step 4: Fix Issues

For each warning/deprecation:
1. Research the recommended replacement or fix
2. Update code/dependencies accordingly
3. Re-run installation
4. Verify no warnings remain

## Step 5: Run Quality Checks

[PROJECT-SPECIFIC LINT/TYPECHECK COMMANDS]

Fix all errors before completing.

## Step 6: Verify Clean Install

Delete dependency folders/caches, run a fresh install, verify ZERO warnings/errors.
\`\`\`

Replace all placeholders with the actual commands for the detected project type and package manager.

## Step 3: Confirm

Report that /update is now available with dependency updates, security audits, and deprecation fixes.`,
  },
  {
    name: "setup-eyes",
    aliases: [],
    description: "Set up project perception probes and document them",
    prompt: `# Eyes: Set Up or Expand Project Perception

Build the perception probes this project needs and document them in CLAUDE.md so any future agent can use them. The \`ggcoder eyes\` CLI does the mechanical work (detect, install, verify); your job is **judgment** (which capabilities matter for THIS project) and **prose** (the project-specific triggers in CLAUDE.md). Re-run this command anytime to add or fix probes.

## Steps

1. \`ggcoder eyes list\` — see what's already installed/verified. **Resume**, don't restart. Skip verified probes; re-run failed ones.
2. \`ggcoder eyes detect\` — emits JSON of \`{capability: {candidates, primary}}\` for this project.
3. **Pick 3–8 capabilities to install this run.** Heuristics:
   - Universal: \`http\` for any API/backend, \`runtime_logs\` for anything with a server.
   - UI: \`visual\` — for multi-stack projects (e.g. React Native), install all primary candidates with distinct names: \`install visual --impl playwright --as visual-web\`, \`install visual --impl adb --as visual-android\`, \`install visual --impl simctl --as visual-ios\`.
   - Backend with email/webhooks: \`capture_email\`, \`capture_webhook\`.
   - **Always defer** opt-ins: \`load\`, \`chaos\`, \`remote\`, \`apm\` — unless the user explicitly asked.
4. For each pick: \`ggcoder eyes install <cap> [--impl <name>] [--as <name>]\`. On failure: retry once, then mark and continue — don't abort the whole run.
5. \`ggcoder eyes verify\` — runs every installed probe's self-test. Some failures (\`adb\` no device, \`simctl\` no booted simulator) are expected; they get recorded.
6. **Write/update the \`## Eyes\` section in CLAUDE.md** (create CLAUDE.md if missing; do NOT clobber other sections). Use the template below. The triggers are the load-bearing piece — make them project-specific and actionable.
7. **Report**: list verified ✓ / failed ✗ / deferred. End with the restart notice.

## CLAUDE.md \`## Eyes\` template

\`\`\`markdown
## Eyes

Perception probes live in \`.gg/eyes/\`. All headless. Artifacts → \`.gg/eyes/out/\` (gitignored). Invoke probes yourself; don't ask the user to verify what you can verify.

### Available probes

| Need | Run | Then |
|---|---|---|
| <one-line need> | \`.gg/eyes/<id>.sh <args>\` | <how to consume the output> |
| ... | ... | ... |

### When to use these eyes (automatically, without being asked)

Reach for probes ON YOUR OWN INITIATIVE when any of these apply:

- <project-specific trigger 1, e.g. "After editing any \`.tsx\` file under \`src/components/\`, screenshot the affected page with \`.gg/eyes/visual.sh http://localhost:3000/<path>\`.">
- <trigger 2, e.g. "After adding/modifying a route under \`src/routes/\`, hit it with \`.gg/eyes/http.sh\` and confirm the response shape.">
- <trigger 3>

If a probe fails or returns unexpected results, investigate the artifact directly before assuming the probe itself is broken.

### When NOT to use

- Docs-only changes, comments, formatting.
- Refactors covered by tests.
- Dev server / simulator / sink isn't up AND the task doesn't require runtime verification.
- Same probe already ran this turn on the same artifact — reuse the output.

### When to escalate a capability gap (the self-improvement loop)

If you're about to **guess**, **skip verification**, or **hand-wave** about something a better probe would show you — STOP and surface the tradeoff inline. Phrasing like:

> "I tried screenshotting but the failure is a JS error I can only see in the browser console — and there's no \`browser_console\` probe. Two paths: (a) ~3 min to add it, then I can diagnose properly. (b) Workaround: I'd guess from the DOM state. Your call?"

Wait for the user's choice. **Don't escalate more than once per request** — if the user picked the workaround, don't re-ask in the same turn.

For minor friction (worked around it but wished it were better), don't interrupt — log it for later review:
- \`ggcoder eyes log rough "<reason>" [--probe <name>]\` — minor friction, you handled it
- \`ggcoder eyes log wish "<gap>"\` — capability you wished existed
- \`ggcoder eyes log blocked "<reason>"\` — call this AFTER the user approves an inline-escalation fix, for the audit trail

These accumulate quietly. The user reviews them periodically. Open signals will appear in your context on future turns until they're acked.
\`\`\`

## Trigger writing rules

The "When to use" triggers are project-specific and the load-bearing piece — without them the agent has probes but no instinct to use them. Rules:
- For each verified probe, write at least one trigger that names a real **file pattern** or **task type** the agent will recognize ("after editing \`*.tsx\` under \`src/ui/\`", not "after UI changes").
- Be **actionable** ("screenshot the page", "hit the endpoint") not **vague** ("verify it works").
- Match density to the project: a UI-heavy app warrants strong visual triggers; a pure backend library does not.

## Restart notice

End your report with:

> ⚠ CLAUDE.md was updated. ggcoder loads CLAUDE.md at startup, so **exit and restart ggcoder** (\`/quit\` then \`ggcoder\` again) before asking me to use these probes. Without a restart, I won't see the new instructions in my context.`,
  },
  {
    name: "eyes-improve",
    aliases: [],
    description: "Triage eyes signals and apply approved probe fixes",
    prompt: `# Eyes Improve: Triage Accumulated Signals

Read the open signals in \`.gg/eyes/journal.jsonl\`, group related ones, propose concrete fixes, and apply what the user approves. This isn't unbounded refactoring — it's incremental probe improvement driven by real use.

## Steps

1. \`ggcoder eyes log list --status open\` — if zero entries, say "nothing to triage" and stop.
2. **Group** signals by likely fix:
   - Multiple \`rough\` entries naming the same probe / same frustration → one patch to that probe.
   - \`wish\` entries naming a capability not installed → one \`ggcoder eyes install <cap>\` proposal.
   - \`blocked\` entries are historical (user already resolved inline) → ack them, no new work.
3. **Cap at 5 proposals this run.** If more would apply, mention them and stop — they'll resurface next run.
4. For each group, propose ONE concrete change:
   - **Probe tweak**: read \`.gg/eyes/<name>.sh\`, show a diff, explain what it fixes.
   - **New probe**: \`ggcoder eyes install <cap>\` with a one-line justification.
   - **New/updated trigger**: bullet added under \`## Eyes → When to use\` in CLAUDE.md.
5. Present all proposals as a numbered list with diffs inline. Ask: **"Accept which? Reply with numbers (e.g. '1, 3') or 'none'."**
6. On user reply:
   - For accepted: apply the change. Then \`ggcoder eyes log ack <id>\` for every journal entry the proposal covers.
   - For unmentioned / rejected: \`ggcoder eyes log defer <id>\` so they stop appearing in context every turn. The user can resurrect deferred entries later.
7. **Report**: applied changes (one line each), entries acked, entries deferred.

## Rules

- **No fishing.** Only act on entries already in the journal. Don't scan the repo for hypothetical gaps.
- **No scope creep.** "Add a \`--wait-for-selector\` flag to the visual probe" is in scope. "Rewrite the probe in TypeScript" is not.
- **Preserve user edits.** If \`.gg/eyes/<name>.sh\` has diverged from the shipped impl (user hand-edited), point this out and ask before overwriting.
- **Be honest about tradeoffs.** If a proposed fix might break existing invocations, say so in the proposal.
- **Decline when appropriate.** If open signals are all vague or low-value, say so and defer them — don't manufacture fixes.`,
  },
  {
    name: "simplify",
    aliases: [],
    description: "Review changed code and fix issues found",
    prompt: `# Simplify: Code Review and Cleanup

Review all changed files for reuse, quality, and efficiency. Fix any issues found.

## Phase 1: Identify Changes

Run \`git diff\` (or \`git diff HEAD\` if there are staged changes) to see what changed. If there are no git changes, review the most recently modified files that the user mentioned or that you edited earlier in this conversation.

## Phase 2: Launch Three Review Agents in Parallel

Use the subagent tool to launch all three agents concurrently in a single response (call the subagent tool 3 times in one message). Pass each agent the full diff so it has the complete context.

### Agent 1: Code Reuse Review

For each change:

1. **Search for existing utilities and helpers** that could replace newly written code. Look for similar patterns elsewhere in the codebase — common locations are utility directories, shared modules, and files adjacent to the changed ones.
2. **Flag any new function that duplicates existing functionality.** Suggest the existing function to use instead.
3. **Flag any inline logic that could use an existing utility** — hand-rolled string manipulation, manual path handling, custom environment checks, ad-hoc type guards, and similar patterns are common candidates.

### Agent 2: Code Quality Review

Review the same changes for hacky patterns:

1. **Redundant state**: state that duplicates existing state, cached values that could be derived, observers/effects that could be direct calls
2. **Parameter sprawl**: adding new parameters to a function instead of generalizing or restructuring existing ones
3. **Copy-paste with slight variation**: near-duplicate code blocks that should be unified with a shared abstraction
4. **Leaky abstractions**: exposing internal details that should be encapsulated, or breaking existing abstraction boundaries
5. **Stringly-typed code**: using raw strings where constants, enums (string unions), or branded types already exist in the codebase
6. **Unnecessary JSX nesting**: wrapper Boxes/elements that add no layout value — check if inner component props (flexShrink, alignItems, etc.) already provide the needed behavior
7. **Unnecessary comments**: comments explaining WHAT the code does (well-named identifiers already do that), narrating the change, or referencing the task/caller — delete; keep only non-obvious WHY (hidden constraints, subtle invariants, workarounds)

### Agent 3: Efficiency Review

Review the same changes for efficiency:

1. **Unnecessary work**: redundant computations, repeated file reads, duplicate network/API calls, N+1 patterns
2. **Missed concurrency**: independent operations run sequentially when they could run in parallel
3. **Hot-path bloat**: new blocking work added to startup or per-request/per-render hot paths
4. **Recurring no-op updates**: state/store updates inside polling loops, intervals, or event handlers that fire unconditionally — add a change-detection guard so downstream consumers aren't notified when nothing changed. Also: if a wrapper function takes an updater/reducer callback, verify it honors same-reference returns (or whatever the "no change" signal is) — otherwise callers' early-return no-ops are silently defeated
5. **Unnecessary existence checks**: pre-checking file/resource existence before operating (TOCTOU anti-pattern) — operate directly and handle the error
6. **Memory**: unbounded data structures, missing cleanup, event listener leaks
7. **Overly broad operations**: reading entire files when only a portion is needed, loading all items when filtering for one

## Phase 3: Fix Issues

Wait for all three agents to complete. Aggregate their findings and fix each issue directly. If a finding is a false positive or not worth addressing, note it and move on — do not argue with the finding, just skip it.

When done, briefly summarize what was fixed (or confirm the code was already clean).`,
  },
  {
    name: "batch",
    aliases: [],
    description: "Plan a large change, execute in parallel PRs",
    prompt: `# Batch: Parallel Work Orchestration

You are orchestrating a large, parallelizable change across this codebase.

## Phase 1: Research

Launch one or more subagents using the subagent tool with \`agent: "researcher"\` to deeply research what this instruction touches. You need their results before proceeding, so wait for them to complete. Have them:

- Find ALL files, patterns, and call sites that need to change
- Understand existing conventions so the migration is consistent
- Quantify the surface area (how many files, how many call sites)
- Note any risks or complications

## Phase 2: Plan

After research completes, call the enter_plan tool to enter plan mode. Using the research findings:

1. **Decompose into independent units.** Break the work into 5–30 self-contained units. Each unit must:
   - Be independently implementable on its own git branch (no shared state with sibling units)
   - Be mergeable on its own without depending on another unit's PR landing first
   - Be roughly uniform in size (split large units, merge trivial ones)

   Scale the count to the actual work: few files → closer to 5; hundreds of files → closer to 30. Prefer per-directory or per-module slicing over arbitrary file lists.

2. **Determine the test recipe.** Figure out how a worker can verify its change actually works — not just that unit tests pass. Look for:
   - An existing e2e/integration test suite the worker can run
   - A dev-server + curl pattern (for API changes)
   - A CLI verification pattern (for CLI changes)

   If you cannot find a concrete verification path, ask the user how to verify. Offer 2–3 specific options based on what the researcher found. Do not skip this — the workers cannot ask the user themselves.

3. **Write the plan** to \`.gg/plans/batch.md\` with:
   - Summary of research findings
   - Numbered list of work units — each with: title, file list, one-line description
   - The test recipe (or "skip e2e because …")
   - Note that each worker will use the \`worker\` agent (branch-isolated)

4. Call exit_plan to present the plan for approval.

## Phase 3: Spawn Workers (After Plan Approval)

Record the current branch name first: \`git branch --show-current\`.

Spawn one subagent per work unit using the subagent tool with \`agent: "worker"\`. **Launch them all in a single message block so they run in parallel.**

For each worker, the task must be fully self-contained. Include:
- The overall goal (the user's instruction)
- The starting branch to branch from (the branch name you recorded above)
- This unit's specific task (title, file list, change description — copied verbatim from your plan)
- Any codebase conventions discovered during research
- The test recipe from your plan (or "skip e2e because …")
- These additional instructions, copied verbatim:

\`\`\`
After you finish implementing the change:
1. Self-review your diff for code reuse, quality, and efficiency. Search the codebase for existing utilities that could replace new code. Fix any issues found.
2. Run the project's test suite (check for package.json scripts, Makefile targets, or common commands like npm test, pnpm test, pytest, go test). If tests fail, fix them.
3. Follow the e2e test recipe above. If it says to skip e2e, skip it.
4. Commit all changes with a clear message, push the branch, and create a PR with gh pr create. Use a descriptive title.
5. Switch back to the original branch with git checkout -.
6. End with exactly: PR: <url> or PR: none — <reason>
\`\`\`

## Phase 4: Track Results

After launching all workers, render an initial status table:

| # | Unit | Status | PR |
|---|------|--------|----|
| 1 | <title> | running | — |
| 2 | <title> | running | — |

As workers complete, parse the \`PR: <url>\` line from each result and re-render the table with updated status (\`done\` / \`failed\`) and PR links. Keep a brief failure note for any worker that did not produce a PR.

When all workers have reported, render the final table and a one-line summary (e.g., "22/24 units landed as PRs").`,
  },
  {
    name: "compare",
    aliases: [],
    description: "Compare code against real-world implementations via kencode-search",
    prompt: `Compare the code you just created or modified in this conversation against real-world implementations using the \`mcp__kencode-search__searchCode\` tool.

You already know what you just built. For each file you created or modified, use \`mcp__kencode-search__searchCode\` to search for how real projects implement the same patterns. Look at the specific APIs, hooks, functions, and architecture you used.

If you find something consistently done differently across real codebases, or something commonly included that you left out, report it:

\`\`\`
[MISSING/DIVERGENT/INCOMPLETE] file:line - What it is
Wrote: What was implemented
Real-world: What real projects do instead/additionally
Evidence: kencode-search - pattern seen in X out of Y repos searched
\`\`\`

Style preferences and subjective improvements are not valid findings. Only report things backed by clear kencode-search evidence across multiple repos.

If the code aligns well with real-world patterns, say so. That's a good outcome.`,
  },
  {
    name: "setup-skills",
    aliases: [],
    description: "Audit project, recommend skills ranked by impact",
    prompt: `# Skills Audit: Find useful skills for this project

Analyze this project and recommend skills from the open ecosystem that would make **working on this project more efficient, easier, and safer**. That is the goal, full stop. Every recommendation must pass the test: does this skill save real time, lower real cognitive load, or prevent real mistakes for someone working on THIS project, repeatedly?

Ranked by real impact, not volume.

This project could be anything — a web app, a CLI, a mobile app, a game, firmware, a data pipeline, a library, a scientific tool. Do not assume a stack. Let the codebase tell you what it is, then decide what to look for.

## Phase 1: Understand what this project is

Read just enough to know what kind of project this is. Look at whichever signals actually apply:

- Build / manifest files: \`package.json\`, \`pyproject.toml\`, \`Cargo.toml\`, \`go.mod\`, \`pubspec.yaml\`, \`Podfile\`, Xcode project, Gradle build, \`*.csproj\`, \`CMakeLists.txt\`, Unity/Unreal project files, Makefile — whatever exists.
- Any README, CLAUDE.md, or AGENTS.md.
- Top-level directory layout and obvious entry points.
- Any CI config, lockfile, or config directory that hints at workflow.

**Do NOT read source code yet.** You need only a coarse answer to: what kind of project is this, what platform/stack/language, what stage (greenfield vs mature), and what does the surrounding workflow look like (build, test, release, distribute, deploy — whatever applies for THIS project type).

## Phase 2: Decide which domains to investigate

Based on Phase 1, pick 4–6 domain slices that represent the **recurring work someone actually does on this project** — not abstract "areas of the codebase," but the real activities that eat time, attention, or trust. Do not use a fixed template. The right domains for a Rust CLI are different from an iOS app, a Unity game, a Django backend, a Kubernetes operator, or an ML notebook.

Illustrative only (not prescriptive):

- Web app → shipping features, API changes, handling data safely, deploys
- Mobile app → building screens, store releases, platform quirks, crash & accessibility triage
- CLI tool → adding commands, packaging & distribution, user-facing UX, error handling
- Game → adding content, platform ports, perf passes, build pipeline
- Library → designing public APIs, cutting releases, downstream compatibility, docs/examples
- Data / ML → running experiments, pipeline orchestration, reproducibility, serving models
- Embedded → adding peripherals, size/memory passes, flashing, hardware bring-up

**Announce your chosen domains to the user in one line before spawning agents**, so they can see what you're looking at (e.g. \`Domains: adding content, platform ports, perf passes, build pipeline\`).

## Phase 3: Parallel sweep

Spawn one sub-agent per domain you chose, in parallel using the subagent tool (call it N times in a single response, one task per domain). Each explores its assigned domain and returns skill-worthy opportunities.

**Skill-worthy means**: a recurring activity someone will do on THIS project — shipping, reviewing, migrating, debugging, onboarding, whatever applies — where a reusable instruction set would make it **faster** (efficient), **lower-effort** (easier), or **less likely to break something** (safer). The test is: will this skill save real time, reduce real cognitive load, or prevent real mistakes, repeatedly, on this project? If no, drop it. A domain returning zero candidates is a valid outcome.

Each sub-agent must return candidates in this exact shape, nothing else:

\`\`\`
[domain] — candidate title
Why: one sentence on the real friction observed in THIS project
Search terms: 2–3 keywords the parent should feed to find-skills
\`\`\`

Don't invent. Don't pad.

## Phase 4: Ecosystem search

After all sub-agents complete, use the **skill** tool to invoke the \`find-skills\` skill. Feed it the aggregated candidate list with search terms. Let find-skills drive discovery across skills.sh, vercel-labs/agent-skills, and anthropics/skills.

For each candidate, record the best 0–1 ecosystem match: skill name, source repo URL. If no fit exists, record "no match". **Do NOT install anything yet.**

## Phase 5: Prioritized recommendation

Rank every candidate that returned a real match by **crucial factor** — a 0–100% score combining:

- **Frequency** — how often someone will do this work on this project
- **Lift** — how much the skill makes it faster (efficient), lower-effort (easier), or safer (fewer mistakes, broken builds, bad releases) per hit
- **Fit** — how well the ecosystem match actually matches this project

Present highest first, in this exact format:

\`\`\`
# Skills Audit

1. <skill-name> — 92%
   Benefit: <one sentence on what it does for this project>
   Source: <repo URL>
   Scope: project

2. <skill-name> — 78%
   Benefit: …
   Source: …
   Scope: project
\`\`\`

Cap the list at 8. If you'd list more, you're padding. Default scope is \`project\` per find-skills' rules; only mark \`global\` when the skill is genuinely cross-cutting.

If strong candidates had no ecosystem match, list them at the bottom:

\`\`\`
## Gaps worth authoring

- <candidate title> — <why it matters for this project> — consider scaffolding a custom SKILL.md
\`\`\`

## Phase 6: Wait for the user

After presenting the list, ask which (if any) to install. Install nothing without explicit confirmation. Once confirmed, hand off to find-skills to perform the actual install.`,
  },
  {
    name: "setup",
    aliases: ["setup-project"],
    description: "Audit project hygiene, tooling, verify pipeline, and style-pack alignment",
    prompt: `Audit this project across six categories and report gaps. **Do not fix anything yet.** Wait for me to choose what to address after the report.

Language-agnostic and project-agnostic — adapt findings to the languages and stack actually present. Ignore categories that don't apply (e.g. skip CI for a local-only scratchpad).

## Categories

### 1. Project hygiene

- \`.gitignore\` present and covers the active language(s)?
- \`README.md\` present with at least install + run instructions?
- License file present (if this looks like a public/shareable project)?
- \`.editorconfig\` present?
- Git initialized? (\`.git\` directory exists)

### 2. Toolchain version pinning

- Language version pinned in a canonical file: \`.nvmrc\` / \`package.json#engines\` (Node), \`.python-version\` / \`pyproject.toml#requires-python\` (Python), \`rust-toolchain.toml\` (Rust), the \`go\` line in \`go.mod\`, \`.ruby-version\` (Ruby), etc.
- Lockfile present and committed? (\`package-lock.json\`, \`pnpm-lock.yaml\`, \`yarn.lock\`, \`bun.lockb\`, \`uv.lock\`, \`poetry.lock\`, \`Cargo.lock\`, \`go.sum\`, \`Gemfile.lock\`, \`composer.lock\`)

### 3. Code quality tooling

For each active language, check that a formatter, linter, and (where applicable) type checker are configured:
- **Formatter**: Prettier / ruff format / gofmt (built-in) / rustfmt (built-in) / clang-format / etc.
- **Linter**: ESLint / Ruff / golangci-lint / Clippy / etc. — with a reasonable strictness preset
- **Type checker** (statically-typed langs only): tsc strict, Pyright strict, mypy strict
- **Test framework**: vitest / jest / pytest / go test / cargo test / rspec / etc.

Report which are present, missing, or configured below the pack's strictness recommendation.

### 4. Verify pipeline

- Are \`lint\` / \`typecheck\` / \`format:check\` / \`test\` (or language-equivalent) wired as runnable commands? (scripts in \`package.json\`, \`pyproject.toml\`, a \`Makefile\`, or \`justfile\`)
- Pre-commit hook configured? (\`.husky/\`, \`pre-commit\` framework, \`lefthook\`, etc.) — nice-to-have, not required.
- CI config present? (\`.github/workflows/\`, \`.gitlab-ci.yml\`, \`.circleci/\`, etc.)

### 5. Style pack alignment

"Active style packs" refers specifically to the **Language Style Packs** section in your system prompt (e.g. TypeScript, Python, Go). It does **NOT** include Skills (\`.gg/skills/\`) or any other extension category. If the Language Style Packs section is absent or empty, **skip this entire section entirely** — do not substitute Skills or any other concept.

When Language Style Packs are present, compare the project against each pack's **Tooling** bullet and the system prompt's **Verification** commands:
- Tooling: which strict-mode flags or lint-rule presets does the pack recommend that the project is missing? (e.g. \`tsconfig\` missing \`noUncheckedIndexedAccess\`, \`pyproject\` missing \`[tool.ruff]\`).
- Dependencies: list which pack-mentioned libs (Zod, neverthrow, Pydantic, thiserror, etc.) the project uses, has an equivalent for, or lacks. **Observation only — no recommendation to install.**

### 6. Documentation hygiene

- \`CLAUDE.md\` or \`AGENTS.md\` present?
- Public API documented? (top-level docstrings, type signatures, or README examples)
- Architecture doc for non-trivial projects? (\`ARCHITECTURE.md\`, \`docs/architecture/\`, ADRs)

## How to investigate

- Read the project root + obvious config locations (\`./\`, \`.github/\`, \`.husky/\`, \`docs/\`).
- Don't recurse into \`node_modules\`, \`dist\`, \`build\`, \`target\`, vendored folders.
- Use \`ls\`, \`read\`, \`find\` (with name patterns) — do not \`grep\` source code for this audit; it's about scaffolding, not code review.
- Cap at ~20 file reads total. If a file is huge (e.g. \`pnpm-lock.yaml\`), don't read its body — presence is what matters.

## Output format

A single Markdown report, organized by category. Within each category, mark each item as one of:
- \`[OK]\` — present and reasonable
- \`[GAP]\` — missing or misconfigured; safe to add/fix
- \`[INFO]\` — observation only, no action implied
- \`[N/A]\` — doesn't apply to this project (omit from output if obvious)

Keep each line to one sentence. No prose paragraphs.

At the end:

\`\`\`
## Summary

<N> gaps in hygiene, <N> in tooling, <N> in verify pipeline, <N> in style-pack alignment.

Which (if any) would you like me to fix? Options:
- A) All [GAP] items that are safe + additive (no overwrites)
- B) Pick category: hygiene / tooling / verify / style-pack alignment
- C) Specific items — tell me which
- D) None — just the report
\`\`\`

## Rules

- **Report only.** No edits, no installs, no commits without explicit user confirmation after the report.
- **No code refactors recommended.** This audit is about scaffolding/tooling, not code review. Use \`/scan\` or \`/verify\` for code-level findings.
- **No dependency installations in the report.** Listing them as observations is fine; recommending installation is not — that's the user's call.
- **Skip empty categories.** If a category has no findings, omit it.
- **Adapt to scale.** A 50-line script doesn't need CI, a license, or an ARCHITECTURE.md. Use judgment.
- **Brand-new empty project**: report "Empty project — nothing to audit. To bootstrap, tell me the stack you want and I'll scaffold from scratch." and stop.`,
  },
];

/** Look up a prompt command by name or alias */
export function getPromptCommand(name: string): PromptCommand | undefined {
  return PROMPT_COMMANDS.find((cmd) => cmd.name === name || cmd.aliases.includes(name));
}
