import {
  formatGoalBlockingPrerequisites,
  goalHasBlockingPrerequisites,
  type GoalReference,
  type GoalRun,
  type GoalTask,
} from "./goal-store.js";
import {
  formatGoalReferencesForPrompt,
  referencesRequiringAcknowledgement,
} from "./goal-references.js";

export const DEFAULT_GOAL_TASK_ATTEMPT_LIMIT = 5;
export const DEFAULT_GOAL_VERIFIER_FIX_LIMIT = 5;

export const APPLY_INTEGRATION_TO_MAIN_TASK_TITLE = "Apply integrated worktree to main";
export const COMMIT_INTEGRATED_GOAL_CHANGES_TASK_TITLE = "Commit integrated goal changes";
const FINAL_COMPLETION_AUDIT_TASK_TITLE = "Audit Goal completion evidence";
const DEFAULT_GOAL_COMPLETION_AUDIT_LIMIT = 3;

export type GoalControllerDecision =
  | {
      kind: "blocked";
      reason: string;
    }
  | {
      kind: "create_task";
      title: string;
      prompt: string;
      reason: string;
    }
  | {
      kind: "terminal";
      reason: string;
      status: "blocked" | "failed" | "passed" | "paused";
    }
  | {
      kind: "wait";
      reason: string;
      workerId?: string;
    }
  | {
      kind: "start_worker";
      task: GoalTask;
      attempts: number;
      reason: string;
    }
  | {
      kind: "pause";
      task: GoalTask;
      attempts: number;
      reason: string;
    }
  | {
      kind: "run_verifier";
      command: string;
      reason: string;
    }
  | {
      kind: "complete";
      reason: string;
    };

export interface GoalCompletionCheck {
  ok: boolean;
  reason: string;
}

export interface GoalControllerOptions {
  taskAttemptLimit?: number;
  verifierFixLimit?: number;
}

function needsHarnessInstrumentation(run: GoalRun): boolean {
  return run.harness.some((item) => !item.command && !item.path);
}

function referencePromptSection(references: readonly GoalReference[] | undefined): string {
  const section = formatGoalReferencesForPrompt(references ?? []);
  return section ? `${section}\n\n` : "";
}

function referenceMentionTokens(reference: GoalReference): string[] {
  return [reference.id, reference.label, reference.value, reference.path]
    .filter((token): token is string => !!token?.trim())
    .map((token) => token.toLowerCase());
}

function requiresGoalReliabilityContract(run: GoalRun): boolean {
  const fields = [
    run.goal,
    ...run.successCriteria,
    ...(run.references ?? []).map(
      (reference) => `${reference.id} ${reference.label} ${reference.content ?? ""}`,
    ),
    ...run.evidence.map((item) => `${item.label}\n${item.path ?? ""}\n${item.content ?? ""}`),
  ].join("\n");
  return /GOAL_PLAN/.test(fields);
}

function hasOriginalGoalPromptReference(run: GoalRun): boolean {
  return (run.references ?? []).some(
    (reference) =>
      reference.id === "original-goal-prompt" &&
      reference.kind === "prompt" &&
      reference.content?.trim(),
  );
}

function hasDurableGoalPlan(run: GoalRun): boolean {
  const fields = [
    run.goal,
    ...run.evidence.map((item) => `${item.label}\n${item.path ?? ""}\n${item.content ?? ""}`),
  ].join("\n");
  return /GOAL_PLAN/.test(fields) && /research=/.test(fields) && /success=/.test(fields);
}

function goalPromptDurabilityFailure(run: GoalRun): string | undefined {
  if (!requiresGoalReliabilityContract(run)) return undefined;
  if (!hasOriginalGoalPromptReference(run)) {
    return "Goal is missing durable [original-goal-prompt] reference content.";
  }
  if (!hasDurableGoalPlan(run)) {
    return "Goal is missing durable planner GOAL_PLAN evidence/state.";
  }
  return undefined;
}

function fieldContainsReference(reference: GoalReference, fields: readonly string[]): boolean {
  const haystack = fields.join("\n").toLowerCase();
  return referenceMentionTokens(reference).some((token) => haystack.includes(token));
}

function unacknowledgedGoalReferences(run: GoalRun): GoalReference[] {
  const setupAndWorkFields = [
    ...run.successCriteria,
    ...run.evidencePlan.map(
      (item) =>
        `${item.id} ${item.label} ${item.description} ${item.command ?? ""} ${item.path ?? ""} ${item.evidence ?? ""}`,
    ),
    ...run.tasks.map((task) => `${task.title} ${task.prompt} ${task.lastSummary ?? ""}`),
    ...run.evidence.map((item) => `${item.label} ${item.path ?? ""} ${item.content ?? ""}`),
    run.verifier?.description ?? "",
    run.verifier?.command ?? "",
    run.verifier?.lastResult?.summary ?? "",
    run.completionAudit?.summary ?? "",
  ];
  const completionFields = [
    run.verifier?.description ?? "",
    run.verifier?.command ?? "",
    run.verifier?.lastResult?.summary ?? "",
    run.verifier?.lastResult?.outputPath ?? "",
    run.completionAudit?.summary ?? "",
    run.completionAudit?.outputPath ?? "",
  ];
  return (run.references ?? []).filter((reference) => {
    if (reference.kind === "prompt") {
      return (
        requiresGoalReliabilityContract(run) &&
        reference.id === "original-goal-prompt" &&
        !fieldContainsReference(reference, completionFields)
      );
    }
    if (!referencesRequiringAcknowledgement([reference]).length) return false;
    return !fieldContainsReference(reference, setupAndWorkFields);
  });
}

function buildHarnessTaskPrompt(run: GoalRun): string {
  const harnessItems = run.harness
    .filter((item) => !item.command && !item.path)
    .map((item) => `- ${item.label}: ${item.description ?? "Create local instrumentation."}`)
    .join("\n");
  return (
    `Goal: ${run.goal}\n\n` +
    referencePromptSection(run.references) +
    `Build only the missing local/free harness instrumentation needed before verification. Start by restating the intended experience, the relevant failure modes, and the senses/signals this harness must observe; do not default to generic tests, scripts, screenshots, benchmarks, or simulations unless that signal is required for this specific goal.\n` +
    `${harnessItems}\n\n` +
    `Inventory available local capabilities just deeply enough to choose a proportional instrument, then build it. Update the Goal harness/verifier metadata with the goals tool and record durable evidence showing the instrument exists and works. Do not require paid services or signups; block only with exact user instructions if a true external prerequisite is missing.`
  );
}

function blockedEvidencePlanReason(run: GoalRun): string | undefined {
  const blocked = run.evidencePlan.find((item) => item.status === "blocked");
  if (!blocked) return undefined;
  return `${blocked.label}: ${blocked.instructions?.trim() || "User must provide this evidence prerequisite."}`;
}

function needsEvidenceInstrumentation(run: GoalRun): boolean {
  return unsatisfiedGoalEvidencePlanItems(run).some((item) => item.status === "planned");
}

export function unsatisfiedGoalEvidencePlanItems(run: GoalRun): GoalRun["evidencePlan"] {
  return run.evidencePlan.filter((item) => !evidencePlanItemSatisfiedByDurableEvidence(run, item));
}

function exactTokenReferenced(content: string | undefined, token: string | undefined): boolean {
  return !!content?.trim() && !!token?.trim() && content.includes(token);
}

function evidencePlanItemSatisfiedByDurableEvidence(
  run: GoalRun,
  item: GoalRun["evidencePlan"][number],
): boolean {
  if (item.status === "ready" && item.evidence?.trim()) return true;
  if (item.evidence?.trim()) return true;

  const verifier = run.verifier?.lastResult;
  if (verifier?.status === "pass") {
    if (item.command && verifier.command === item.command) return true;
    if (item.path && verifier.outputPath === item.path) return true;
  }
  return run.evidence.some((evidence) => {
    if (item.path && evidence.path === item.path) return true;
    if (item.command && exactTokenReferenced(evidence.content, item.command)) return true;
    if (item.path && exactTokenReferenced(evidence.content, item.path)) return true;
    return false;
  });
}

export function hasRequiredGoalEvidence(run: GoalRun): GoalCompletionCheck {
  const missing = unsatisfiedGoalEvidencePlanItems(run);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Goal evidence plan is not satisfied: ${missing.map((item) => item.label).join(", ")}.`,
    };
  }
  return {
    ok: true,
    reason: "All required evidence-plan items are ready or proven by durable evidence.",
  };
}

function finalAuditTaskCount(run: GoalRun): number {
  return run.tasks.filter((task) => task.title === FINAL_COMPLETION_AUDIT_TASK_TITLE).length;
}

function hasApplyIntegrationTask(run: GoalRun): boolean {
  return run.tasks.some((task) => task.title === APPLY_INTEGRATION_TO_MAIN_TASK_TITLE);
}

function hasCommitIntegratedChangesTask(run: GoalRun): boolean {
  return run.tasks.some((task) => task.title === COMMIT_INTEGRATED_GOAL_CHANGES_TASK_TITLE);
}

function pendingAfterDependenciesImplementationTasks(run: GoalRun): GoalTask[] {
  return run.tasks.filter(
    (task) =>
      task.status === "done" && task.mergeStrategy === "after_dependencies" && !!task.worktree,
  );
}

function appliedIntegrationEvidence(run: GoalRun): boolean {
  return run.evidence.some(
    (item) =>
      item.label === "Integrated worktree applied to main" ||
      item.label === "Goal decision: apply_integration_to_main",
  );
}

function committedIntegrationEvidence(run: GoalRun): boolean {
  return run.evidence.some((item) => item.label === "Integrated Goal changes committed");
}

function hasIntegratedWorktreeChanges(run: GoalRun): boolean {
  return (
    pendingAfterDependenciesImplementationTasks(run).length > 0 || appliedIntegrationEvidence(run)
  );
}

function needsMainIntegrationApplyTask(run: GoalRun): boolean {
  return (
    pendingAfterDependenciesImplementationTasks(run).length > 0 &&
    !hasApplyIntegrationTask(run) &&
    !appliedIntegrationEvidence(run)
  );
}

function needsIntegratedGoalChangesCommitTask(run: GoalRun): boolean {
  return (
    hasIntegratedWorktreeChanges(run) &&
    appliedIntegrationEvidence(run) &&
    run.verifier?.lastResult?.status === "pass" &&
    !latestNonAuditWorkerEvidenceAfterVerifier(run) &&
    !hasCommitIntegratedChangesTask(run) &&
    !committedIntegrationEvidence(run)
  );
}

function shouldCreateFinalAuditTask(
  run: GoalRun,
  limit = DEFAULT_GOAL_COMPLETION_AUDIT_LIMIT,
): boolean {
  return finalAuditTaskCount(run) < limit;
}

function isFinalAuditWorkerEvidence(run: GoalRun, label: string): boolean {
  const match = /^Worker\s+(\S+)\s+/.exec(label);
  const workerId = match?.[1];
  if (!workerId) return false;
  return run.tasks.some(
    (task) => task.title === FINAL_COMPLETION_AUDIT_TASK_TITLE && task.workerId === workerId,
  );
}

function isCompletionAuditDecision(label: string): boolean {
  return label === "Goal decision: completion_audit";
}

function latestMatchingEvidence(
  evidence: readonly GoalRun["evidence"][number][],
  predicate: (item: GoalRun["evidence"][number]) => boolean,
): GoalRun["evidence"][number] | undefined {
  return evidence.filter(predicate).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function latestNonAuditWorkerEvidenceAfterVerifier(
  run: GoalRun,
): GoalRun["evidence"][number] | undefined {
  const verifierCheckedAt = run.verifier?.lastResult?.checkedAt;
  if (!verifierCheckedAt) return undefined;
  return latestMatchingEvidence(
    run.evidence,
    (item) =>
      item.createdAt > verifierCheckedAt &&
      item.label.startsWith("Worker ") &&
      !isFinalAuditWorkerEvidence(run, item.label),
  );
}

function latestCompletionRelevantEvidenceAfterVerifier(
  run: GoalRun,
): GoalRun["evidence"][number] | undefined {
  const verifierCheckedAt = run.verifier?.lastResult?.checkedAt;
  if (!verifierCheckedAt) return undefined;
  return latestMatchingEvidence(run.evidence, (item) => {
    if (item.createdAt <= verifierCheckedAt) return false;
    if (isFinalAuditWorkerEvidence(run, item.label)) return false;
    if (isCompletionAuditDecision(item.label)) return false;
    if (item.label === "Verifier result" || item.label.startsWith("Verifier ")) return false;
    return item.label.startsWith("Worker ") || item.label.startsWith("Goal decision:");
  });
}

export function hasFreshGoalCompletionAudit(run: GoalRun): GoalCompletionCheck {
  const verifierResult = run.verifier?.lastResult;
  if (!verifierResult || verifierResult.status !== "pass") {
    return { ok: false, reason: "Goal has no passing verifier result to audit." };
  }

  const postVerifierWorkerEvidence = latestNonAuditWorkerEvidenceAfterVerifier(run);
  if (postVerifierWorkerEvidence) {
    return {
      ok: false,
      reason: `Latest verifier result is stale after later Goal worker evidence: ${postVerifierWorkerEvidence.label}.`,
    };
  }

  const audit = run.completionAudit;
  if (!audit) {
    return { ok: false, reason: "Goal has no final completion audit." };
  }
  if (audit.status !== "pass") {
    return { ok: false, reason: `Final completion audit status is ${audit.status}.` };
  }
  if (!audit.summary.startsWith("FINAL_AUDIT_PASS")) {
    return {
      ok: false,
      reason: "Final completion audit pass summary must start with FINAL_AUDIT_PASS.",
    };
  }
  if (!audit.summary.includes(`verifier_checked_at=${verifierResult.checkedAt}`)) {
    return {
      ok: false,
      reason: "Final completion audit pass summary must include latest verifier_checked_at.",
    };
  }
  if (!audit.outputPath && !audit.summary.match(/(?:output|artifact|log|path)=\S+/)) {
    return {
      ok: false,
      reason: "Final completion audit pass must reference verifier output or artifacts.",
    };
  }
  if (audit.verifierCheckedAt !== verifierResult.checkedAt) {
    return {
      ok: false,
      reason: "Final completion audit does not match the latest verifier result.",
    };
  }
  if (audit.checkedAt < verifierResult.checkedAt) {
    return {
      ok: false,
      reason: "Final completion audit is older than the latest verifier result.",
    };
  }

  const newerEvidence = latestCompletionRelevantEvidenceAfterVerifier(run);
  if (newerEvidence && newerEvidence.createdAt > audit.checkedAt) {
    return {
      ok: false,
      reason: `Final completion audit is stale after later Goal evidence: ${newerEvidence.label}.`,
    };
  }

  return { ok: true, reason: "Final completion audit passed after latest verifier evidence." };
}

function buildEvidencePlanTaskPrompt(run: GoalRun): string {
  const plannedItems = unsatisfiedGoalEvidencePlanItems(run)
    .map(
      (item) =>
        `- ${item.label} (${item.mechanism}): ${item.description}${item.command ? `; candidate command: ${item.command}` : ""}${item.path ? `; artifact: ${item.path}` : ""}`,
    )
    .join("\n");
  return (
    `Goal: ${run.goal}\n\n` +
    referencePromptSection(run.references) +
    `Turn the planned proof paths below into real local/free verification capability before the Goal verifier runs. For each path, preserve the orchestrator's goal-specific sensory intent: what experience is being observed, what failure it catches, and what signal proves it.\n` +
    `${plannedItems}\n\n` +
    `Inventory available local capabilities without anchoring on any fixed tool category. Build only the proportional instrument needed for this proof path, update the Goal evidence_plan/harness/verifier metadata with the goals tool, and persist concrete command/file/artifact/log evidence that the instrument works. Do not use narrative-only verification or human visual inspection as completion evidence. Only block with exact user instructions for inputs that cannot be generated or checked locally.`
  );
}

function buildVerifierTaskPrompt(run: GoalRun): string {
  return (
    `Goal: ${run.goal}\n\n` +
    referencePromptSection(run.references) +
    `Define and build a real end-to-end verifier for this Goal. Begin from the intended experience and required senses/signals already implied by the success criteria and evidence plan, including mandatory Goal references. Choose a proportional local/free verifier that observes those signals and catches the important goal-specific failures; do not add generic simulations, screenshots, benchmarks, or scripts unless they directly support that proof. Update the Goal with a verifier_command and verifier_description using the goals tool. The verifier must be runnable locally/free and produce durable command or file evidence, not narrative or human visual inspection. If an external prerequisite is missing, mark it missing with exact user instructions.`
  );
}

function buildApplyIntegrationToMainTaskPrompt(run: GoalRun): string {
  const integrationTasks = pendingAfterDependenciesImplementationTasks(run)
    .map(
      (task) =>
        `- ${task.id} / ${task.title}: worktree=${task.worktree?.path ?? "unknown"}; branch=${task.worktree?.branchName ?? "unknown"}; base=${task.worktree?.baseRef ?? "unknown"}; summary=${task.lastSummary?.slice(0, 600) ?? "none"}`,
    )
    .join("\n");
  return (
    `Goal: ${run.goal}\n\n` +
    referencePromptSection(run.references) +
    `Apply accepted integration worktree changes into the user's main checkout before any release, verifier, final audit, commit, or completion. This task intentionally runs in the main checkout, not a new isolated worktree.\n\n` +
    `Integrated/after-dependencies worker outputs to apply:\n${integrationTasks || "- none recorded"}\n\n` +
    `For each integrated worktree, inspect its candidate packet, patch, diffstat, changed files, base SHA, verification logs, and risk notes. Apply or port only accepted changes to the main checkout; reject stale/risky/unrelated artifacts with durable evidence. Preserve user work. Run targeted checks in the main checkout after applying. Record durable evidence with label "Integrated worktree applied to main" containing the source worktree(s), accepted/rejected artifacts, changed files, diffstat, commands/results, and restart-needed note. Do not commit changes in this task; the controller will schedule a separate commit task after main-checkout verification evidence exists. Do not mark the whole Goal complete.`
  );
}

function buildCommitIntegratedGoalChangesTaskPrompt(run: GoalRun): string {
  return (
    `Goal: ${run.goal}\n\n` +
    referencePromptSection(run.references) +
    `Commit verified integrated Goal changes in the user's main checkout before final audit or completion. This task intentionally runs in the main checkout, not a new isolated worktree.\n\n` +
    `Before committing, inspect git status and recent durable evidence to confirm accepted worktree changes were applied to main and main-checkout verification passed. Preserve user work: commit only files that belong to this Goal's accepted integrated changes, and do not stage unrelated user edits. If unrelated dirty files exist, block with exact paths and instructions instead of committing them.\n\n` +
    `Run a targeted pre-commit check appropriate to the changed files if no fresh main-checkout verification evidence exists. Create one git commit with a concise message describing the Goal changes. Record durable evidence with label "Integrated Goal changes committed" containing the commit hash, staged/committed files, verification command/result used for confidence, and any restart-needed note. Do not mark the whole Goal complete.`
  );
}

function incompleteTasks(run: GoalRun): GoalTask[] {
  return run.tasks.filter((task) => task.status !== "done");
}

function activeTask(run: GoalRun): GoalTask | undefined {
  return run.tasks.find((task) => task.status === "running" || task.status === "verifying");
}

function recoverableTask(task: GoalTask): boolean {
  return task.status === "pending" || task.status === "failed";
}

function taskMatchesDependency(task: GoalTask, dependencyId: string): boolean {
  return task.id === dependencyId || task.id.startsWith(dependencyId);
}

function blockedTaskDependencies(run: GoalRun, task: GoalTask): string[] {
  return (task.dependsOn ?? []).filter((dependencyId) => {
    const dependency = run.tasks.find((item) => taskMatchesDependency(item, dependencyId));
    return dependency === undefined || dependency.status !== "done";
  });
}

function nextRunnableTask(run: GoalRun): GoalTask | undefined {
  return run.tasks.find(
    (task) => recoverableTask(task) && blockedTaskDependencies(run, task).length === 0,
  );
}

function nextBlockedDependencyTask(
  run: GoalRun,
): { task: GoalTask; dependencies: string[] } | undefined {
  for (const task of run.tasks) {
    if (!recoverableTask(task)) continue;
    const dependencies = blockedTaskDependencies(run, task);
    if (dependencies.length > 0) return { task, dependencies };
  }
  return undefined;
}

export function canCompleteGoalRun(run: GoalRun): GoalCompletionCheck {
  if (run.status === "draft") {
    return { ok: false, reason: "Goal setup is incomplete and remains draft." };
  }
  if (run.successCriteria.length === 0) {
    return { ok: false, reason: "Goal setup is incomplete: success criteria are required." };
  }
  if (run.evidencePlan.length === 0) {
    return { ok: false, reason: "Goal setup is incomplete: an evidence plan is required." };
  }
  if (!run.verifier?.command) {
    return { ok: false, reason: "Goal setup is incomplete: verifier command is required." };
  }
  const promptDurabilityFailure = goalPromptDurabilityFailure(run);
  if (promptDurabilityFailure) return { ok: false, reason: promptDurabilityFailure };
  const unacknowledgedReferences = unacknowledgedGoalReferences(run);
  if (unacknowledgedReferences.length > 0) {
    return {
      ok: false,
      reason: `Goal references are not covered by criteria/tasks/evidence/verifier/audit: ${unacknowledgedReferences.map((item) => item.label).join(", ")}.`,
    };
  }
  if (goalHasBlockingPrerequisites(run)) {
    return { ok: false, reason: formatGoalBlockingPrerequisites(run) };
  }

  const remainingTasks = incompleteTasks(run);
  if (remainingTasks.length > 0) {
    return {
      ok: false,
      reason: `${remainingTasks.length} Goal task${remainingTasks.length === 1 ? " is" : "s are"} not done.`,
    };
  }

  const requiredEvidence = hasRequiredGoalEvidence(run);
  if (!requiredEvidence.ok) return requiredEvidence;

  if (hasIntegratedWorktreeChanges(run) && !committedIntegrationEvidence(run)) {
    return {
      ok: false,
      reason: "Integrated Goal changes have not been committed in the main checkout.",
    };
  }

  const verifierResult = run.verifier?.lastResult;
  if (!verifierResult) {
    return { ok: false, reason: "Goal has no verifier evidence." };
  }
  if (verifierResult.status !== "pass") {
    return { ok: false, reason: `Verifier status is ${verifierResult.status}.` };
  }

  const completionAudit = hasFreshGoalCompletionAudit(run);
  if (!completionAudit.ok) return completionAudit;

  return {
    ok: true,
    reason: "All tasks are done, verifier evidence passed, and final completion audit passed.",
  };
}

export function shouldClearGoalContinuation(decision: GoalControllerDecision): boolean {
  return decision.kind !== "wait";
}

export function shouldCreateVerifierFixTask(
  run: GoalRun,
  limit = DEFAULT_GOAL_VERIFIER_FIX_LIMIT,
): boolean {
  return run.tasks.filter((task) => task.title === "Fix verifier failure").length < limit;
}

export function verifierFixTaskCount(run: GoalRun): number {
  return run.tasks.filter((task) => task.title === "Fix verifier failure").length;
}

export function hasRepeatedVerifierFailure(run: GoalRun, repeatLimit = 2): boolean {
  const failures = run.evidence
    .filter((item) => item.label === "Verifier fail" || item.label === "Verifier result")
    .map((item) => (item.content ?? "").trim())
    .filter(Boolean);
  if (failures.length < repeatLimit) return false;
  const last = failures[failures.length - 1];
  return failures.slice(-repeatLimit).every((item) => item === last);
}

function buildFinalCompletionAuditTaskPrompt(run: GoalRun): string {
  const verifier = run.verifier?.lastResult;
  const evidencePlanItems = run.evidencePlan
    .map(
      (item) =>
        `- ${item.id} / ${item.label} (${item.status}, ${item.mechanism}): ${item.description}${item.command ? `; command=${item.command}` : ""}${item.path ? `; path=${item.path}` : ""}${item.evidence ? `; evidence=${item.evidence}` : ""}`,
    )
    .join("\n");
  const recentEvidence = run.evidence
    .slice(-12)
    .map(
      (item) =>
        `- ${item.createdAt} ${item.label}${item.path ? ` (${item.path})` : ""}: ${(item.content ?? "").slice(0, 320)}`,
    )
    .join("\n");
  return (
    `Goal: ${run.goal}\n\n` +
    referencePromptSection(run.references) +
    `You are the final read-only Goal completion auditor. Do not edit files, do not run broad implementation work, do not mark the Goal complete, and do not trust worker summaries by themselves. Verify the original success criteria and every mandatory Goal reference against actual durable artifacts after the latest verifier pass.\n\n` +
    `Success criteria:\n${run.successCriteria.map((item) => `- ${item}`).join("\n") || "- none recorded"}\n\n` +
    `Latest verifier: status=${verifier?.status ?? "unknown"}; checkedAt=${verifier?.checkedAt ?? "unknown"}; command=${verifier?.command ?? run.verifier?.command ?? "not recorded"}; output=${verifier?.outputPath ?? "not recorded"}; summary=${verifier?.summary ?? "not recorded"}\n\n` +
    `Evidence plan:\n${evidencePlanItems || "- none"}\n\n` +
    `Recent durable evidence:\n${recentEvidence || "- none"}\n\n` +
    `Read the referenced report/log/source artifacts and compare them with the latest verifier result. The coordinator schedules and records decisions/state; the verifier path/UI/controller executes the configured verifier command as the final pre-audit gate and records goals verify evidence; this final audit records goals audit only after comparing the latest verifier output and references, including [original-goal-prompt] and durable GOAL_PLAN evidence. If an evidence-plan item is still planned but already matched by durable verifier/source/file evidence, update that evidence_plan item to status=ready with a concise evidence summary before recording the audit; if proof is missing, create a new pending Goal task with exact fix instructions and do not pass the audit. If everything matches, record a passing completion audit with the goals tool by using action=audit, verification_status=pass, output_path matching the verifier output when available, and a summary that starts with "FINAL_AUDIT_PASS" and includes "verifier_checked_at=${verifier?.checkedAt ?? "unknown"}", "original-goal-prompt", and "GOAL_PLAN". If anything is missing, stale, contradictory, or unverified, create a new pending Goal task with exact instructions to fix it, record evidence describing the mismatch, and leave the audit failing or absent so the coordinator resumes a worker until fixed.`
  );
}

function buildVerifierFailureTaskPrompt(run: GoalRun): string {
  const result = run.verifier?.lastResult;
  const priorSummaries =
    run.evidence
      .filter((item) => item.label.startsWith("Verifier"))
      .slice(-3)
      .map(
        (item) =>
          `- ${item.label}${item.path ? ` (${item.path})` : ""}: ${(item.content ?? "").slice(0, 500)}`,
      )
      .join("\n") || "- none";
  const attempt = verifierFixTaskCount(run) + 1;
  return (
    `Original objective: ${run.goal}\n\n` +
    referencePromptSection(run.references) +
    `Success criteria:\n${run.successCriteria.map((item) => `- ${item}`).join("\n") || "- none recorded"}\n\n` +
    `Verifier command: ${run.verifier?.command ?? "(missing)"}\n` +
    `Exit code: ${result?.exitCode ?? "unknown"}\n` +
    `Output path: ${result?.outputPath ?? "not recorded"}\n` +
    `Fix attempt ${attempt}/${DEFAULT_GOAL_VERIFIER_FIX_LIMIT}.\n\n` +
    `Prior verifier summaries:\n${priorSummaries}\n\n` +
    `Run targeted diagnostics, fix the root cause, update durable Goal evidence with the goals tool, and rerun the exact verifier command. Do not mark the Goal complete.`
  );
}

export function formatGoalControllerDecision(decision: GoalControllerDecision): {
  label: string;
  content: string;
} {
  const parts = [`kind=${decision.kind}`];
  if ("reason" in decision) parts.push(`reason=${decision.reason}`);
  if (decision.kind === "start_worker" || decision.kind === "pause") {
    parts.push(
      `task=${decision.task.id}`,
      `title=${decision.task.title}`,
      `attempts=${decision.attempts}`,
    );
    if (decision.task.workerId) parts.push(`worker=${decision.task.workerId}`);
    if (decision.task.dependsOn?.length)
      parts.push(`depends_on=${decision.task.dependsOn.join(",")}`);
    if (decision.task.parallelGroup) parts.push(`parallel_group=${decision.task.parallelGroup}`);
    if (decision.task.expectedChangedScope?.length) {
      parts.push(`expected_changed_scope=${decision.task.expectedChangedScope.join(",")}`);
    }
    if (decision.task.mergeStrategy) parts.push(`merge_strategy=${decision.task.mergeStrategy}`);
  }
  if (decision.kind === "wait" && decision.workerId) parts.push(`worker=${decision.workerId}`);
  if (decision.kind === "run_verifier") parts.push(`verifier=${decision.command}`);
  if (decision.kind === "terminal") parts.push(`status=${decision.status}`);
  if (decision.kind === "create_task") parts.push(`title=${decision.title}`);
  return { label: `Goal decision: ${decision.kind}`, content: parts.join("; ") };
}

export function decideGoalNextAction(
  run: GoalRun,
  options: GoalControllerOptions = {},
): GoalControllerDecision {
  const completion = canCompleteGoalRun(run);
  if (completion.ok) {
    if (run.continueRequestedAt && run.verifier?.command) {
      return {
        kind: "run_verifier",
        command: run.verifier.command,
        reason: "Goal rerun requested; rerunning configured verifier before any new final audit.",
      };
    }
    return { kind: "complete", reason: completion.reason };
  }

  if (goalHasBlockingPrerequisites(run)) {
    return { kind: "blocked", reason: formatGoalBlockingPrerequisites(run) };
  }

  if (
    (run.status === "blocked" && run.verifier?.lastResult?.status !== "pass") ||
    run.status === "failed" ||
    (run.status === "passed" && run.verifier?.lastResult?.status !== "pass") ||
    (run.status === "paused" && !run.continueRequestedAt)
  ) {
    return { kind: "terminal", status: run.status, reason: `Goal is ${run.status}.` };
  }

  if (run.activeWorkerId) {
    return {
      kind: "wait",
      reason: "Goal already has an active worker.",
      workerId: run.activeWorkerId,
    };
  }

  const runningTask = activeTask(run);
  if (runningTask) {
    return {
      kind: "wait",
      reason: `Goal task "${runningTask.title}" is already ${runningTask.status}.`,
      ...(runningTask.workerId ? { workerId: runningTask.workerId } : {}),
    };
  }

  const task = nextRunnableTask(run);
  if (task) {
    const attempts = task.attempts + 1;
    const limit = options.taskAttemptLimit ?? DEFAULT_GOAL_TASK_ATTEMPT_LIMIT;
    if (attempts > limit) {
      return {
        kind: "pause",
        task,
        attempts,
        reason: `Attempt limit reached for task ${task.title}.`,
      };
    }
    return {
      kind: "start_worker",
      task,
      attempts,
      reason: `Goal task "${task.title}" is ready for worker attempt ${attempts}.`,
    };
  }

  const dependencyBlockedTask = nextBlockedDependencyTask(run);
  if (dependencyBlockedTask) {
    const missingDependencies = dependencyBlockedTask.dependencies.filter(
      (dependencyId) => !run.tasks.some((item) => taskMatchesDependency(item, dependencyId)),
    );
    if (missingDependencies.length > 0) {
      return {
        kind: "blocked",
        reason: `Goal task "${dependencyBlockedTask.task.title}" depends on missing task(s): ${missingDependencies.join(", ")}.`,
      };
    }
    return {
      kind: "wait",
      reason: `Goal task "${dependencyBlockedTask.task.title}" is waiting for dependency task(s): ${dependencyBlockedTask.dependencies.join(", ")}.`,
    };
  }

  const blockedEvidence = blockedEvidencePlanReason(run);
  if (blockedEvidence) {
    return { kind: "blocked", reason: blockedEvidence };
  }

  if (needsMainIntegrationApplyTask(run)) {
    return {
      kind: "create_task",
      title: APPLY_INTEGRATION_TO_MAIN_TASK_TITLE,
      prompt: buildApplyIntegrationToMainTaskPrompt(run),
      reason:
        "Accepted integration worktree changes must be applied to the user's main checkout before verifier, final audit, release, commit, or completion.",
    };
  }

  if (needsIntegratedGoalChangesCommitTask(run)) {
    return {
      kind: "create_task",
      title: COMMIT_INTEGRATED_GOAL_CHANGES_TASK_TITLE,
      prompt: buildCommitIntegratedGoalChangesTaskPrompt(run),
      reason:
        "Verified integrated Goal changes must be committed in the user's main checkout before final audit or completion.",
    };
  }

  if (
    run.verifier?.lastResult?.status === "pass" &&
    latestNonAuditWorkerEvidenceAfterVerifier(run) &&
    run.verifier?.command
  ) {
    return {
      kind: "run_verifier",
      command: run.verifier.command,
      reason:
        "Latest verifier result is stale after later Goal worker evidence; rerunning configured verifier as the final pre-audit gate.",
    };
  }

  if (needsEvidenceInstrumentation(run)) {
    if (run.verifier?.lastResult?.status === "pass") {
      if (shouldCreateFinalAuditTask(run)) {
        return {
          kind: "create_task",
          title: FINAL_COMPLETION_AUDIT_TASK_TITLE,
          prompt: buildFinalCompletionAuditTaskPrompt(run),
          reason: `Verifier passed; final read-only audit must reconcile ${unsatisfiedGoalEvidencePlanItems(run).length} evidence-plan item(s) before the Goal can pass (${finalAuditTaskCount(run) + 1}/${DEFAULT_GOAL_COMPLETION_AUDIT_LIMIT}).`,
        };
      }
      return {
        kind: "blocked",
        reason:
          "Verifier passed, but final completion audit did not reconcile the Goal evidence plan after bounded attempts.",
      };
    }
    return {
      kind: "create_task",
      title: "Build Goal evidence path",
      prompt: buildEvidencePlanTaskPrompt(run),
      reason:
        "Goal evidence plan requires local instrumentation or exact prerequisite handling before verification.",
    };
  }

  if (needsHarnessInstrumentation(run)) {
    return {
      kind: "create_task",
      title: "Build Goal verification harness",
      prompt: buildHarnessTaskPrompt(run),
      reason: "Goal harness requires local instrumentation before verification.",
    };
  }

  if (run.verifier?.lastResult?.status === "fail") {
    if (hasRepeatedVerifierFailure(run)) {
      return {
        kind: "blocked",
        reason:
          "Verifier produced the same failure repeatedly; pause for diagnosis before creating more fix tasks.",
      };
    }
    const limit = options.verifierFixLimit ?? DEFAULT_GOAL_VERIFIER_FIX_LIMIT;
    if (shouldCreateVerifierFixTask(run, limit)) {
      return {
        kind: "create_task",
        title: "Fix verifier failure",
        prompt: buildVerifierFailureTaskPrompt(run),
        reason: `Verifier failed; creating bounded fix task ${verifierFixTaskCount(run) + 1}/${limit}.`,
      };
    }
    return {
      kind: "pause",
      task: {
        id: "verifier-fix-limit",
        title: "Fix verifier failure",
        prompt: "Verifier fix attempt limit reached.",
        status: "blocked",
        attempts: limit,
      },
      attempts: limit,
      reason: `Verifier fix task limit reached (${limit}).`,
    };
  }

  if (run.verifier?.lastResult?.status === "pass") {
    if (shouldCreateFinalAuditTask(run)) {
      return {
        kind: "create_task",
        title: FINAL_COMPLETION_AUDIT_TASK_TITLE,
        prompt: buildFinalCompletionAuditTaskPrompt(run),
        reason: `Verifier passed; creating final read-only completion audit before the Goal can pass (${finalAuditTaskCount(run) + 1}/${DEFAULT_GOAL_COMPLETION_AUDIT_LIMIT}).`,
      };
    }
    return {
      kind: "blocked",
      reason: "Verifier passed, but final completion audit did not pass after bounded attempts.",
    };
  }

  if (run.verifier?.command) {
    return {
      kind: "run_verifier",
      command: run.verifier.command,
      reason: "All Goal tasks are done; running configured verifier for real completion evidence.",
    };
  }

  return {
    kind: "create_task",
    title: "Define Goal verifier",
    prompt: buildVerifierTaskPrompt(run),
    reason: "No pending Goal task or verifier command is configured.",
  };
}
