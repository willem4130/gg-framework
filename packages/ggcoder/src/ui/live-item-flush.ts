/**
 * Pure functions for flushing completed live items to Static history.
 *
 * During an agent run, items (text blocks, tool calls, etc.) accumulate in
 * the live area. Ink re-renders ALL live items on every state change, so if
 * they grow unbounded the live area becomes very tall, making Ink's cursor
 * math expensive and causing visible jank.
 *
 * These functions determine which items can be safely moved to Static history
 * (where Ink writes them once and never re-renders them).
 */

/** Minimal item shape needed for flush logic. */
export interface FlushableItem {
  kind: string;
  id: string;
}

/**
 * Max history items kept in React state. Ink's <Static> renders items once
 * to stdout, so pruned items remain visible in terminal scrollback — we just
 * release the JS object references to avoid unbounded memory growth.
 */
export const MAX_HISTORY_ITEMS = 500;

/**
 * Prune history to keep at most MAX_HISTORY_ITEMS. Oldest items are dropped
 * first; they remain visible in terminal scrollback.
 */
export function pruneHistory<T>(items: T[]): T[] {
  if (items.length <= MAX_HISTORY_ITEMS) return items;
  return items.slice(items.length - MAX_HISTORY_ITEMS);
}

/**
 * Called when `onTurnText` fires (end of each LLM turn that produced text).
 * All previous items are guaranteed complete — tool calls from this turn
 * finished before `turn_end` fired, and `onTurnText` fires inside `turn_end`.
 *
 * Returns the items to flush to history. The caller should then set liveItems
 * to contain only the new text item.
 */
export function flushOnTurnText<T extends FlushableItem>(liveItems: T[]): T[] {
  return liveItems;
}

/**
 * Called when `onTurnEnd` fires with a tool_use stop reason (LLM responded
 * with only tool calls, no text). Flushes all items IF none are still pending
 * (no `tool_start` without a corresponding `tool_done`).
 *
 * Returns { flushed, remaining } — flushed items go to history, remaining
 * items stay in liveItems.
 */
export function flushOnTurnEnd<T extends FlushableItem>(
  liveItems: T[],
  stopReason: string,
): { flushed: T[]; remaining: T[] } {
  if (stopReason !== "tool_use") {
    return { flushed: [], remaining: liveItems };
  }

  const hasPendingToolStart = liveItems.some((item) => item.kind === "tool_start");

  if (hasPendingToolStart || liveItems.length === 0) {
    return { flushed: [], remaining: liveItems };
  }

  return { flushed: liveItems, remaining: [] };
}
