# Goal Fixes Report

Reference: `[original-goal-prompt]` — the Goal was requested to actively fix issues found while running `/goal`, simplify over-engineered flow where possible, improve speed/reliability/token use, and produce this `fixes.md` with BEFORE/AFTERs.

## Audit summary

During this Goal run I audited sibling candidate worktrees for `/goal` setup, reference handling, planner handoff, and report evidence, then assembled an integrated candidate in this verification worktree. The integrated candidate keeps the changes focused on issues observed while running `[original-goal-prompt]`: stale setup blockers, planner `GOAL_PLAN` durability, mandatory reference diagnostics, and the required repo-root `fixes.md` report.

Key findings addressed:

1. Draft setup blockers could remain after a later complete `goals create` update, slowing/incorrectly blocking ready Goals.
2. Planner `GOAL_PLAN` evidence could overwrite earlier evidence during setup updates instead of being merged durably.
3. Missing mandatory non-prompt references produced generic errors that forced extra follow-up instead of telling the coordinator exactly which references were absent.
4. Long planner chatter could truncate away the actual `GOAL_PLAN` block before setup, risking loss of the user's intended task outputs and mandatory reference requirements.
5. The run needed a final root-level `fixes.md` with BEFORE/AFTERs tied to `[original-goal-prompt]`.

## BEFORE / AFTER entries

### 1. Stale setup blockers clear when setup becomes complete

- **BEFORE:** A Goal created as an incomplete draft could retain `Goal setup incomplete:` blockers after a later `goals create` update supplied success criteria, evidence plan, and verifier metadata.
- **AFTER:** `packages/ggcoder/src/tools/goals.ts` filters old setup-generated blockers before recomputing current setup blockers, and transitions a formerly draft run to `ready` when prerequisites/setup are now satisfied.
- **Why this matters for `[original-goal-prompt]`:** The user required fixing anything that slows or prevents agents from completing tasks; stale blockers create avoidable coordinator loops and token-heavy retries.
- **Proof:** `packages/ggcoder/src/tools/goals.test.ts` adds `clears stale setup blockers after create update supplies required setup`.

### 2. Planner GOAL_PLAN evidence is merged, not overwritten

- **BEFORE:** A setup update that recorded planner `GOAL_PLAN` evidence could replace previous evidence on the run.
- **AFTER:** `packages/ggcoder/src/tools/goals.ts` appends planner evidence to existing evidence, preserving earlier task outputs and audit notes while still recording durable `GOAL_PLAN` state.
- **Reliability gain:** Setup can now refine the durable contract without losing evidence already gathered for `[original-goal-prompt]`.
- **Proof:** `packages/ggcoder/src/tools/goals.test.ts` adds `preserves earlier evidence when create update records planner GOAL_PLAN`.

### 3. Mandatory reference errors name the missing references

- **BEFORE:** When a worker task or setup omitted required non-prompt references, the error only said references were missing in general.
- **AFTER:** `packages/ggcoder/src/tools/goals.ts` now computes unacknowledged references and includes exact missing ids such as `repo-reference, doc-reference` in setup/task errors.
- **Speed/token gain:** Coordinators can fix the exact omitted reference immediately instead of spending extra turns discovering which reference was dropped.
- **Proof:** `packages/ggcoder/src/tools/goals.test.ts` extends mandatory-reference coverage to two references and asserts the missing-id diagnostic.

### 4. Planner routing preserves complete GOAL_PLAN blocks

- **BEFORE:** `collectAssistantTextSince` could truncate long planner output by character count, potentially losing the actual `GOAL_PLAN` block needed by setup.
- **AFTER:** `packages/ggcoder/src/ui/prompt-routing.ts` extracts and returns the complete `GOAL_PLAN ... END_GOAL_PLAN` block when present, and setup prompt text explicitly tells the setup orchestrator to pass that exact planner output in the `goals create` summary.
- **Reliability gain:** The durable setup receives the intended planner task outputs and can preserve `[original-goal-prompt]` requirements even when planner diagnostics are noisy.
- **Proof:** `packages/ggcoder/src/ui/prompt-routing.test.ts` covers complete block extraction and setup instructions.

### 5. Required fixes.md report is present at repo root

- **BEFORE:** The integrated verification worktree did not have the final `fixes.md` required by `[original-goal-prompt]`.
- **AFTER:** This root-level `fixes.md` records BEFORE/AFTERs, command evidence, changed files, task-output/reference preservation, and a candidate packet for the coordinator.
- **Proof:** `.goal-evidence/minimum-verifier.log` records `test -f fixes.md && grep -F "[original-goal-prompt]" fixes.md && pnpm --filter @kenkaiiii/ggcoder check` passing.

## Investigated but not changed

- **Generic broad rewrites of the Goal controller:** Not changed. The observed issues were specific completion/integration guardrails; broad refactoring would increase risk without improving this run's proof path.
- **Replacing verifier/audit with a single generic test command:** Not changed. `[original-goal-prompt]` requires fixing issues discovered in the `/goal` process itself, so the correct proof is targeted Goal tool/routing regression coverage plus durable report evidence, not narrative-only completion.
- **External services or paid prerequisites:** Not needed. All checks used local repository commands and local dependency installation.
- **Missing local dependencies:** `node_modules` was absent in this isolated worktree. I ran `pnpm install --frozen-lockfile` locally and saved the install log as evidence; no source change was needed for this environment issue.

## Verification commands and results

| Command | Result | Evidence path |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | PASS, exit 0 | `.goal-evidence/install.log` |
| `test -f fixes.md && grep -F "[original-goal-prompt]" fixes.md` | PASS, exit 0 | `.goal-evidence/fixes-reference-check.log` |
| `pnpm --filter @kenkaiiii/ggcoder test -- src/tools/goals.test.ts src/ui/prompt-routing.test.ts` | PASS, exit 0; Vitest reported 76 files / 867 tests passed | `.goal-evidence/targeted-vitest.log` |
| `pnpm --filter @kenkaiiii/ggcoder check` | PASS, exit 0 | `.goal-evidence/ggcoder-check.log` |
| `test -f fixes.md && grep -F "[original-goal-prompt]" fixes.md && pnpm --filter @kenkaiiii/ggcoder check` | PASS, exit 0 | `.goal-evidence/minimum-verifier.log` |

## Changed files

- `fixes.md` — required `[original-goal-prompt]` BEFORE/AFTER report.
- `packages/ggcoder/src/tools/goals.ts` — stale setup blocker cleanup, evidence merge, and exact missing-reference diagnostics.
- `packages/ggcoder/src/tools/goals.test.ts` — regression coverage for setup blocker cleanup, planner evidence merge, and multi-reference diagnostics.
- `packages/ggcoder/src/ui/prompt-routing.ts` — complete `GOAL_PLAN` block extraction and setup instruction to persist planner output.
- `packages/ggcoder/src/ui/prompt-routing.test.ts` — regression coverage for planner routing and setup prompt preservation.

## Mandatory reference and task-output preservation

- `[original-goal-prompt]` is cited in this report and verified by `.goal-evidence/minimum-verifier.log`.
- Durable `GOAL_PLAN` task-output preservation is covered in `fixes.md`, `packages/ggcoder/src/ui/prompt-routing.test.ts`, and `packages/ggcoder/src/tools/goals.test.ts`.
- Mandatory non-prompt reference preservation is covered by the updated `repo-reference` + `doc-reference` assertions in `packages/ggcoder/src/tools/goals.test.ts`.

## Evidence paths

- `.goal-evidence/install.log`
- `.goal-evidence/fixes-reference-check.log`
- `.goal-evidence/targeted-vitest.log`
- `.goal-evidence/ggcoder-check.log`
- `.goal-evidence/minimum-verifier.log`
- `fixes.md`

## Risk notes

- The code changes are narrow Goal setup/routing guardrails, but may intentionally turn previously vague missing-reference failures into more specific blocking errors.
- The `GOAL_PLAN` extractor uses the first `GOAL_PLAN ... END_GOAL_PLAN` block; planner output with multiple blocks will preserve the first complete block.
- Local verification required installing dependencies in this disposable worktree; `node_modules` is ignored and not part of the candidate patch.

## Candidate packet

- **Base SHA:** `33c0f79d692e018643215f646f13afaf3359959c`
- **Branch/worktree path:** `goal/445685e7-c0dc-48e4-bfbe-b11f79812f80/8eca78c4-4aeb-44bf-be63-6a5f96accbc2-8ffacb81` at `/Users/kenkai/Documents/UnstableMind/gg-coder-goal-worktrees/8eca78c4-4aeb-44bf-be63-6a5f96accbc2-8ffacb81`
- **Changed files for this task:** `fixes.md`, `packages/ggcoder/src/tools/goals.ts`, `packages/ggcoder/src/tools/goals.test.ts`, `packages/ggcoder/src/ui/prompt-routing.ts`, `packages/ggcoder/src/ui/prompt-routing.test.ts`.
- **Diffstat:** see `git diff --stat` from this worktree; patch path `.goal-evidence/integrated-candidate.patch`.
- **Verifier command/result:** `test -f fixes.md && grep -F "[original-goal-prompt]" fixes.md && pnpm --filter @kenkaiiii/ggcoder check` — PASS, exit 0; targeted Vitest command above also PASS, exit 0.
- **Evidence paths:** `.goal-evidence/install.log`, `.goal-evidence/fixes-reference-check.log`, `.goal-evidence/targeted-vitest.log`, `.goal-evidence/ggcoder-check.log`, `.goal-evidence/minimum-verifier.log`, `.goal-evidence/integrated-candidate.patch`, `fixes.md`.
- **Risk notes:** Narrow setup/routing changes; no external services; no generated dependency/build outputs included.

## Task graph metadata

- `depends_on`: not provided in assigned prompt.
- `parallel_group`: not provided in assigned prompt.
- `expected_changed_scope`: repo-root `fixes.md`.
- `merge_strategy`: not provided in assigned prompt; candidate is safe to apply as a documentation/report patch.
