import { useSyncExternalStore } from "react";
import type { ActivityPhase, RetryInfo } from "@kenkaiiii/ggcoder/ui";
import type {
  ContentPart,
  Message,
  Provider,
  TextContent,
  ThinkingLevel,
  ToolCall,
  ToolResult,
} from "@kenkaiiii/gg-ai";
import type { WorkerStatus, WorkerTurnSummary } from "./types.js";
import type {
  BossAssistantItem,
  BossDisplayItem,
  BossInfoItem,
  BossTaskDispatchItem,
  BossToolDoneItem,
  BossUserItem,
  BossWorkerEventItem,
  BossWorkerErrorItem,
} from "./boss-ui-items.js";

let nextId = 1;
const id = (): string => `i${nextId++}`;

// ── History memory cap ─────────────────────────────────────
//
// `state.history` is push-only — every assistant turn, tool result, and
// worker event lives there forever. In `ggboss serve` (24/7 Telegram
// bridge) this fills V8's default 4 GB heap in ~a day. Trimming the array
// from the front would break Ink's <Static> commit counter, so instead we
// keep the array intact and release the *contents* of items that have aged
// out of a sliding window. Already-rendered items remain in terminal
// scrollback; the only visible regression is on a Static remount (e.g.
// resize), where aged items render with a "(trimmed)" placeholder.
const HISTORY_FULL_ITEMS = 1000;
const HISTORY_TRIM_MARKER = "…(trimmed)…";
let historyTrimmedUpTo = 0;

function trimItemFields(item: HistoryItem): void {
  switch (item.kind) {
    case "tool_done":
      if (item.result.length > 200) item.result = HISTORY_TRIM_MARKER;
      // args and details can be large (full prompt_worker prompts, nested
      // objects) — release them entirely.
      item.args = {};
      item.details = undefined;
      break;
    case "worker_event":
      if (item.finalText.length > 200) {
        item.finalText = item.finalText.slice(0, 200) + " " + HISTORY_TRIM_MARKER;
      }
      break;
    case "assistant":
      if (item.text.length > 200) item.text = item.text.slice(0, 200) + " " + HISTORY_TRIM_MARKER;
      if (item.thinking && item.thinking.length > 100) item.thinking = HISTORY_TRIM_MARKER;
      break;
    case "worker_error":
      if (item.message.length > 200) {
        item.message = item.message.slice(0, 200) + " " + HISTORY_TRIM_MARKER;
      }
      break;
    case "info":
    case "update_notice":
      if (item.text.length > 400) item.text = item.text.slice(0, 400) + " " + HISTORY_TRIM_MARKER;
      break;
    case "user":
    case "task_dispatch":
      // Already small — text is one user message or a short title list.
      break;
  }
}

/**
 * Mutate fields of any items that have aged out of the [length-N, length)
 * window. Amortized O(1) per call: tracks the high-water mark of trimmed
 * indices so we never re-walk old items. Mutating already-pushed items is
 * safe — observers (Ink Static, serve-mode flusher) only consume each item
 * once, on the notify pass that pushed it.
 */
function trimAgedHistory(): void {
  const cutoff = state.history.length - HISTORY_FULL_ITEMS;
  if (cutoff <= historyTrimmedUpTo) return;
  for (let i = historyTrimmedUpTo; i < cutoff; i++) {
    const item = state.history[i];
    if (item) trimItemFields(item);
  }
  historyTrimmedUpTo = cutoff;
}

function isText(p: ContentPart): p is TextContent {
  return p.type === "text";
}

function isToolCall(p: ContentPart): p is ToolCall {
  return p.type === "tool_call";
}

function userMessageText(
  content: string | ({ type: "text"; text: string } | { type: "image" })[],
): string {
  if (typeof content === "string") return content;
  return content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
}

function toolResultText(content: ToolResult["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");
}

// ── History items (rendered in Ink Static) ─────────────────

export type UserItem = BossUserItem;
export type AssistantItem = BossAssistantItem;
export type ToolItem = BossToolDoneItem;
export type WorkerEventItem = BossWorkerEventItem;
export type WorkerErrorItem = BossWorkerErrorItem;
export type InfoItem = BossInfoItem;

/**
 * Task-dispatch announcement. Rendered when the user (or boss) fires a batch
 * of tasks via `r` in the overlay or `dispatch_pending`. Structured (vs plain
 * info text) so each project name can be drawn in its own projectColor() —
 * matching the WorkerStatusBar / WorkerEventRow / scope pill conventions.
 */
export type TaskDispatchItem = BossTaskDispatchItem;

/**
 * Auto-update notice ("Ken just shipped 4.3.x!"). Distinct from a plain
 * info row so the renderer can wrap it in the success-bordered ✨ box that
 * ggcoder uses — without this, the update message renders in flat default
 * text and goes unnoticed amid worker chatter.
 */
export type UpdateNoticeItem = BossDisplayItem & { kind: "update_notice" };

export type HistoryItem = BossDisplayItem;

// ── Streaming (current boss turn, rendered live above the input) ────

export interface StreamingTool {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  startedAt: number;
  durationMs?: number;
  result?: string;
  details?: unknown;
}

export interface StreamingTurn {
  text: string;
  thinking: string;
  thinkingMs: number;
  tools: StreamingTool[];
  startedAt: number;
  thinkingStartedAt: number | null;
}

export interface CompactionSnapshot {
  state: "running" | "done";
  originalCount: number;
  newCount: number;
  tokensBefore: number;
  tokensAfter: number;
}

// ── Worker view state ──────────────────────────────────────

export interface WorkerView {
  name: string;
  cwd: string;
  status: WorkerStatus;
  /** When the worker most recently transitioned to "working". Cleared when it
   *  goes back to idle/error. Drives the elapsed-time readout in the worker
   *  status bar so users can see "yaatuber working · 1:24" while waiting. */
  workStartedAt: number | null;
  lastSummary?: WorkerTurnSummary;
}

// ── Top-level state ────────────────────────────────────────

export interface BossUiState {
  bossProvider: Provider;
  bossModel: string;
  /** Boss extended-thinking level. undefined = off. Toggled via Shift+Tab. */
  bossThinkingLevel?: ThinkingLevel;
  workerProvider: Provider;
  workerModel: string;
  /** Providers the user is logged in to — controls which models the picker offers. */
  loggedInProviders: Provider[];
  history: HistoryItem[];
  liveItems: HistoryItem[];
  /**
   * Two-phase flush queue. Items here have already been REMOVED from the
   * streaming live-area (so it has shrunk) but not yet committed to history.
   * A useEffect in BossApp watches `flushGeneration` and calls
   * `commitPendingFlush()` on the next render cycle, so Ink's log-update
   * doesn't try to clear a tall live area AND write new Static lines in the
   * same frame — which clips the bottom of long responses.
   */
  pendingFlush: HistoryItem[];
  flushGeneration: number;
  /** Info rows queued by mid-turn tools, flushed when the boss's turn ends.
   *  See queueEndOfTurnInfo / flushEndOfTurnInfos. */
  pendingEndOfTurnInfos: { text: string; level: InfoItem["level"] }[];
  streaming: StreamingTurn | null;
  phase: "idle" | "working";
  /** Fine-grained phase used by ActivityIndicator. */
  activityPhase: ActivityPhase;
  /** Most recent retry (provider overload, rate limit, etc.), null when not retrying. */
  retryInfo: RetryInfo | null;
  /** Live compaction status (or recent done-state) for the orchestrator's banner. */
  compaction: CompactionSnapshot | null;
  /** Cumulative input tokens from boss turn_end events. Drives footer context bar. */
  bossInputTokens: number;
  /** When the current boss turn started (for elapsed display). */
  runStartMs: number | null;
  workers: WorkerView[];
  pendingUserMessages: number; // queued while boss is busy
  exitPending: boolean;
  /**
   * Scope pill in the input — "all" (default) or a specific worker name.
   * Cycled with Tab; gets injected into every prompt the user sends.
   */
  scope: string;
  /**
   * Active overlay (if any). Lives in the store rather than React state so
   * it survives the unmount/remount that overlay open/close performs to
   * escape Ink's live-area drift — same pattern ggcoder adopted across all
   * its overlays. Without this mirror, opening an overlay would remount the
   * tree and the new mount would have no overlay set, defeating the toggle.
   */
  overlay: BossOverlay | null;
}

export type BossOverlay = "model-boss" | "model-workers" | "tasks" | "radio";

const initialState: BossUiState = {
  bossProvider: "anthropic",
  bossModel: "",
  workerProvider: "anthropic",
  workerModel: "",
  loggedInProviders: [],
  history: [],
  liveItems: [],
  pendingFlush: [],
  flushGeneration: 0,
  pendingEndOfTurnInfos: [],
  streaming: null,
  phase: "idle",
  activityPhase: "idle",
  retryInfo: null,
  compaction: null,
  bossInputTokens: 0,
  runStartMs: null,
  workers: [],
  pendingUserMessages: 0,
  exitPending: false,
  scope: "all",
  overlay: null,
};

let state: BossUiState = initialState;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function getSnapshot(): BossUiState {
  return state;
}

export function useBossState(): BossUiState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Non-React subscription for serve mode (Telegram bridge, etc.). */
export function subscribeToBossStore(fn: () => void): () => void {
  return subscribe(fn);
}

/** Read the current state outside of React. */
export function getBossState(): BossUiState {
  return getSnapshot();
}

// ── Mutations (called by orchestrator/worker) ──────────────

export const bossStore = {
  init(opts: {
    bossProvider: Provider;
    bossModel: string;
    bossThinkingLevel?: ThinkingLevel;
    workerProvider: Provider;
    workerModel: string;
    loggedInProviders: Provider[];
    workers: { name: string; cwd: string }[];
  }): void {
    state = {
      ...initialState,
      bossProvider: opts.bossProvider,
      bossModel: opts.bossModel,
      bossThinkingLevel: opts.bossThinkingLevel,
      workerProvider: opts.workerProvider,
      workerModel: opts.workerModel,
      loggedInProviders: opts.loggedInProviders,
      workers: opts.workers.map((w) => ({
        name: w.name,
        cwd: w.cwd,
        status: "idle" as WorkerStatus,
        workStartedAt: null,
      })),
    };
    historyTrimmedUpTo = 0;
    notify();
  },

  setBossThinking(level: ThinkingLevel | undefined): void {
    state = { ...state, bossThinkingLevel: level };
    notify();
  },

  setBossModel(provider: Provider, model: string): void {
    state = { ...state, bossProvider: provider, bossModel: model };
    notify();
  },

  setWorkerModel(provider: Provider, model: string): void {
    state = { ...state, workerProvider: provider, workerModel: model };
    notify();
  },

  setLoggedInProviders(providers: Provider[]): void {
    state = { ...state, loggedInProviders: providers };
    notify();
  },

  createUserItem(text: string): UserItem {
    const item: UserItem = { kind: "user", id: id(), text, timestamp: Date.now() };
    state = {
      ...state,
      liveItems: [...state.liveItems, item],
    };
    notify();
    return item;
  },

  appendUser(text: string): void {
    const item: UserItem = { kind: "user", id: id(), text, timestamp: Date.now() };
    state = {
      ...state,
      history: [...state.history, item],
    };
    trimAgedHistory();
    notify();
  },

  commitLiveItem(item: HistoryItem): void {
    const exists = state.history.some((historyItem) => historyItem.id === item.id);
    state = {
      ...state,
      liveItems: state.liveItems.filter((liveItem) => liveItem.id !== item.id),
      history: exists ? state.history : [...state.history, item],
    };
    trimAgedHistory();
    notify();
  },

  appendTaskDispatch(tasks: { project: string; title: string }[]): void {
    if (tasks.length === 0) return;
    const item: HistoryItem = { kind: "task_dispatch", id: id(), tasks, timestamp: Date.now() };
    state = {
      ...state,
      pendingFlush: [...state.pendingFlush, item],
      flushGeneration: state.flushGeneration + 1,
    };
    notify();
  },

  appendInfo(text: string, level: InfoItem["level"] = "info"): void {
    const item: HistoryItem = { kind: "info", id: id(), text, level };
    state = {
      ...state,
      pendingFlush: [...state.pendingFlush, item],
      flushGeneration: state.flushGeneration + 1,
    };
    notify();
  },

  /**
   * Append the eye-catching update-available notice. Distinct kind so the
   * renderer can give it the rounded green-bordered "✨ ..." box treatment
   * that mirrors ggcoder's update notice — flat info text gets lost in
   * worker chatter, this stands out.
   */
  appendUpdateNotice(text: string): void {
    const item: HistoryItem = { kind: "update_notice", id: id(), text };
    state = {
      ...state,
      pendingFlush: [...state.pendingFlush, item],
      flushGeneration: state.flushGeneration + 1,
    };
    notify();
  },

  /**
   * Queue an info message to be appended AFTER the boss's current turn ends.
   * Used by tools (like add_task's keybind hint) that fire mid-turn and would
   * otherwise interleave their announcement between the boss's tool calls,
   * making it read like the boss issued the message itself.
   */
  queueEndOfTurnInfo(text: string, level: InfoItem["level"] = "info"): void {
    state = { ...state, pendingEndOfTurnInfos: [...state.pendingEndOfTurnInfos, { text, level }] };
    notify();
  },

  /** Flush any deferred infos as real history rows. Called from the boss's
   *  turn_end event handler in the orchestrator. */
  flushEndOfTurnInfos(): void {
    if (state.pendingEndOfTurnInfos.length === 0) return;
    const newRows: InfoItem[] = state.pendingEndOfTurnInfos.map(({ text, level }) => ({
      kind: "info",
      id: id(),
      text,
      level,
    }));
    state = {
      ...state,
      pendingFlush: [...state.pendingFlush, ...newRows],
      flushGeneration: state.flushGeneration + 1,
      pendingEndOfTurnInfos: [],
    };
    notify();
  },

  setPendingMessages(n: number): void {
    if (state.pendingUserMessages === n) return;
    state = { ...state, pendingUserMessages: n };
    notify();
  },

  startStreaming(): void {
    state = {
      ...state,
      phase: "working",
      activityPhase: "waiting",
      retryInfo: null,
      runStartMs: Date.now(),
      streaming: {
        text: "",
        thinking: "",
        thinkingMs: 0,
        tools: [],
        startedAt: Date.now(),
        thinkingStartedAt: null,
      },
    };
    notify();
  },

  appendStreamText(text: string): void {
    if (!state.streaming) return;
    // If we were thinking, stop the thinking timer and bank elapsed.
    const thinking = state.streaming.thinking;
    let thinkingMs = state.streaming.thinkingMs;
    let thinkingStartedAt = state.streaming.thinkingStartedAt;
    if (thinkingStartedAt != null) {
      thinkingMs += Date.now() - thinkingStartedAt;
      thinkingStartedAt = null;
    }
    state = {
      ...state,
      activityPhase: "generating",
      streaming: {
        ...state.streaming,
        text: state.streaming.text + text,
        thinking,
        thinkingMs,
        thinkingStartedAt,
      },
    };
    notify();
  },

  appendStreamThinking(text: string): void {
    if (!state.streaming) return;
    const startedAt = state.streaming.thinkingStartedAt ?? Date.now();
    state = {
      ...state,
      activityPhase: "thinking",
      streaming: {
        ...state.streaming,
        thinking: state.streaming.thinking + text,
        thinkingStartedAt: startedAt,
      },
    };
    notify();
  },

  setActivityPhase(phase: ActivityPhase): void {
    if (state.activityPhase === phase) return;
    state = { ...state, activityPhase: phase };
    notify();
  },

  setRetryInfo(info: RetryInfo | null): void {
    state = {
      ...state,
      retryInfo: info,
      activityPhase: info ? "retrying" : state.activityPhase,
    };
    notify();
  },

  startCompaction(): void {
    const compaction = {
      state: "running" as const,
      originalCount: 0,
      newCount: 0,
      tokensBefore: state.bossInputTokens,
      tokensAfter: 0,
    };
    state = {
      ...state,
      compaction,
      liveItems: [
        ...state.liveItems.filter((item) => item.kind !== "compacting"),
        { kind: "compacting", id: "boss-compacting" },
      ],
    };
    notify();
  },

  endCompaction(originalCount: number, newCount: number): void {
    const before = state.compaction?.tokensBefore ?? state.bossInputTokens;
    const item: HistoryItem = {
      kind: "compacted",
      id: id(),
      originalCount,
      newCount,
      tokensBefore: before,
      tokensAfter: state.bossInputTokens,
    };
    state = {
      ...state,
      compaction: {
        state: "done",
        originalCount,
        newCount,
        tokensBefore: before,
        tokensAfter: state.bossInputTokens,
      },
      liveItems: state.liveItems.filter((liveItem) => liveItem.kind !== "compacting"),
      pendingFlush: [...state.pendingFlush, item],
      flushGeneration: state.flushGeneration + 1,
    };
    notify();
  },

  cancelCompaction(): void {
    state = {
      ...state,
      compaction: null,
      liveItems: state.liveItems.filter((item) => item.kind !== "compacting"),
    };
    notify();
  },

  /** Read-only accessor for the orchestrator (which lives outside React). */
  getInputTokens(): number {
    return state.bossInputTokens;
  },

  getPhase(): BossUiState["phase"] {
    return state.phase;
  },

  setBossInputTokens(tokens: number): void {
    if (state.bossInputTokens === tokens) return;
    state = { ...state, bossInputTokens: tokens };
    notify();
  },

  startTool(toolCallId: string, name: string, args: Record<string, unknown>): void {
    if (!state.streaming) return;
    const startedAt = Date.now();
    const tool: StreamingTool = {
      toolCallId,
      name,
      args,
      status: "running",
      startedAt,
    };
    const liveTool: HistoryItem = {
      kind: "tool_start",
      id: toolCallId,
      toolCallId,
      name,
      args,
      startedAt,
      animateUntil: startedAt + 1_000,
    };
    state = {
      ...state,
      streaming: { ...state.streaming, tools: [...state.streaming.tools, tool] },
      liveItems: [...state.liveItems, liveTool],
    };
    notify();
  },

  endTool(
    toolCallId: string,
    isError: boolean,
    durationMs: number,
    result: string,
    details?: unknown,
  ): void {
    if (!state.streaming) return;
    const tool = state.streaming.tools.find((t) => t.toolCallId === toolCallId);
    const remaining = state.streaming.tools.filter((t) => t.toolCallId !== toolCallId);
    if (!tool) {
      notify();
      return;
    }
    const historyItem: HistoryItem = {
      kind: "tool_done",
      id: id(),
      toolCallId: tool.toolCallId,
      name: tool.name,
      args: tool.args,
      isError,
      durationMs,
      result,
      details,
    };
    // Phase 1: shrink the live area (remove from streaming.tools), queue the
    // committed tool for Static. Phase 2 happens in BossApp's useEffect.
    state = {
      ...state,
      streaming: { ...state.streaming, tools: remaining },
      liveItems: state.liveItems.filter((item) => item.id !== toolCallId),
      pendingFlush: [...state.pendingFlush, historyItem],
      flushGeneration: state.flushGeneration + 1,
    };
    notify();
  },

  /**
   * Flush any pending streaming text into the pendingFlush queue. The actual
   * commit to history happens on the next render cycle (two-phase flush) so
   * Ink doesn't clip long responses.
   * Called on tool_call_start and turn_end so text/tool order is preserved.
   */
  flushPendingText(): void {
    if (!state.streaming) return;
    const text = state.streaming.text.trim();
    if (!text) return;
    const thinking = state.streaming.thinking.trim();
    const item: HistoryItem = {
      kind: "assistant",
      id: id(),
      text,
      durationMs: Date.now() - state.streaming.startedAt,
      thinking: thinking ? thinking : undefined,
      thinkingMs: thinking ? state.streaming.thinkingMs : undefined,
    };
    state = {
      ...state,
      streaming: {
        ...state.streaming,
        text: "",
        thinking: "",
        thinkingMs: 0,
        thinkingStartedAt: null,
        startedAt: Date.now(),
      },
      pendingFlush: [...state.pendingFlush, item],
      flushGeneration: state.flushGeneration + 1,
    };
    notify();
  },

  /**
   * Phase 2 of the two-phase flush. Move queued items into history. Called by
   * a useEffect in BossApp when flushGeneration changes — guaranteed to run
   * AFTER React has painted the live-area shrinkage from phase 1.
   */
  commitPendingFlush(): void {
    if (state.pendingFlush.length === 0) return;
    state = {
      ...state,
      history: [...state.history, ...state.pendingFlush],
      pendingFlush: [],
    };
    trimAgedHistory();
    notify();
  },

  clearPendingFlush(): void {
    if (state.pendingFlush.length === 0) return;
    state = { ...state, pendingFlush: [] };
    trimAgedHistory();
    notify();
  },

  /**
   * Called when the user interrupts (ESC / Ctrl+C while running). Stops all
   * in-flight running tools, queueing them in pendingFlush as errored "Stopped."
   * entries — matches ggcoder's onAborted behavior so the user sees the same
   * visual feedback for an aborted run.
   */
  interruptStreaming(): void {
    if (!state.streaming) return;
    const stoppedItems: HistoryItem[] = [];
    const remainingTools: StreamingTool[] = [];
    for (const t of state.streaming.tools) {
      if (t.status === "running") {
        stoppedItems.push({
          kind: "tool_done",
          id: id(),
          toolCallId: t.toolCallId,
          name: t.name,
          args: t.args,
          isError: true,
          durationMs: 0,
          result: "Stopped.",
        });
      } else {
        remainingTools.push(t);
      }
    }
    if (stoppedItems.length === 0) return;
    state = {
      ...state,
      streaming: { ...state.streaming, tools: remainingTools },
      liveItems: state.liveItems.filter((item) => {
        if (item.kind !== "tool_start") return true;
        return !stoppedItems.some((stopped) => {
          if (stopped.kind !== "tool_done") return false;
          return stopped.toolCallId === item.toolCallId;
        });
      }),
      pendingFlush: [
        ...state.pendingFlush,
        ...stoppedItems,
        { kind: "stopped", id: id(), text: "Request was stopped." },
      ],
      flushGeneration: state.flushGeneration + 1,
    };
    notify();
  },

  /**
   * Tear down the streaming session. By this point, tool_call_end and turn_end
   * handlers have already flushed text + tools into pendingFlush in proper order.
   * Anything left is a final text tail (no tool followed it) — also goes through
   * the two-phase queue so it doesn't clip.
   */
  finishStreaming(): void {
    if (!state.streaming) {
      state = { ...state, phase: "idle" };
      notify();
      return;
    }
    const items: HistoryItem[] = [];
    const tail = state.streaming.text.trim();
    if (tail) {
      const thinking = state.streaming.thinking.trim();
      items.push({
        kind: "assistant",
        id: id(),
        text: tail,
        durationMs: Date.now() - state.streaming.startedAt,
        thinking: thinking ? thinking : undefined,
        thinkingMs: thinking ? state.streaming.thinkingMs : undefined,
      });
    }
    // Defensive: any running tools without a tool_call_end (shouldn't happen).
    for (const t of state.streaming.tools) {
      items.push({
        kind: "tool_done",
        id: id(),
        toolCallId: t.toolCallId,
        name: t.name,
        args: t.args,
        isError: t.status === "error",
        durationMs: t.durationMs ?? 0,
        result: t.result ?? "",
        details: t.details,
      });
    }
    state = {
      ...state,
      streaming: null,
      phase: "idle",
      activityPhase: "idle",
      retryInfo: null,
      runStartMs: null,
      pendingFlush: items.length > 0 ? [...state.pendingFlush, ...items] : state.pendingFlush,
      flushGeneration: items.length > 0 ? state.flushGeneration + 1 : state.flushGeneration,
    };
    notify();
  },

  setWorkerStatus(name: string, status: WorkerStatus): void {
    state = {
      ...state,
      workers: state.workers.map((w) => {
        if (w.name !== name) return w;
        const nowWorking = status === "working";
        const wasWorking = w.status === "working";
        return {
          ...w,
          status,
          workStartedAt: nowWorking ? (wasWorking ? w.workStartedAt : Date.now()) : null,
        };
      }),
    };
    notify();
  },

  appendWorkerEvent(summary: WorkerTurnSummary): void {
    state = {
      ...state,
      history: [
        ...state.history,
        {
          kind: "worker_event",
          id: id(),
          project: summary.project,
          status: summary.status,
          finalText: summary.finalText,
          toolsUsed: summary.toolsUsed,
          turnIndex: summary.turnIndex,
          timestamp: summary.timestamp,
        },
      ],
      workers: state.workers.map((w) =>
        w.name === summary.project
          ? { ...w, status: summary.status, workStartedAt: null, lastSummary: summary }
          : w,
      ),
    };
    trimAgedHistory();
    notify();
  },

  appendWorkerError(project: string, message: string, timestamp: string): void {
    state = {
      ...state,
      history: [...state.history, { kind: "worker_error", id: id(), project, message, timestamp }],
      workers: state.workers.map((w) =>
        w.name === project ? { ...w, status: "error", workStartedAt: null } : w,
      ),
    };
    trimAgedHistory();
    notify();
  },

  setScope(scope: string): void {
    if (state.scope === scope) return;
    state = { ...state, scope };
    notify();
  },

  /** Cycle scope through ["all", ...worker names]. Wraps around. */
  cycleScope(): void {
    const names = ["all", ...state.workers.map((w) => w.name)];
    if (names.length === 0) return;
    const idx = names.indexOf(state.scope);
    const next = names[(idx + 1) % names.length] ?? "all";
    state = { ...state, scope: next };
    notify();
  },

  /**
   * Set or clear the active overlay. Lives in the store (not React state)
   * because overlay open/close triggers an Ink unmount/remount to escape
   * live-area drift — the new mount reads this back to know which overlay
   * to render. Calling with the same value is a no-op.
   */
  setOverlay(next: BossOverlay | null): void {
    if (state.overlay === next) return;
    state = { ...state, overlay: next };
    notify();
  },

  setExitPending(pending: boolean): void {
    if (state.exitPending === pending) return;
    state = { ...state, exitPending: pending };
    notify();
  },

  reset(): void {
    state = initialState;
    historyTrimmedUpTo = 0;
    notify();
  },

  /**
   * Rebuild the visible chat history from a persisted Message[] (boss session
   * resume). Pairs assistant tool_use blocks with their tool_result blocks
   * so completed tools render in scrollback as if they'd just happened.
   */
  restoreHistory(messages: Message[]): void {
    const toolResults = new Map<string, ToolResult>();
    for (const m of messages) {
      if (m.role === "tool") {
        for (const tr of m.content) toolResults.set(tr.toolCallId, tr);
      }
    }

    const items: HistoryItem[] = [];
    for (const m of messages) {
      if (m.role === "user") {
        const text = userMessageText(m.content);
        if (!text) continue;
        // Strip the scope prefix the user never typed — only the boss sees it.
        const cleaned = text.replace(/^\[scope:[^\]]+\]\s*/, "");
        items.push({ kind: "user", id: id(), text: cleaned, timestamp: Date.now() });
      } else if (m.role === "assistant") {
        const parts = Array.isArray(m.content)
          ? m.content
          : [{ type: "text", text: m.content } as TextContent];
        let textBuf = "";
        for (const p of parts) {
          if (isText(p)) {
            textBuf += p.text;
          } else if (isToolCall(p)) {
            // Flush any preceding text as a single assistant block first.
            if (textBuf.trim()) {
              items.push({
                kind: "assistant",
                id: id(),
                text: textBuf.trim(),
                durationMs: 0,
              });
              textBuf = "";
            }
            const result = toolResults.get(p.id);
            const resultText = result ? toolResultText(result.content) : "";
            items.push({
              kind: "tool_done",
              id: id(),
              toolCallId: p.id,
              name: p.name,
              args: p.args,
              isError: result?.isError ?? false,
              durationMs: 0,
              result: resultText,
            });
          }
          // thinking / image / server_tool / raw — skipped for restore.
        }
        if (textBuf.trim()) {
          items.push({
            kind: "assistant",
            id: id(),
            text: textBuf.trim(),
            durationMs: 0,
          });
        }
      }
      // tool messages handled via the toolResults map above; skip.
    }

    state = { ...state, history: [...state.history, ...items] };
    trimAgedHistory();
    notify();
  },

  /** /clear handler: wipe history but keep workers, model info, etc. */
  clearHistory(): void {
    state = {
      ...state,
      history: [],
      liveItems: [],
      pendingFlush: [],
      flushGeneration: state.flushGeneration + 1,
      streaming: null,
      phase: "idle",
      activityPhase: "idle",
      retryInfo: null,
      compaction: null,
      bossInputTokens: 0,
      runStartMs: null,
      // Drop any active overlay so /clear lands on the chat, not back in
      // the overlay it was invoked from.
      overlay: null,
    };
    historyTrimmedUpTo = 0;
    notify();
  },
};
