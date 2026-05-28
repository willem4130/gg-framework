import { stripDoneMarkers } from "../utils/plan-steps.js";
import type { CompletedItem, SubAgentGroupItem, ToolGroupItem } from "./app-items.js";

/**
 * Cap memory by replacing old finalized rows with tiny tombstones. The full
 * transcript is already printed into terminal scrollback, so the in-memory copy
 * only needs enough recent structure to survive remounts and session mirroring.
 */
const MAX_LIVE_HISTORY = 200;
export function compactHistory(items: CompletedItem[]): CompletedItem[] {
  if (items.length <= MAX_LIVE_HISTORY) return items;
  const cutoff = items.length - MAX_LIVE_HISTORY;
  const compacted = new Array<CompletedItem>(items.length);
  for (let i = 0; i < cutoff; i++) {
    const it = items[i];
    compacted[i] = it.kind === "tombstone" ? it : { kind: "tombstone", id: it.id };
  }
  for (let i = cutoff; i < items.length; i++) {
    compacted[i] = items[i];
  }
  return compacted;
}

export function getNextGeneratedItemId(items: readonly Pick<CompletedItem, "id">[]): number {
  let max = -1;
  for (const item of items) {
    const raw = item.id.startsWith("ui-") ? item.id.slice(3) : item.id;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n > max) max = n;
  }
  return max + 1;
}

export function removeItemsWithIds<T extends Pick<CompletedItem, "id">>(
  items: readonly T[],
  removedIds: ReadonlySet<string>,
): T[] {
  if (removedIds.size === 0) return [...items];
  return items.filter((item) => !removedIds.has(item.id));
}

export function uniqueItemsById<T extends Pick<CompletedItem, "id">>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

/** Check whether an item is still active (running spinner, pending result). */
export function isActiveItem(item: CompletedItem): boolean {
  switch (item.kind) {
    case "tool_start":
    case "server_tool_start":
    case "queued":
    case "compacting":
      return true;
    case "plan_transition":
      return item.active;
    case "tool_group":
      return (item as ToolGroupItem).tools.some((t) => t.status === "running");
    case "subagent_group":
      return (item as SubAgentGroupItem).agents.some((a) => a.status === "running");
    default:
      return false;
  }
}

/**
 * Partition live items into completed (flushable to finalized history) and still-active.
 * Completed items precede active ones — we flush the longest contiguous prefix
 * of completed items to keep ordering stable.
 */
export function partitionCompleted(items: CompletedItem[]): {
  flushed: CompletedItem[];
  remaining: CompletedItem[];
} {
  // Find the first active item — everything before it is safe to flush as a
  // single chronological prefix. Splitting assistant text out of that prefix
  // lets later tool rows print to scrollback above the message that introduced
  // them, so keep the prefix intact.
  const firstActiveIdx = items.findIndex(isActiveItem);
  if (firstActiveIdx === -1) {
    return { flushed: items, remaining: [] };
  }
  if (firstActiveIdx === 0) {
    return { flushed: [], remaining: items };
  }
  return {
    flushed: items.slice(0, firstActiveIdx),
    remaining: items.slice(firstActiveIdx),
  };
}

export function normalizeAssistantText(text: string): string {
  return stripDoneMarkers(text).trim();
}
function isReasoningMarkerText(text: string): boolean {
  return /^(?:currentItem\?\.type\s*=+\s*)?["']?reasoning["']?$/u.test(text.trim());
}

export function isSameAssistantText(item: CompletedItem, text: string): boolean {
  return item.kind === "assistant" && normalizeAssistantText(item.text) === text;
}

export function pinStreamingTextBeforeToolBoundary({
  items,
  visibleStreamingText,
  thinking,
  thinkingMs,
  makeId,
}: {
  items: CompletedItem[];
  visibleStreamingText: string;
  thinking: string;
  thinkingMs: number;
  makeId: () => string;
}): CompletedItem[] {
  const text = normalizeAssistantText(visibleStreamingText);
  if (text.length === 0 || isReasoningMarkerText(text)) return items;
  if (items.some((item) => item.kind === "assistant")) return items;
  return [
    ...items,
    {
      kind: "assistant",
      text,
      thinking: thinking.length > 0 ? thinking : undefined,
      thinkingMs: thinking.length > 0 ? thinkingMs : undefined,
      id: makeId(),
    },
  ];
}
