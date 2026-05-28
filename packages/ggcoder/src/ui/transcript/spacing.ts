import type { CompletedItem } from "../app-items.js";

export const TRANSCRIPT_SPACING_KINDS = [
  "user",
  "assistant",
  "queued",
  "task",
  "goal",
  "goal_progress",
  "tool_start",
  "tool_done",
  "tool_group",
  "server_tool_start",
  "server_tool_done",
  "subagent_group",
  "info",
  "error",
  "stopped",
  "plan_transition",
  "goal_agent_transition",
  "model_transition",
  "theme_transition",
  "plan_event",
  "update_notice",
  "compacting",
  "compacted",
  "duration",
  "step_done",
  "style_pack",
  "setup_hint",
] as const satisfies readonly CompletedItem["kind"][];

const TRANSCRIPT_SPACING_KIND_SET = new Set<CompletedItem["kind"]>(TRANSCRIPT_SPACING_KINDS);

const COMPACT_TRANSCRIPT_BOUNDARIES = new Set<string>([
  "user→assistant",
  "assistant→user",
  "user→queued",
  "assistant→assistant",
]);

export function shouldSeparateTranscriptItems({
  previousKind,
  currentKind,
}: {
  previousKind?: CompletedItem["kind"];
  currentKind: CompletedItem["kind"];
}): boolean {
  if (previousKind === undefined) return false;
  if (!isTranscriptSpacingKind(previousKind) || !isTranscriptSpacingKind(currentKind)) return false;
  return !COMPACT_TRANSCRIPT_BOUNDARIES.has(`${previousKind}→${currentKind}`);
}

export function isTranscriptSpacingKind(kind: CompletedItem["kind"]): boolean {
  return TRANSCRIPT_SPACING_KIND_SET.has(kind);
}

export function isTranscriptSpacingItem(item: CompletedItem): boolean {
  return isTranscriptSpacingKind(item.kind);
}

export function shouldTopSpaceAfterPrintedTranscriptBoundary({
  currentKind,
  previousLiveItem,
  lastPendingHistoryItem,
  lastHistoryItem,
}: {
  currentKind: CompletedItem["kind"];
  previousLiveItem?: CompletedItem;
  lastPendingHistoryItem?: CompletedItem;
  lastHistoryItem?: CompletedItem;
}): boolean {
  if (previousLiveItem !== undefined) return false;
  const previousKind = lastPendingHistoryItem?.kind ?? lastHistoryItem?.kind;
  return shouldSeparateTranscriptItems({ previousKind, currentKind });
}

export function shouldTopSpaceAssistantAfterToolBoundary({
  text,
  previousLiveItem,
  lastPendingHistoryItem,
  lastHistoryItem,
}: {
  text: string;
  previousLiveItem?: CompletedItem;
  lastPendingHistoryItem?: CompletedItem;
  lastHistoryItem?: CompletedItem;
}): boolean {
  if (text.trim().length === 0) return false;
  const previousKind =
    previousLiveItem?.kind ?? lastPendingHistoryItem?.kind ?? lastHistoryItem?.kind;
  return shouldSeparateTranscriptItems({ previousKind, currentKind: "assistant" });
}

export function getTranscriptItemMarginTop({
  item,
  previousLiveItem,
  lastPendingHistoryItem,
  lastHistoryItem,
}: {
  item: CompletedItem;
  previousLiveItem?: CompletedItem;
  lastPendingHistoryItem?: CompletedItem;
  lastHistoryItem?: CompletedItem;
}): number {
  const previousKind =
    previousLiveItem?.kind ?? lastPendingHistoryItem?.kind ?? lastHistoryItem?.kind;
  if (item.kind === "assistant") {
    return shouldTopSpaceAssistantAfterToolBoundary({
      text: item.text,
      previousLiveItem,
      lastPendingHistoryItem,
      lastHistoryItem,
    })
      ? 1
      : 0;
  }
  if (item.kind === "plan_transition") return 0;
  return shouldSeparateTranscriptItems({ previousKind, currentKind: item.kind }) ? 1 : 0;
}

export function shouldTopSpaceStreamingAssistant({
  visibleStreamingText,
  lastLiveItem,
  lastPendingHistoryItem,
  lastHistoryItem,
}: {
  visibleStreamingText: string;
  lastLiveItem?: CompletedItem;
  lastPendingHistoryItem?: CompletedItem;
  lastHistoryItem?: CompletedItem;
}): boolean {
  return shouldTopSpaceAssistantAfterToolBoundary({
    text: visibleStreamingText,
    previousLiveItem: lastLiveItem,
    lastPendingHistoryItem,
    lastHistoryItem,
  });
}
