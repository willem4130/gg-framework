import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { basename } from "node:path";
import {
  formatGoalPrerequisiteInstruction,
  goalHasBlockingPrerequisites,
  isBlockingGoalPrerequisite,
  loadGoalRuns,
  saveGoalRuns,
  summarizeGoalCountsFromRuns,
  type GoalPrerequisite,
  type GoalRun,
  type GoalRunStatus,
  type GoalTask,
} from "../../core/goal-store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useTheme } from "../theme/theme.js";

const GOAL_LOGO = [" ▄▀▀▀ ▄▀▀▀", " █ ▀█ █ ▀█", " ▀▄▄▀ ▀▄▄▀"];
const GRADIENT = [
  "#4ade80",
  "#5ad89a",
  "#6fd2b4",
  "#85ccce",
  "#60a5fa",
  "#85ccce",
  "#6fd2b4",
  "#5ad89a",
];
const GOAL_SUCCESS = "#4ade80";
const GOAL_ACTIVE = "#fbbf24";
const GAP = "   ";
const LOGO_WIDTH = 9;
const SIDE_BY_SIDE_MIN = LOGO_WIDTH + GAP.length + 20;

export interface GoalOverlayProps {
  cwd: string;
  onClose: () => void;
  onRunGoal: (run: GoalRun) => void;
  onVerifyGoal: (run: GoalRun) => void;
  onPauseGoal: (run: GoalRun) => void;
  agentRunning?: boolean;
}

export function clampGoalSelectedIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(0, index), length - 1);
}

export function formatGoalPrerequisiteSummary(run: GoalRun): string {
  if (run.prerequisites.length === 0) return "no prereqs";
  const met = run.prerequisites.filter((item) => item.status === "met").length;
  const missing = run.prerequisites.filter((item) => item.status === "missing").length;
  const unknown = run.prerequisites.filter((item) => item.status === "unknown").length;
  const suffix = [missing > 0 ? `${missing} missing` : "", unknown > 0 ? `${unknown} unknown` : ""]
    .filter(Boolean)
    .join(", ");
  return `${met}/${run.prerequisites.length} prereqs met${suffix ? ` (${suffix})` : ""}`;
}

export function formatGoalTaskSummary(run: GoalRun): string {
  if (run.tasks.length === 0) return "no tasks";
  const done = run.tasks.filter((item) => item.status === "done").length;
  const running = run.tasks.filter(
    (item) => item.status === "running" || item.status === "verifying",
  ).length;
  const failed = run.tasks.filter((item) => item.status === "failed").length;
  const blocked = run.tasks.filter((item) => item.status === "blocked").length;
  const suffix = [
    running > 0 ? `${running} running` : "",
    failed > 0 ? `${failed} failed` : "",
    blocked > 0 ? `${blocked} blocked` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return `${done}/${run.tasks.length} tasks done${suffix ? ` (${suffix})` : ""}`;
}

export function formatGoalVerifierSummary(run: GoalRun): string {
  if (run.verifier?.lastResult) return `verifier ${run.verifier.lastResult.status}`;
  if (run.verifier?.command) return "verifier command ready";
  if (run.verifier?.description) return "verifier described";
  return "no verifier";
}

export function getGoalReadinessText(run: GoalRun): string {
  if (goalHasBlockingPrerequisites(run)) return "needs user input";
  if (run.status === "running" || run.status === "verifying") return "work in progress";
  if (run.status === "passed") return "verified";
  if (run.verifier?.command) return "ready to verify";
  if (run.tasks.length > 0) return "ready to run";
  return "drafting plan";
}

export function formatGoalProgressText(run: GoalRun): string {
  const prereqTotal = run.prerequisites.length;
  const prereqMet = run.prerequisites.filter((item) => item.status === "met").length;
  const taskTotal = run.tasks.length;
  const taskDone = run.tasks.filter((item) => item.status === "done").length;
  const prereq = prereqTotal > 0 ? `prereqs ${prereqMet}/${prereqTotal}` : "no prereqs";
  const tasks = taskTotal > 0 ? `tasks ${taskDone}/${taskTotal}` : "no tasks";
  return `${prereq} · ${tasks}`;
}

export function getGoalStatusCountsText(runs: readonly GoalRun[]): string {
  const counts = summarizeGoalCountsFromRuns(runs);
  return `${counts.passed} passed · ${counts.running} running · ${counts.pending} pending · ${counts.blocked} blocked`;
}

export function clampGoalScrollOffset(
  offset: number,
  itemCount: number,
  viewportRows: number,
): number {
  const visibleRows = Math.max(1, Math.floor(viewportRows));
  const maxOffset = Math.max(0, itemCount - visibleRows);
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(0, Math.floor(offset)), maxOffset);
}

export function getGoalOverlayViewportRows(terminalRows: number, reservedRows = 8): number {
  if (!Number.isFinite(terminalRows)) return 8;
  return Math.max(4, Math.floor(terminalRows) - reservedRows);
}

export function getGoalScrollOffsetForSelection({
  selectedIndex,
  currentOffset,
  itemCount,
  viewportRows,
}: {
  selectedIndex: number;
  currentOffset: number;
  itemCount: number;
  viewportRows: number;
}): number {
  const selected = clampGoalSelectedIndex(selectedIndex, itemCount);
  const offset = clampGoalScrollOffset(currentOffset, itemCount, viewportRows);
  const rows = Math.max(1, Math.floor(viewportRows));
  if (selected < offset) return selected;
  if (selected >= offset + rows) return clampGoalScrollOffset(selected - rows + 1, itemCount, rows);
  return offset;
}

export function getGoalDetailRowCount(run: GoalRun): number {
  let count = 2;

  count += 1 + Math.max(1, run.successCriteria.length);

  if (run.prerequisites.length > 0) {
    count += 1;
    for (const prerequisite of run.prerequisites) {
      count += 1;
      if (isBlockingGoalPrerequisite(prerequisite) || prerequisite.evidence) count += 1;
    }
  }

  count += 1;
  if (run.tasks.length === 0) {
    count += 1;
  } else {
    for (const task of run.tasks) {
      count += 1;
      if (task.lastSummary) count += 1;
    }
  }

  if (run.harness.length > 0) count += 1 + run.harness.length;
  if (run.evidencePlan.length > 0) count += 1 + run.evidencePlan.length;
  if (run.verifier) count += 2;
  if (run.blockers.length > 0) count += 1 + run.blockers.length;
  if (run.evidence.length > 0) count += 1 + Math.min(5, run.evidence.length);
  return count;
}

export function getGoalCardExtraRowCount(run: GoalRun): number {
  let count = 0;
  if (goalHasBlockingPrerequisites(run)) count += 1;
  else if (run.status === "running" || run.status === "verifying") count += 1;
  if (run.blockers.length > 0) count += 1;
  return count;
}

export function getGoalListCardRowCount({ run }: { run: GoalRun }): number {
  const compactCardRows =
    1 + // title/status row
    2 + // compact summary rows
    getGoalCardExtraRowCount(run);
  const marginRows = 1;
  return compactCardRows + marginRows;
}

export interface GoalListWindow {
  start: number;
  end: number;
  hiddenBefore: number;
  hiddenAfter: number;
  rowsUsed: number;
}

function compareGoalListWindows({
  candidate,
  current,
  selectedIndex,
}: {
  candidate: GoalListWindow;
  current: GoalListWindow | null;
  selectedIndex: number;
}): GoalListWindow {
  if (!current) return candidate;
  const candidateCount = candidate.end - candidate.start;
  const currentCount = current.end - current.start;
  if (candidateCount !== currentCount) return candidateCount > currentCount ? candidate : current;
  if (candidate.rowsUsed !== current.rowsUsed)
    return candidate.rowsUsed > current.rowsUsed ? candidate : current;
  const candidateBalance = Math.abs(
    selectedIndex - candidate.start - (candidate.end - selectedIndex - 1),
  );
  const currentBalance = Math.abs(
    selectedIndex - current.start - (current.end - selectedIndex - 1),
  );
  if (candidateBalance !== currentBalance)
    return candidateBalance < currentBalance ? candidate : current;
  return candidate.start > current.start ? candidate : current;
}

export function getGoalListWindow({
  runs,
  selectedIndex,
  viewportRows,
}: {
  runs: readonly GoalRun[];
  selectedIndex: number;
  viewportRows: number;
}): GoalListWindow {
  const rows = Number.isFinite(viewportRows) ? Math.max(1, Math.floor(viewportRows)) : 8;
  const fixedRows = 1;
  if (runs.length === 0) {
    return { start: 0, end: 0, hiddenBefore: 0, hiddenAfter: 0, rowsUsed: fixedRows };
  }

  const selected = clampGoalSelectedIndex(selectedIndex, runs.length);
  let best: GoalListWindow | null = null;

  for (let start = 0; start <= selected; start++) {
    let cardRows = 0;
    for (let end = start + 1; end <= runs.length; end++) {
      const index = end - 1;
      const run = runs[index];
      if (!run) continue;
      cardRows += getGoalListCardRowCount({ run });
      if (end <= selected) continue;

      const hiddenBefore = start;
      const hiddenAfter = runs.length - end;
      const indicatorRows = (hiddenBefore > 0 ? 1 : 0) + (hiddenAfter > 0 ? 1 : 0);
      const rowsUsed = fixedRows + indicatorRows + cardRows;
      if (rowsUsed > rows) continue;

      best = compareGoalListWindows({
        candidate: { start, end, hiddenBefore, hiddenAfter, rowsUsed },
        current: best,
        selectedIndex: selected,
      });
    }
  }

  if (best) return best;

  const start = selected;
  const end = selected + 1;
  const hiddenBefore = start;
  const hiddenAfter = runs.length - end;
  const indicatorRows = (hiddenBefore > 0 ? 1 : 0) + (hiddenAfter > 0 ? 1 : 0);
  const run = runs[selected];
  const cardRows = run ? getGoalListCardRowCount({ run }) : 0;
  return {
    start,
    end,
    hiddenBefore,
    hiddenAfter,
    rowsUsed: fixedRows + indicatorRows + cardRows,
  };
}

export function getGoalExpandedDetailViewportRows({
  viewportRows,
  cardExtraRows,
}: {
  viewportRows: number;
  cardExtraRows: number;
}): number {
  const rows = Number.isFinite(viewportRows) ? Math.max(1, Math.floor(viewportRows)) : 8;
  const selectedCardRows = 1 + Math.max(0, Math.floor(cardExtraRows));
  const fixedRows =
    1 + // Goals heading
    selectedCardRows +
    2 + // selected card border
    1 + // detail top margin
    1; // selected card bottom margin
  return Math.max(1, rows - fixedRows);
}

export function clampGoalDetailScrollOffset(
  offset: number,
  detailRowCount: number,
  viewportRows: number,
): number {
  const visibleRows = Math.max(1, Math.floor(viewportRows));
  const scrolledBodyRows = Math.max(1, visibleRows - 1);
  const maxOffset = Math.max(0, detailRowCount - scrolledBodyRows);
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(0, Math.floor(offset)), maxOffset);
}

export function getGoalDetailScrollWindow({
  detailRowCount,
  scrollOffset,
  viewportRows,
}: {
  detailRowCount: number;
  scrollOffset: number;
  viewportRows: number;
}): { start: number; end: number; hiddenBefore: number; hiddenAfter: number } {
  const rows = Math.max(1, Math.floor(viewportRows));
  const start = clampGoalDetailScrollOffset(scrollOffset, detailRowCount, rows);
  const topIndicatorRows = start > 0 && rows > 2 ? 1 : 0;
  let bodyRows = Math.max(1, rows - topIndicatorRows);
  let hiddenAfter = Math.max(0, detailRowCount - start - bodyRows);
  if (hiddenAfter > 0 && bodyRows > 1) {
    bodyRows -= 1;
    hiddenAfter = Math.max(0, detailRowCount - start - bodyRows);
  }

  return {
    start,
    end: Math.min(detailRowCount, start + bodyRows),
    hiddenBefore: start,
    hiddenAfter,
  };
}

export function sortGoalRunsForOverlay(runs: readonly GoalRun[]): GoalRun[] {
  return [...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function shouldPersistGoalOverlayRuns(
  previousRuns: readonly GoalRun[],
  nextRuns: readonly GoalRun[],
): boolean {
  if (nextRuns.length > 0) return true;
  if (previousRuns.length === 0) return true;
  return !previousRuns.some(
    (run) =>
      run.status === "running" ||
      run.status === "verifying" ||
      run.activeWorkerId !== undefined ||
      run.tasks.some((task) => task.status === "running" || task.status === "verifying"),
  );
}

function GoalGradientText({ text }: { text: string }) {
  const chars: React.ReactNode[] = [];
  let colorIdx = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " ") {
      chars.push(ch);
    } else {
      const color = GRADIENT[colorIdx % GRADIENT.length];
      chars.push(
        <Text key={i} color={color}>
          {ch}
        </Text>,
      );
      colorIdx++;
    }
  }
  return <Text>{chars}</Text>;
}

function formatDisplayPath(cwd: string): string {
  const home = process.env.HOME ?? "";
  return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

function statusColor(status: GoalRunStatus): string {
  switch (status) {
    case "passed":
      return GOAL_SUCCESS;
    case "running":
    case "verifying":
    case "blocked":
      return GOAL_ACTIVE;
    case "failed":
      return "red";
    case "paused":
    case "draft":
    case "ready":
      return "";
  }
}

export function getGoalCardStatusColor({
  status,
  selected,
  primaryColor,
  textColor,
}: {
  status: GoalRunStatus;
  selected: boolean;
  primaryColor: string;
  textColor: string;
}): string {
  return statusColor(status) || (selected ? primaryColor : textColor);
}

export function getGoalCardTitleColor({
  selected,
  primaryColor,
  textColor,
}: {
  selected: boolean;
  primaryColor: string;
  textColor: string;
}): string {
  return selected ? primaryColor : textColor;
}

function verifierSummaryColor(run: GoalRun, fallbackColor: string): string {
  if (run.verifier?.lastResult) return verifierStatusColor(run.verifier.lastResult.status);
  if (run.verifier?.command) return "cyan";
  if (run.verifier?.description) return "magenta";
  return fallbackColor;
}

function taskStatusColor(status: GoalTask["status"]): string {
  switch (status) {
    case "done":
      return "green";
    case "failed":
      return "red";
    case "blocked":
      return "yellow";
    case "running":
    case "verifying":
      return "cyan";
    case "pending":
      return "blue";
  }
}

function prerequisiteStatusColor(status: GoalPrerequisite["status"]): string {
  switch (status) {
    case "met":
      return "green";
    case "missing":
      return "yellow";
    case "unknown":
      return "cyan";
  }
}

function evidencePlanStatusColor(status: GoalRun["evidencePlan"][number]["status"]): string {
  switch (status) {
    case "ready":
      return "green";
    case "blocked":
      return "yellow";
    case "planned":
      return "cyan";
  }
}

function verifierStatusColor(
  status: NonNullable<NonNullable<GoalRun["verifier"]>["lastResult"]>["status"],
): string {
  switch (status) {
    case "pass":
      return "green";
    case "fail":
      return "red";
    case "unknown":
      return "yellow";
  }
}

function evidenceKindColor(kind: GoalRun["evidence"][number]["kind"]): string {
  switch (kind) {
    case "command":
      return "cyan";
    case "file":
      return "blue";
    case "log":
      return "yellow";
    case "screenshot":
      return "magenta";
    case "summary":
      return "green";
  }
}

export function getGoalDetailTaskHeading(run: GoalRun): string {
  return run.prerequisites.length > 0 ? "2. Worker tasks" : "Worker tasks";
}

export function getGoalUserPrerequisiteHeading(run: GoalRun): string | null {
  return run.prerequisites.length > 0 ? "1. User prerequisites" : null;
}

export function formatGoalTaskDetailSummary(summary: string): string {
  const firstLine = summary
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return "";
  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}…` : firstLine;
}

function truncateGoalDetailText(text: string, maxLength = 220): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1)}…` : collapsed;
}

function GoalHeader({
  cwd,
  runs,
  agentRunning,
}: {
  cwd: string;
  runs: readonly GoalRun[];
  agentRunning?: boolean;
}) {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const displayPath = formatDisplayPath(cwd);
  const counts = summarizeGoalCountsFromRuns(runs);

  if (columns < SIDE_BY_SIDE_MIN) {
    return (
      <Box flexDirection="column" marginTop={1} marginBottom={1} width={columns}>
        <GoalGradientText text={GOAL_LOGO[0]} />
        <GoalGradientText text={GOAL_LOGO[1]} />
        <GoalGradientText text={GOAL_LOGO[2]} />
        <Box marginTop={1}>
          <Text color={GOAL_SUCCESS} bold>
            Goal Pane
          </Text>
          {agentRunning && <Text color={GOAL_ACTIVE}> (agent running)</Text>}
          <Text color={theme.textDim}> · {basename(cwd)}</Text>
        </Box>
        <Text color={theme.textDim} wrap="truncate">
          {displayPath}
        </Text>
        <Text>
          <Text color={GOAL_SUCCESS}>{counts.passed} passed</Text>
          <Text color={theme.textDim}> · </Text>
          <Text color={GOAL_ACTIVE}>{counts.running} active</Text>
          <Text color={theme.textDim}> · </Text>
          <Text color={theme.text}>{counts.pending} pending</Text>
          <Text color={theme.textDim}> · </Text>
          <Text color={GOAL_ACTIVE}>{counts.blocked} blocked</Text>
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1} width={columns}>
      <Box>
        <GoalGradientText text={GOAL_LOGO[0]} />
        <Text>{GAP}</Text>
        <Text color={GOAL_SUCCESS} bold>
          Goal Pane
        </Text>
        {agentRunning && <Text color={GOAL_ACTIVE}> (agent running)</Text>}
      </Box>
      <Box>
        <GoalGradientText text={GOAL_LOGO[1]} />
        <Text>{GAP}</Text>
        <Text color={theme.textDim} wrap="truncate">
          {displayPath}
        </Text>
      </Box>
      <Box>
        <GoalGradientText text={GOAL_LOGO[2]} />
        <Text>{GAP}</Text>
        <Text>
          <Text color={GOAL_SUCCESS}>{counts.passed} passed</Text>
          <Text color={theme.textDim}> · </Text>
          <Text color={GOAL_ACTIVE}>{counts.running} active</Text>
          <Text color={theme.textDim}> · </Text>
          <Text color={theme.text}>{counts.pending} pending</Text>
          <Text color={theme.textDim}> · </Text>
          <Text color={GOAL_ACTIVE}>{counts.blocked} blocked</Text>
        </Text>
      </Box>
    </Box>
  );
}

function StatusChip({ label, color }: { label: string; color: string }) {
  return (
    <Text color={color} bold>
      ◖ {label} ◗
    </Text>
  );
}

function GoalDetail({
  run,
  maxRows,
  scrollOffset,
}: {
  run: GoalRun;
  maxRows: number;
  scrollOffset: number;
}) {
  const theme = useTheme();
  const rows: React.ReactNode[] = [
    <Text key="goal-heading">
      <Text color={theme.primary} bold>
        Goal
      </Text>
      <Text color={theme.textDim}> · </Text>
      <Text color={statusColor(run.status) || theme.secondary}>{getGoalReadinessText(run)}</Text>
      <Text color={theme.textDim}> · {formatGoalProgressText(run)}</Text>
    </Text>,
    <Text key="goal-text" color={theme.text}>
      {truncateGoalDetailText(run.goal || run.title)}
    </Text>,
    <Text key="success-heading" color={theme.primary} bold>
      Success criteria
    </Text>,
  ];

  if (run.successCriteria.length === 0) {
    rows.push(
      <Text key="success-none" color={theme.textDim}>
        - none recorded
      </Text>,
    );
  } else {
    for (const [index, criterion] of run.successCriteria.entries()) {
      rows.push(
        <Text key={`success-${index}`}>
          <Text color="green">✓ </Text>
          <Text color={theme.text}>{truncateGoalDetailText(criterion)}</Text>
        </Text>,
      );
    }
  }

  if (run.prerequisites.length > 0) {
    rows.push(
      <Text key="prereq-heading" color={theme.primary} bold>
        {getGoalUserPrerequisiteHeading(run)}
      </Text>,
    );
    for (const prerequisite of run.prerequisites) {
      rows.push(
        <Text key={`prereq-${prerequisite.id}`}>
          <Text color={prerequisiteStatusColor(prerequisite.status)}>● {prerequisite.status}</Text>
          <Text color={theme.text} bold={isBlockingGoalPrerequisite(prerequisite)}>
            {" "}
            {prerequisite.label}
          </Text>
          {isBlockingGoalPrerequisite(prerequisite) ? (
            <Text color={theme.warning}> · user action required</Text>
          ) : null}
        </Text>,
      );
      if (isBlockingGoalPrerequisite(prerequisite)) {
        rows.push(
          <Text key={`prereq-${prerequisite.id}-instruction`} color={theme.textDim} wrap="truncate">
            └─ {formatGoalPrerequisiteInstruction(prerequisite)}
          </Text>,
        );
      } else if (prerequisite.evidence) {
        rows.push(
          <Text key={`prereq-${prerequisite.id}-evidence`} color={theme.textDim} wrap="truncate">
            └─ {prerequisite.evidence}
          </Text>,
        );
      }
    }
  }

  rows.push(
    <Text key="task-heading" color={theme.primary} bold>
      {getGoalDetailTaskHeading(run)}
    </Text>,
  );
  if (run.tasks.length === 0) {
    rows.push(
      <Text key="no-tasks" color={theme.textDim}>
        {goalHasBlockingPrerequisites(run)
          ? "⏸ Waiting for prerequisites before workers can start."
          : "✨ No worker tasks yet — run the goal to generate focused work."}
      </Text>,
    );
  } else {
    for (const task of run.tasks) {
      rows.push(
        <Text key={`task-${task.id}`}>
          <Text color={taskStatusColor(task.status)}>● {task.status}</Text>
          <Text color={theme.text}> {task.title}</Text>
          <Text color={theme.textDim}> · try {task.attempts}</Text>
          {task.workerId ? <Text color={theme.textDim}> · {task.workerId}</Text> : null}
        </Text>,
      );
      if (task.lastSummary) {
        rows.push(
          <Text key={`task-${task.id}-summary`} color={theme.textDim} wrap="truncate">
            └─ {formatGoalTaskDetailSummary(task.lastSummary)}
          </Text>,
        );
      }
    }
  }

  if (run.harness.length > 0) {
    rows.push(
      <Text key="harness-heading" color={theme.primary} bold>
        Harness
      </Text>,
    );
    for (const item of run.harness) {
      rows.push(
        <Text key={`harness-${item.id}`}>
          <Text color="cyan">◦ </Text>
          <Text color={theme.text}>{item.label}</Text>
          {item.command ? <Text color={theme.secondary}> · {item.command}</Text> : null}
          {!item.command && item.path ? <Text color={theme.secondary}> · {item.path}</Text> : null}
        </Text>,
      );
    }
  }

  if (run.evidencePlan.length > 0) {
    rows.push(
      <Text key="evidence-plan-heading" color={theme.primary} bold>
        Evidence plan
      </Text>,
    );
    for (const item of run.evidencePlan) {
      rows.push(
        <Text key={`evidence-plan-${item.id}`}>
          <Text color={evidencePlanStatusColor(item.status)}>● {item.status}</Text>
          <Text color={theme.text}> · {item.label}</Text>
          {item.command ? <Text color={theme.secondary}> · {item.command}</Text> : null}
          {!item.command && item.path ? <Text color={theme.secondary}> · {item.path}</Text> : null}
        </Text>,
      );
    }
  }

  if (run.verifier) {
    rows.push(
      <Text key="verifier-heading" color={theme.primary} bold>
        Verifier
      </Text>,
      <Text key="verifier-summary" wrap="truncate">
        {run.verifier.lastResult ? (
          <Text color={verifierStatusColor(run.verifier.lastResult.status)}>
            ● {formatGoalVerifierSummary(run)}
          </Text>
        ) : (
          <Text color={run.verifier.command ? "cyan" : theme.textDim}>
            ● {formatGoalVerifierSummary(run)}
          </Text>
        )}
        {run.verifier.command ? (
          <Text color={theme.secondary}> · {run.verifier.command}</Text>
        ) : null}
      </Text>,
    );
  }

  if (run.blockers.length > 0) {
    rows.push(
      <Text key="blockers-heading" color={theme.warning} bold>
        Blockers
      </Text>,
    );
    for (const [index, blocker] of run.blockers.entries()) {
      rows.push(
        <Text key={`blocker-${index}`} color={theme.warning}>
          - {truncateGoalDetailText(blocker)}
        </Text>,
      );
    }
  }

  if (run.evidence.length > 0) {
    rows.push(
      <Text key="evidence-heading" color={theme.primary} bold>
        Recent evidence
      </Text>,
    );
    for (const item of run.evidence.slice(-5)) {
      rows.push(
        <Text key={`evidence-${item.id}`}>
          <Text color={evidenceKindColor(item.kind)}>[{item.kind}]</Text>
          <Text color={theme.text}> {item.label}</Text>
          {item.path ? <Text color={theme.secondary}> · {item.path}</Text> : null}
        </Text>,
      );
    }
  }

  const window = getGoalDetailScrollWindow({
    detailRowCount: rows.length,
    scrollOffset,
    viewportRows: maxRows,
  });

  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={2} height={maxRows} overflowY="hidden">
      {window.hiddenBefore > 0 ? (
        <Text color={theme.secondary}>↑ {window.hiddenBefore} detail row(s) above · PgUp</Text>
      ) : null}
      {rows.slice(window.start, window.end)}
      {window.hiddenAfter > 0 ? (
        <Text color={theme.secondary}>↓ {window.hiddenAfter} more detail row(s) · PgDn</Text>
      ) : null}
    </Box>
  );
}

export function GoalOverlay({
  cwd,
  onClose,
  onRunGoal,
  onVerifyGoal,
  onPauseGoal,
  agentRunning,
}: GoalOverlayProps) {
  const theme = useTheme();
  const [runs, setRuns] = useState<GoalRun[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [mode, setMode] = useState<"normal" | "confirmDelete">("normal");
  const [status, setStatus] = useState("");
  const [detailScrollOffset, setDetailScrollOffset] = useState(0);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedRunsRef = useRef<GoalRun[]>([]);

  const showStatus = useCallback((message: string) => {
    setStatus(message);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(""), 2500);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void loadGoalRuns(cwd).then((nextRuns) => {
        if (cancelled) return;
        setRuns((previousRuns) => {
          const sorted = sortGoalRunsForOverlay(nextRuns);
          if (!shouldPersistGoalOverlayRuns(previousRuns, sorted)) {
            showStatus(
              "Goal store reload looked empty while work is active; preserving local state.",
            );
            return previousRuns;
          }
          return JSON.stringify(previousRuns) === JSON.stringify(sorted) ? previousRuns : sorted;
        });
        setLoaded(true);
      });
    };
    load();
    const interval = setInterval(load, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (statusTimer.current) clearTimeout(statusTimer.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [cwd]);

  useEffect(() => {
    setSelectedIndex((index) => clampGoalSelectedIndex(index, runs.length));
  }, [runs.length]);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!shouldPersistGoalOverlayRuns(lastPersistedRunsRef.current, runs)) {
        showStatus("Refusing to save an empty Goal list while work is active.");
        return;
      }
      lastPersistedRunsRef.current = runs;
      void saveGoalRuns(cwd, runs);
    }, 100);
  }, [cwd, loaded, runs]);

  const { rows } = useTerminalSize();
  const viewportRows = getGoalOverlayViewportRows(rows);
  const selectedRun = runs[selectedIndex];
  const expandedRun = selectedRun && selectedRun.id === expandedRunId ? selectedRun : null;
  const selectedCardExtraRows = selectedRun ? getGoalCardExtraRowCount(selectedRun) : 0;
  const expandedCardExtraRows = expandedRun ? selectedCardExtraRows : 0;
  const detailViewportRows = expandedRun
    ? getGoalExpandedDetailViewportRows({
        viewportRows,
        cardExtraRows: expandedCardExtraRows,
      })
    : 0;
  const listWindow = expandedRun
    ? null
    : getGoalListWindow({
        runs,
        selectedIndex,
        viewportRows,
      });
  const scrollOffset = expandedRun ? selectedIndex : (listWindow?.start ?? 0);
  const visibleRuns = expandedRun
    ? [expandedRun]
    : runs.slice(listWindow?.start ?? 0, listWindow?.end ?? 0);
  const hiddenBefore = expandedRun ? 0 : (listWindow?.hiddenBefore ?? 0);
  const hiddenAfter = expandedRun ? 0 : (listWindow?.hiddenAfter ?? 0);
  const detailRowCount = expandedRun ? getGoalDetailRowCount(expandedRun) : 0;

  useEffect(() => {
    setDetailScrollOffset(0);
  }, [expandedRunId]);

  useEffect(() => {
    setDetailScrollOffset((offset) =>
      clampGoalDetailScrollOffset(offset, detailRowCount, detailViewportRows),
    );
  }, [detailRowCount, detailViewportRows]);

  useInput((input, key) => {
    if (mode === "confirmDelete") {
      if (key.escape || input === "n") {
        setMode("normal");
        showStatus("Archive cancelled");
        return;
      }
      if (input === "y" && selectedRun) {
        setRuns((previousRuns) => previousRuns.filter((run) => run.id !== selectedRun.id));
        setExpandedRunId(null);
        setMode("normal");
        showStatus("Goal archived");
      }
      return;
    }

    if (key.escape) {
      onClose();
      return;
    }
    if (expandedRun && (key.pageUp || input === "[")) {
      setDetailScrollOffset((offset) =>
        clampGoalDetailScrollOffset(
          offset - Math.max(1, detailViewportRows - 1),
          detailRowCount,
          detailViewportRows,
        ),
      );
      return;
    }
    if (expandedRun && (key.pageDown || input === "]")) {
      setDetailScrollOffset((offset) =>
        clampGoalDetailScrollOffset(
          offset + Math.max(1, detailViewportRows - 1),
          detailRowCount,
          detailViewportRows,
        ),
      );
      return;
    }
    if (expandedRun && key.home) {
      setDetailScrollOffset(0);
      return;
    }
    if (expandedRun && key.end) {
      setDetailScrollOffset(
        clampGoalDetailScrollOffset(detailRowCount, detailRowCount, detailViewportRows),
      );
      return;
    }
    if (expandedRun && (key.upArrow || input === "k")) {
      setDetailScrollOffset((offset) =>
        clampGoalDetailScrollOffset(offset - 1, detailRowCount, detailViewportRows),
      );
      return;
    }
    if (expandedRun && (key.downArrow || input === "j")) {
      setDetailScrollOffset((offset) =>
        clampGoalDetailScrollOffset(offset + 1, detailRowCount, detailViewportRows),
      );
      return;
    }
    if (key.upArrow || input === "k") {
      setSelectedIndex((index) => clampGoalSelectedIndex(index - 1, runs.length));
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((index) => clampGoalSelectedIndex(index + 1, runs.length));
      return;
    }
    if ((key.return || input === "d") && selectedRun) {
      setExpandedRunId((current) => (current === selectedRun.id ? null : selectedRun.id));
      return;
    }
    if (input === "r" && selectedRun) {
      onRunGoal(selectedRun);
      return;
    }
    if (input === "v" && selectedRun) {
      onVerifyGoal(selectedRun);
      return;
    }
    if (input === "p" && selectedRun) {
      onPauseGoal(selectedRun);
      return;
    }
    if (input === "x" && selectedRun) {
      setMode("confirmDelete");
      showStatus("Archive goal? y/n");
    }
  });

  return (
    <Box flexDirection="column" height={rows} overflow="hidden">
      <GoalHeader cwd={cwd} runs={runs} agentRunning={agentRunning} />

      {agentRunning ? (
        <Box marginBottom={1}>
          <Text color={theme.textDim}>
            Agent is running; Goal pane stays available without resetting chat.
          </Text>
        </Box>
      ) : null}

      {!loaded ? (
        <Box borderStyle="round" borderColor={theme.textDim} paddingX={1}>
          <Text color={theme.textDim}>Loading goals…</Text>
        </Box>
      ) : runs.length === 0 ? (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor={theme.primary}
          paddingX={1}
          paddingY={1}
        >
          <Text color={theme.primary} bold>
            Start a durable Goal run
          </Text>
          <Text color={theme.textDim}>No goals yet. Ask the agent to start a durable Goal.</Text>
          <Text color={theme.textDim}>
            Prerequisites, worker tasks, evidence, and verifier results will appear in this pane.
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" height={viewportRows} overflowY="hidden">
          <Text color={theme.textDim} bold>
            Goals
          </Text>
          {hiddenBefore > 0 ? (
            <Text color={theme.textDim}>
              ↑ {hiddenBefore} earlier goal{hiddenBefore === 1 ? "" : "s"}
            </Text>
          ) : null}
          {visibleRuns.map((run, visibleIndex) => {
            const index = scrollOffset + visibleIndex;
            const selected = index === selectedIndex;
            const blocked = goalHasBlockingPrerequisites(run);
            return (
              <Box
                key={run.id}
                flexDirection="column"
                marginBottom={1}
                borderStyle={expandedRun?.id === run.id ? "round" : undefined}
                borderColor={expandedRun?.id === run.id ? theme.primary : undefined}
                paddingX={expandedRun?.id === run.id ? 1 : 0}
              >
                <Text wrap="truncate">
                  <Text color={selected ? theme.primary : theme.textDim}>
                    {selected ? "❯ " : "  "}
                  </Text>
                  <StatusChip
                    label={run.status}
                    color={getGoalCardStatusColor({
                      status: run.status,
                      selected,
                      primaryColor: theme.primary,
                      textColor: theme.text,
                    })}
                  />
                  <Text
                    color={getGoalCardTitleColor({
                      selected,
                      primaryColor: theme.primary,
                      textColor: theme.text,
                    })}
                    bold={selected}
                  >
                    {" "}
                    {run.title}
                  </Text>
                  <Text color={theme.textDim}> · {run.id.slice(0, 8)}</Text>
                </Text>
                {expandedRun?.id === run.id ? null : (
                  <>
                    <Text wrap="truncate">
                      <Text color={theme.textDim}>{selected ? "  " : "    "}</Text>
                      <Text color={statusColor(run.status) || theme.secondary}>
                        {getGoalReadinessText(run)}
                      </Text>
                      <Text color={theme.textDim}> · </Text>
                      <Text color={theme.text}>{formatGoalProgressText(run)}</Text>
                      <Text color={theme.textDim}> · </Text>
                      <Text color={verifierSummaryColor(run, theme.textDim)}>
                        {formatGoalVerifierSummary(run)}
                      </Text>
                    </Text>
                    <Text wrap="truncate">
                      <Text color={theme.textDim}>{selected ? "  " : "    "}</Text>
                      <Text
                        color={goalHasBlockingPrerequisites(run) ? theme.warning : GOAL_SUCCESS}
                      >
                        {formatGoalPrerequisiteSummary(run)}
                      </Text>
                      <Text color={theme.textDim}> · </Text>
                      <Text color={run.tasks.length > 0 ? GOAL_SUCCESS : theme.text}>
                        {formatGoalTaskSummary(run)}
                      </Text>
                    </Text>
                  </>
                )}
                {blocked ? (
                  <Text color={theme.warning} wrap="truncate">
                    {selected ? "  " : "    "}⚠ prerequisite needed before workers continue
                  </Text>
                ) : run.status === "running" || run.status === "verifying" ? (
                  <Text color={GOAL_ACTIVE} wrap="truncate">
                    {selected ? "  " : "    "}● active — watching worker/verifier progress
                  </Text>
                ) : null}
                {run.blockers.length > 0 ? (
                  <Text color={theme.warning} wrap="truncate">
                    {selected ? "  " : "    "}blocker: {run.blockers[0]}
                  </Text>
                ) : null}
                {expandedRun?.id === run.id ? (
                  <GoalDetail
                    run={run}
                    maxRows={detailViewportRows}
                    scrollOffset={detailScrollOffset}
                  />
                ) : null}
              </Box>
            );
          })}
          {hiddenAfter > 0 ? (
            <Text color={theme.textDim}>
              ↓ {hiddenAfter} later goal{hiddenAfter === 1 ? "" : "s"}
            </Text>
          ) : null}
        </Box>
      )}

      <Box marginTop={1}>
        {mode === "confirmDelete" ? (
          <Text color={theme.warning}>Confirm archive selected goal: y/n</Text>
        ) : (
          <Text color={theme.textDim}>
            <Text color={theme.primary}>↑↓/jk</Text>
            {expandedRun ? " scroll detail · " : " select · "}
            <Text color={theme.primary}>Enter/d</Text>
            {expandedRun ? " close detail · " : " detail · "}
            {expandedRun ? (
              <>
                <Text color={theme.primary}>PgUp/PgDn</Text>
                {" page detail · "}
              </>
            ) : null}
            <Text color={theme.primary}>r</Text>
            {" run · "}
            <Text color={theme.primary}>v</Text>
            {" verify · "}
            <Text color={theme.primary}>p</Text>
            {" pause · "}
            <Text color={theme.primary}>x</Text>
            {" archive · "}
            <Text color={theme.primary}>Esc</Text>
            {" close"}
          </Text>
        )}
      </Box>
      {status ? (
        <Box>
          <Text color={theme.secondary}>{status}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
