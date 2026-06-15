import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { theme } from "./theme";
import {
  waitForReady,
  getState,
  sendPrompt,
  cancel,
  newSession,
  cycleThinking,
  listModels,
  switchModel,
  listCommands,
  listHistory,
  subscribe,
  isSecondaryWindow,
  setWindowTitle,
  type SidecarEvent,
  type AgentState,
  type ModelOption,
  type SlashCommand,
  type BackgroundTask,
} from "./agent";
import { ActivityBar, formatTokenCount } from "./ActivityBar";
import { LiveToolPanel, type LiveToolEntry, LIVE_TOOL_PANEL_ROWS } from "./LiveToolPanel";
import { SubAgentFeed, type SubAgentLine } from "./SubAgentFeed";
import { ModelMenu } from "./ModelMenu";
import { SlashMenu } from "./SlashMenu";
import { ContextMeter } from "./ContextMeter";
import { BackgroundTasksButton } from "./BackgroundTasksButton";
import { ShimmerText } from "./ShimmerText";
import { ConfirmModal } from "./ConfirmModal";
import { InitGitModal } from "./InitGitModal";
import { PlanModeLogo } from "./PlanModeLogo";
import { PlanReviewModal } from "./PlanReviewModal";
import { WindowLayoutButton } from "./WindowLayoutButton";
import { ProjectPicker } from "./ProjectPicker";
import { BackButton } from "./BackButton";
import { HomeScreen } from "./HomeScreen";
import { Toaster } from "./Toaster";
import { LoginScreen } from "./LoginScreen";
import { Markdown } from "./Markdown";
import { FooterSkeleton, TranscriptSkeleton } from "./Skeleton";
import { useAppUpdate } from "./update";
import { recoverPromptLabel } from "./prompt-labels";
import {
  segmentDoneMarkers,
  hasDoneMarker,
  countPlanSteps,
  findCompletedSteps,
} from "./plan-steps";
import { Paperclip } from "lucide-react";
import { AttachmentBar } from "./AttachmentBar";
import { fileToPending, toWire, type PendingAttachment } from "./attachments";
import "./App.css";

// ── Transcript model ───────────────────────────────────────
// Tool activity lives in the pinned LiveToolPanel, never in the transcript.
type Item =
  // `command` marks a workflow slash command — rendered as just the short
  // `/name` with a highlight + shimmer, never the expanded prompt body.
  // `label` overrides what's shown with a friendly shimmer phrase (e.g.
  // "Initializing Git…") while the full prompt still goes to the agent.
  | {
      kind: "user";
      id: number;
      text: string;
      command?: boolean;
      label?: string;
      images?: string[];
    }
  | { kind: "assistant"; id: number; text: string }
  | { kind: "info"; id: number; text: string }
  | { kind: "error"; id: number; text: string }
  // Agent self-correction hook notice (ideal review / loop-break / re-grounding),
  // rendered like the TUI: a shimmering tone-colored one-liner.
  | { kind: "hook"; id: number; hook: HookKind }
  // Images produced by a tool (screenshot / read of an image file).
  | { kind: "images"; id: number; images: TranscriptImage[]; caption?: string }
  // Plan-mode entry banner (ASCII logo + optional reason).
  | { kind: "plan"; id: number; reason: string }
  // Sub-agents delegated in a turn — a live, in-chat feed of each one's tools.
  | { kind: "subagent_group"; id: number; agents: SubAgentLine[]; aborted?: boolean };

export interface TranscriptImage {
  /** data: URL (base64) ready to drop into <img src>. */
  src: string;
  /** Source file path, shown as a caption + used as a stable key. */
  path?: string;
}

/** Tool detail image preview (screenshot / read), mirrors the sidecar shape. */
interface ImagePreview {
  base64: string;
  mediaType: string;
  path?: string;
}

// Hook kind → notice copy + tone color, mirroring the TUI's app-items.ts.
type HookKind = "ideal" | "loop_break" | "regrounding";
const HOOK_PRESENTATION: Record<HookKind, { text: string; color: string }> = {
  ideal: {
    text: "Hook engaged. Running an ideal review before finalizing.",
    color: theme.secondary,
  },
  loop_break: {
    text: "Hook engaged. Breaking a stuck loop and rethinking the approach.",
    color: theme.warning,
  },
  regrounding: {
    text: "Hook engaged. Re-grounding on the original request after compaction.",
    color: theme.primary,
  },
};

let idSeq = 0;
const nextId = (): number => ++idSeq;

// Last path segment of a cwd (the project folder name), mirroring the TUI footer
// which shows only the current directory rather than the full path.
function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

// Vertical divider between footer segments (mirrors the TUI's ` \u2502 ` in
// border color). Rendered between adjacent groups, never leading/trailing.
function FooterSep(): React.ReactElement {
  return (
    <span className="footer-sep" style={{ color: theme.border }}>
      {"\u2502"}
    </span>
  );
}

// BLACK_CIRCLE — ⏺ on mac (matches the TUI figure).
const DOT = "\u23FA";

// Thinking-tier color, mirroring the ggcoder TUI footer's getThinkingColor:
// warmer/more saturated as the tier rises; xhigh/max are "max power" hot pink.
const MAX_POWER_COLOR = "#db2777";
const MAX_POWER_SHIMMER = "#f472b6";
function thinkingColor(level: string | null | undefined): string {
  if (!level) return theme.textDim;
  if (level === "low") return theme.textMuted;
  if (level === "medium") return theme.accent;
  if (level === "high") return theme.warning;
  return MAX_POWER_COLOR; // xhigh / max
}

function formatElapsed(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

// Port of packages/ggcoder/src/ui/duration-summary.ts, adapted to the sidecar's
// underscore tool names. Picks a contextual done-verb from which tools ran.
function pickDoneVerb(toolsUsed: ReadonlySet<string>): string {
  const has = (name: string): boolean => toolsUsed.has(name);
  const writing = has("edit") || has("write");
  const reading = has("read") || has("grep") || has("find") || has("ls");

  if (has("subagent") && writing) return "Orchestrated changes in";
  if (has("subagent")) return "Delegated work in";
  if (has("web_fetch") && writing) return "Researched & coded in";
  if (has("web_fetch") && reading) return "Researched in";
  if (has("web_fetch")) return "Fetched the web in";
  if (has("bash") && writing) return "Built & ran in";
  if (has("edit") && has("write")) return "Crafted code in";
  if (has("edit") && has("bash")) return "Refactored & tested in";
  if (has("edit")) return "Refactored in";
  if (has("write") && has("bash")) return "Wrote & ran in";
  if (has("write")) return "Wrote code in";
  if (has("bash") && has("grep")) return "Hacked away in";
  if (has("bash") && reading) return "Ran & investigated in";
  if (has("bash")) return "Executed commands in";
  if (has("grep") && has("read")) return "Investigated in";
  if (has("grep") && has("find")) return "Scoured the codebase in";
  if (has("grep")) return "Searched in";
  if (has("read") && has("find")) return "Explored in";
  if (has("read")) return "Studied the code in";
  if (has("find") || has("ls")) return "Browsed files in";

  const phrases = [
    "Brewed up a response in",
    "Cooked up an answer in",
    "Worked out a reply in",
    "Conjured a response in",
    "Pondered for",
    "Reasoned for",
  ];
  return phrases[Math.floor(Math.random() * phrases.length)] ?? "Worked in";
}

function App(): React.ReactElement {
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  // Staged attachments (paste / attach button / drag-drop) shown above the input.
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Number of messages queued mid-run (injected as steering by the sidecar).
  const [queuedCount, setQueuedCount] = useState(0);
  const [state, setState] = useState<AgentState | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("connecting to agent\u2026");
  const [liveToolFeed, setLiveToolFeed] = useState<LiveToolEntry[]>([]);
  const [tokens, setTokens] = useState(0);
  const [doneStatus, setDoneStatus] = useState<string | null>(null);
  // LLM-generated session title shown in the titlebar ("GG Coder" until set).
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  // Pending plan awaiting review (the markdown). Non-null opens the review modal.
  const [planReview, setPlanReview] = useState<string | null>(null);
  // Approved-plan progress for the activity bar: total steps + completed set.
  const [planTotal, setPlanTotal] = useState(0);
  const [planDone, setPlanDone] = useState<Set<number>>(new Set());
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingStartTs, setThinkingStartTs] = useState<number | null>(null);
  const [thinkingAccumMs, setThinkingAccumMs] = useState(0);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  // Footer extras mirrored from the sidecar: live background tasks and the
  // running context-window usage (input-side tokens of the latest turn).
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [contextTokens, setContextTokens] = useState(0);
  // Every window picks a project before connecting — on app load and on each new
  // window. The picker re-points this window's agent at the chosen cwd/session.
  const [needsProject, setNeedsProject] = useState(true);
  // Entry-screen routing while no project is open: the home landing, the
  // project chooser, or the provider login hub. Secondary windows (opened via
  // the Windows button) skip the home screen and land on "Choose a project".
  const [entryView, setEntryView] = useState<"home" | "projects" | "login">(
    isSecondaryWindow ? "projects" : "home",
  );
  // Re-open the project/session picker over an already-open project (to switch
  // sessions). Distinct from `needsProject` so cancelling returns to the
  // current session instead of forcing a fresh selection.
  const [showPicker, setShowPicker] = useState(false);
  // Bumped on each project/session choice to force re-hydration (see
  // onProjectChosen) even when needsProject doesn't change.
  const [hydrateNonce, setHydrateNonce] = useState(0);
  // New-session confirmation modal + in-flight guard.
  const [confirmNewSession, setConfirmNewSession] = useState(false);
  // Hide/show the nav button row (the bar + centered title always stay).
  // Persisted across reloads.
  const [navHidden, setNavHidden] = useState(() => {
    try {
      return localStorage.getItem("gg-nav-hidden") === "1";
    } catch {
      return false;
    }
  });
  const setNavHiddenPersisted = useCallback((hidden: boolean) => {
    try {
      localStorage.setItem("gg-nav-hidden", hidden ? "1" : "0");
    } catch {
      /* ignore */
    }
    setNavHidden(hidden);
  }, []);
  const toggleNav = useCallback(
    () => setNavHiddenPersisted(!navHidden),
    [navHidden, setNavHiddenPersisted],
  );
  const [newSessionBusy, setNewSessionBusy] = useState(false);
  // App self-update (GitHub releases). Drives the footer update banner.
  const appUpdate = useAppUpdate();
  // Initialize-git modal (shown via the top-right button when not yet a repo).
  const [showInitGit, setShowInitGit] = useState(false);
  // True once the initial hydrate (state + models + commands + history) has
  // settled for the current project/session. Gates the footer + chrome so they
  // reveal fully-formed in one pass instead of popping in piecemeal (cwd, git,
  // thinking, model each arriving separately would reflow the bar mid-load).
  const [hydrated, setHydrated] = useState(false);

  const readyRef = useRef(false);
  // Mirror of `state` for use inside the memoized event handler (which doesn't
  // re-capture state). Lets turn_end pick the right context-token formula by
  // provider without re-subscribing the SSE listener on every state change.
  const stateRef = useRef<AgentState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamingIdRef = useRef<number | null>(null);
  // Transcript id of the active sub-agent group for this run (null until the
  // first subagent spawns). Lets later parallel agents join the same in-chat
  // feed instead of each opening a fresh block.
  const subagentGroupIdRef = useRef<number | null>(null);
  const runStartRef = useRef<number>(0);
  const toolsUsedRef = useRef<Set<string>>(new Set());
  const tokensRef = useRef<number>(0);
  // Accumulated assistant text this run, for detecting [DONE:n] plan-step
  // markers that may split across deltas.
  const assistantTextRef = useRef<string>("");
  // Thinking spans: start timestamp of the active span (or null), plus the sum
  // of completed spans this run. Refs are the source of truth; state mirrors
  // them for render. Finalizing a span happens outside setState updaters.
  const thinkingStartRef = useRef<number | null>(null);
  const thinkingAccumRef = useRef<number>(0);

  // Pin to the bottom. Images (screenshots / attachments) load asynchronously
  // and grow the content after this fires, so it's also called from each image's
  // onLoad to keep the newest content visible.
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, []);

  // Re-pin to the bottom before every paint. The live tool panel + activity bar
  // (.liveregion) grow/shrink below the transcript as tools run and finish;
  // since the transcript is a flexible sibling, that growth steals height from
  // it and would leave the newest content (often the just-sent user prompt)
  // scrolled under the fold. Keying this layout effect on the live-region's
  // height inputs (tool feed, run state, done status) AND `items` re-pins
  // synchronously after layout but before paint, so the prompt is never hidden.
  // useLayoutEffect (not a ResizeObserver) avoids the post-paint flash and the
  // RO's unreliable timing relative to the flex re-layout.
  useLayoutEffect(() => {
    scrollToBottom();
  }, [items, liveToolFeed, running, doneStatus, scrollToBottom]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Stop the browser from navigating to / opening a file dropped anywhere
  // outside the input (which would replace the whole UI with the raw file).
  // The input's own onDrop handles real attachments; this just suppresses the
  // default everywhere else.
  useEffect(() => {
    const prevent = (e: DragEvent): void => {
      // Only files — don't interfere with text selection drags.
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  // Drive the native OS title bar (macOS / Windows / Linux all honor setTitle):
  // the generated session title when actively working in a project, else
  // "GG Coder" (home/picker/login screens, and while the session picker is open).
  useEffect(() => {
    const inProject = !needsProject && !showPicker;
    setWindowTitle(inProject && sessionTitle ? sessionTitle : "GG Coder");
  }, [needsProject, showPicker, sessionTitle]);

  // Focus the chat input whenever this window gains focus (or clicked anywhere),
  // so switching between project windows lands the cursor in the input without
  // a second click. Skips when the user is selecting text or focused elsewhere
  // intentionally (e.g. a menu button).
  useEffect(() => {
    const focusInput = (): void => {
      const active = document.activeElement;
      if (active && active !== document.body && active.tagName === "BUTTON") return;
      if (window.getSelection()?.toString()) return;
      inputRef.current?.focus();
    };
    window.addEventListener("focus", focusInput);
    window.addEventListener("mouseup", focusInput);
    return () => {
      window.removeEventListener("focus", focusInput);
      window.removeEventListener("mouseup", focusInput);
    };
  }, []);

  // Side effects (nextId, ref mutation) happen outside the updater — updaters
  // must stay pure since React may invoke them more than once.
  const appendAssistant = useCallback((text: string) => {
    const current = streamingIdRef.current;
    if (current === null) {
      const id = nextId();
      streamingIdRef.current = id;
      setItems((prev) => [...prev, { kind: "assistant", id, text }]);
    } else {
      setItems((prev) =>
        prev.map((it) =>
          it.kind === "assistant" && it.id === current ? { ...it, text: it.text + text } : it,
        ),
      );
    }
  }, []);

  const pushItem = useCallback((item: Item) => {
    setItems((prev) => [...prev, item]);
  }, []);

  // End the active thinking span (if any), folding its duration into the
  // accumulator. Called when text/tools begin or the run ends. Side effects on
  // refs happen here, outside any setState updater, keeping updaters pure.
  const finalizeThinking = useCallback(() => {
    const start = thinkingStartRef.current;
    if (start !== null) {
      thinkingAccumRef.current += Date.now() - start;
      thinkingStartRef.current = null;
      setThinkingAccumMs(thinkingAccumRef.current);
      setThinkingStartTs(null);
    }
    setIsThinking(false);
  }, []);

  const handleEvent = useCallback(
    (e: SidecarEvent) => {
      const d = e.data as Record<string, unknown>;
      switch (e.type) {
        case "ready":
          setState(d as unknown as AgentState);
          setTasks((d.tasks as BackgroundTask[] | undefined) ?? []);
          setStatus("ready");
          break;
        case "run_start":
          setRunning(true);
          streamingIdRef.current = null;
          subagentGroupIdRef.current = null;
          runStartRef.current = Date.now();
          toolsUsedRef.current = new Set();
          tokensRef.current = 0;
          assistantTextRef.current = "";
          thinkingStartRef.current = null;
          thinkingAccumRef.current = 0;
          setLiveToolFeed([]);
          setTokens(0);
          setDoneStatus(null);
          setIsThinking(false);
          setThinkingStartTs(null);
          setThinkingAccumMs(0);
          setStatus("thinking\u2026");
          break;
        case "thinking_delta": {
          if (thinkingStartRef.current === null) {
            const now = Date.now();
            thinkingStartRef.current = now;
            setThinkingStartTs(now);
            setIsThinking(true);
          }
          break;
        }
        case "text_delta": {
          finalizeThinking();
          const chunk = String(d.text ?? "");
          appendAssistant(chunk);
          // Track plan-step completion for the activity bar. Accumulate the
          // run's assistant text (markers can split across deltas) and union in
          // any [DONE:n] step numbers seen so far.
          assistantTextRef.current += chunk;
          const done = findCompletedSteps(assistantTextRef.current);
          if (done.length > 0) {
            setPlanDone((prev) => {
              const next = new Set(prev);
              for (const n of done) next.add(n);
              return next.size === prev.size ? prev : next;
            });
          }
          break;
        }
        case "tool_call_start": {
          finalizeThinking();
          streamingIdRef.current = null;
          const toolCallId = String(d.toolCallId ?? "");
          const name = String(d.name ?? "tool");
          const args = (d.args as Record<string, unknown>) ?? {};
          toolsUsedRef.current.add(name);
          // Tools live ONLY in the pinned panel, never in the transcript. Keep a
          // bounded tail so memory stays flat across long sessions; the panel
          // itself renders just the last LIVE_TOOL_PANEL_ROWS.
          setLiveToolFeed((prev) =>
            [...prev, { toolCallId, name, args, status: "running" as const }].slice(
              -(LIVE_TOOL_PANEL_ROWS * 2),
            ),
          );
          // Sub-agents also get a persistent, live feed in the transcript so the
          // user can watch parallel delegations by name + what each is doing.
          if (name === "subagent") {
            const newAgent: SubAgentLine = {
              toolCallId,
              agentName: typeof args.agent === "string" ? args.agent : undefined,
              status: "running",
              activities: [],
              toolUseCount: 0,
            };
            const groupId = subagentGroupIdRef.current;
            if (groupId !== null) {
              setItems((prev) =>
                prev.map((it) =>
                  it.kind === "subagent_group" && it.id === groupId
                    ? { ...it, agents: [...it.agents, newAgent] }
                    : it,
                ),
              );
            } else {
              const id = nextId();
              subagentGroupIdRef.current = id;
              streamingIdRef.current = null;
              pushItem({ kind: "subagent_group", id, agents: [newAgent] });
            }
          }
          break;
        }
        case "tool_call_update": {
          // Live progress from a running sub-agent (toolUseCount + the tool it's
          // currently running). Append distinct activities into its feed.
          const id = String(d.toolCallId ?? "");
          const update = d.update as
            | { toolUseCount?: number; currentActivity?: string }
            | undefined;
          const groupId = subagentGroupIdRef.current;
          if (!update || groupId === null) break;
          const activity = update.currentActivity;
          setItems((prev) =>
            prev.map((it) => {
              if (it.kind !== "subagent_group" || it.id !== groupId) return it;
              return {
                ...it,
                agents: it.agents.map((a) => {
                  if (a.toolCallId !== id) return a;
                  const last = a.activities[a.activities.length - 1];
                  const activities =
                    activity && activity !== last ? [...a.activities, activity] : a.activities;
                  return {
                    ...a,
                    toolUseCount: update.toolUseCount ?? a.toolUseCount,
                    activities: activities.slice(-12),
                  };
                }),
              };
            }),
          );
          break;
        }
        case "tool_call_end": {
          const id = String(d.toolCallId ?? "");
          const isError = Boolean(d.isError);
          const result = typeof d.result === "string" ? d.result : undefined;
          const details = d.details;
          // Finalize a sub-agent's in-chat row: flip status + record duration.
          const groupId = subagentGroupIdRef.current;
          if (groupId !== null) {
            const durationMs = (details as { durationMs?: number } | undefined)?.durationMs;
            setItems((prev) =>
              prev.map((it) => {
                // Only the active group, and only when the ended tool is actually
                // one of its agents (tool_call_end carries no name to filter on).
                if (it.kind !== "subagent_group" || it.id !== groupId) return it;
                if (!it.agents.some((a) => a.toolCallId === id)) return it;
                return {
                  ...it,
                  agents: it.agents.map((a) =>
                    a.toolCallId === id
                      ? {
                          ...a,
                          status: isError ? ("error" as const) : ("done" as const),
                          durationMs: durationMs ?? a.durationMs,
                        }
                      : a,
                  ),
                };
              }),
            );
          }
          // Update the entry in place to its done state — it stays in the pinned
          // panel (mirrors ggcoder), it does NOT move into the transcript.
          setLiveToolFeed((prev) =>
            prev.map((entry) =>
              entry.toolCallId === id
                ? { ...entry, status: "done" as const, isError, result, details }
                : entry,
            ),
          );
          // Surface any image previews (screenshot / read of an image) inline in
          // the transcript — the tool panel is text-only.
          const previews = (details as { imagePreviews?: ImagePreview[] } | undefined)
            ?.imagePreviews;
          if (Array.isArray(previews) && previews.length > 0) {
            streamingIdRef.current = null;
            pushItem({
              kind: "images",
              id: nextId(),
              images: previews.map((p) => ({
                src: `data:${p.mediaType};base64,${p.base64}`,
                path: p.path,
              })),
            });
          }
          break;
        }
        case "turn_end": {
          const usage = d.usage as
            | {
                inputTokens?: number;
                outputTokens?: number;
                cacheRead?: number;
                cacheWrite?: number;
              }
            | undefined;
          if (usage && typeof usage.outputTokens === "number") {
            tokensRef.current += usage.outputTokens;
            setTokens(tokensRef.current);
          }
          // Context-window usage (footer meter). Mirrors ggcoder: Anthropic has
          // separate input/output limits so only the input side counts; every
          // other provider shares one window, so add the output too.
          if (usage) {
            const inputContext =
              (usage.inputTokens ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
            const isAnthropic = stateRef.current?.provider === "anthropic";
            setContextTokens(inputContext + (isAnthropic ? 0 : (usage.outputTokens ?? 0)));
          }
          break;
        }
        case "agent_done": {
          const usage = d.totalUsage as { outputTokens?: number } | undefined;
          if (usage && typeof usage.outputTokens === "number") {
            // Authoritative final total — set rather than add to avoid
            // double-counting the per-turn accumulation above.
            if (usage.outputTokens > tokensRef.current) {
              tokensRef.current = usage.outputTokens;
              setTokens(tokensRef.current);
            }
          }
          break;
        }
        case "compaction_start":
          pushItem({ kind: "info", id: nextId(), text: "compacting context\u2026" });
          break;
        case "error":
          pushItem({
            kind: "error",
            id: nextId(),
            text: `error: ${String(d.message ?? "unknown")}`,
          });
          break;
        case "run_end": {
          setRunning(false);
          streamingIdRef.current = null;
          finalizeThinking();
          // Final response is in; exit the tool panel (mirrors ggcoder).
          setLiveToolFeed([]);
          // Mark any still-running sub-agents in this run's group as aborted.
          const saGroupId = subagentGroupIdRef.current;
          if (saGroupId !== null) {
            setItems((prev) =>
              prev.map((it) =>
                it.kind === "subagent_group" && it.id === saGroupId
                  ? {
                      ...it,
                      aborted: d.cancelled ? true : it.aborted,
                      agents: it.agents.map((a) =>
                        a.status === "running"
                          ? { ...a, status: d.cancelled ? ("error" as const) : ("done" as const) }
                          : a,
                      ),
                    }
                  : it,
              ),
            );
          }
          subagentGroupIdRef.current = null;
          if (d.cancelled) {
            setDoneStatus(null);
            setStatus("cancelled");
          } else {
            const elapsedMs = runStartRef.current ? Date.now() - runStartRef.current : 0;
            const verb = pickDoneVerb(toolsUsedRef.current);
            const parts = [`${verb} ${formatElapsed(elapsedMs)}`];
            if (tokensRef.current > 0) {
              parts.push(`\u2193 ${formatTokenCount(tokensRef.current)} tokens`);
            }
            setDoneStatus(parts.join(" \u2022 "));
            setStatus("ready");
            // A run may have created/removed `.gg/commands/*.md` (e.g.
            // /setup-commit writing commit.md). Refresh so the top-right
            // commit button flips /setup-commit → /commit without a restart.
            void listCommands().then((cmds) => {
              if (cmds.length > 0) setCommands(cmds);
            });
          }
          break;
        }
        case "model_change":
          setState((s) => (s ? { ...s, ...(d as Partial<AgentState>) } : s));
          break;
        case "thinking_change":
          setState((s) =>
            s
              ? {
                  ...s,
                  thinkingLevel: (d.thinkingLevel as string | null) ?? null,
                  supportedThinkingLevels: (d.supportedThinkingLevels as string[]) ?? [],
                }
              : s,
          );
          break;
        case "plan_enter":
          setState((s) => (s ? { ...s, planMode: true } : s));
          pushItem({ kind: "plan", id: nextId(), reason: String(d.reason ?? "") });
          break;
        case "plan_exit":
          setState((s) => (s ? { ...s, planMode: false } : s));
          // Open the review modal (Accept / Feedback / Reject) with the plan.
          setPlanReview(String(d.content ?? ""));
          break;
        case "tasks":
          setTasks((d.tasks as BackgroundTask[] | undefined) ?? []);
          break;
        case "queued":
          setQueuedCount(Number(d.count ?? 0));
          break;
        case "hook": {
          const kind = String(d.kind ?? "ideal") as HookKind;
          if (kind in HOOK_PRESENTATION) {
            streamingIdRef.current = null;
            pushItem({ kind: "hook", id: nextId(), hook: kind });
          }
          break;
        }
        case "session_reset":
          // Sidecar started a fresh session — clear the transcript + counters.
          setItems([]);
          setLiveToolFeed([]);
          setTokens(0);
          setDoneStatus(null);
          setContextTokens(0);
          setSessionTitle(null);
          setPlanReview(null);
          setPlanTotal(0);
          setPlanDone(new Set());
          setAttachments([]);
          setQueuedCount(0);
          streamingIdRef.current = null;
          subagentGroupIdRef.current = null;
          break;
        case "session_title":
          setSessionTitle(String(d.title ?? "") || null);
          break;
        case "extras":
          // Context window / git branch refresh (model switch, run end).
          setState((s) =>
            s
              ? {
                  ...s,
                  contextWindow: (d.contextWindow as number | undefined) ?? s.contextWindow,
                  gitBranch: (d.gitBranch as string | null | undefined) ?? s.gitBranch,
                  isGitRepo: (d.isGitRepo as boolean | undefined) ?? s.isGitRepo,
                }
              : s,
          );
          setTasks((d.tasks as BackgroundTask[] | undefined) ?? []);
          break;
      }
    },
    [appendAssistant, pushItem, finalizeThinking],
  );

  // Run the connect/ready flow against the current sidecar and hydrate state,
  // models, and commands. Re-invoked after a project switch respawns the
  // sidecar (its port changes, so we re-wait for readiness).
  const hydrate = useCallback(async (): Promise<void> => {
    readyRef.current = false;
    setHydrated(false);
    setStatus("connecting to agent\u2026");
    try {
      await waitForReady();
      readyRef.current = true;
      const st = await getState().catch(() => null);
      if (st) {
        setState(st);
        setStatus("ready");
      }
      const available = await listModels();
      if (available.length > 0) setModels(available);
      const cmds = await listCommands();
      if (cmds.length > 0) setCommands(cmds);
      // Hydrate the transcript when resuming an existing session — the webview
      // only sees live SSE events, so past messages must be fetched explicitly.
      const history = await listHistory();
      if (history.length > 0) {
        setItems(
          history.map((h): Item => {
            if (h.hook) return { kind: "hook", id: nextId(), hook: h.hook };
            if (h.role !== "user") return { kind: h.role, id: nextId(), text: h.text };
            // App-button prompts (e.g. "Initialize Git") were shown live as a
            // friendly shimmer label, not the expanded body. The label is
            // webview-only, so recover it from the restored prompt text. Slash
            // commands are already collapsed to `/name` by the sidecar (h.command).
            const label = !h.command ? recoverPromptLabel(h.text) : null;
            return {
              kind: "user",
              id: nextId(),
              text: h.text,
              command: h.command || label !== null,
              ...(label !== null ? { label } : {}),
              images: h.images && h.images.length > 0 ? h.images : undefined,
            };
          }),
        );
      }
    } catch (err) {
      setStatus(`agent failed to start: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      // Reveal the footer + chrome now that everything we know about the
      // session is in hand — one fade-in, no staggered reflow.
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    const unsub = subscribe(handleEvent);
    return () => unsub();
  }, [handleEvent]);

  useEffect(() => {
    // Only the main window auto-connects to its default project. Secondary
    // (project-*) windows show the picker first and connect on selection.
    // hydrateNonce forces a re-run when re-selecting a session in an already-
    // connected window (needsProject stays false there).
    if (!needsProject) void hydrate();
  }, [needsProject, hydrate, hydrateNonce]);

  function onSelectModel(modelId: string): void {
    setModelMenuOpen(false);
    if (state && modelId === state.model) return;
    void switchModel(modelId).then((res) => {
      if (res) {
        setState((s) =>
          s
            ? {
                ...s,
                provider: res.provider,
                model: res.model,
                thinkingLevel: res.thinkingLevel,
                supportedThinkingLevels: res.supportedThinkingLevels,
              }
            : s,
        );
      }
    });
  }

  // Context-window usage percentage for the footer meter. 0 (hidden) until we
  // have both a window size and a real token reading from a completed turn.
  const contextPct =
    state?.contextWindow && contextTokens > 0
      ? Math.min(100, Math.round((contextTokens / state.contextWindow) * 100))
      : 0;

  // Workflow commands matching the current `/prefix` (only while the input is a
  // single `/token` with no space yet). Empty when not in slash mode.
  const slashQuery =
    input.startsWith("/") && !input.includes(" ") ? input.slice(1).toLowerCase() : null;
  // Commit lives in the top-right button, not the slash menu.
  const COMMIT_NAMES = ["commit", "setup-commit"];
  const menuCommands = commands.filter((c) => !COMMIT_NAMES.includes(c.name));
  const slashMatches =
    slashQuery !== null
      ? menuCommands.filter(
          (c) =>
            c.name.toLowerCase().startsWith(slashQuery) ||
            c.aliases.some((a) => a.toLowerCase().startsWith(slashQuery)),
        )
      : [];
  const slashOpen = slashMatches.length > 0;
  // Clamp so a shrinking match list never points past the end.
  const clampedSlashIndex = slashMatches.length > 0 ? slashIndex % slashMatches.length : 0;
  // Footer background-tasks indicator only shows while something is actually
  // running (exited tasks shouldn't keep the bar item around).
  const runningTaskCount = tasks.filter((t) => t.exitCode === null).length;

  // True when `text` is a known workflow command invocation (first token).
  function isWorkflowCommand(text: string): boolean {
    if (!text.startsWith("/")) return false;
    const name = text.slice(1).split(" ")[0]?.toLowerCase() ?? "";
    return commands.some(
      (c) => c.name.toLowerCase() === name || c.aliases.some((a) => a.toLowerCase() === name),
    );
  }

  // Top-right commit affordance: once a project-local `/commit` exists it shows
  // `/commit`; until then it offers `/setup-commit` to generate one. Only shown
  // when at least one of the two is available from the sidecar.
  const hasCommit = commands.some((c) => c.name === "commit");
  const hasSetupCommit = commands.some((c) => c.name === "setup-commit");
  const commitCommand = hasCommit ? "commit" : hasSetupCommit ? "setup-commit" : null;
  // Until the project is a git repo, setting up commits is pointless — offer
  // "Initialize Git" first (modal collects visibility + repo name, then drives
  // the agent). isGitRepo can be undefined on older sidecars / before hydrate;
  // only treat an explicit `false` as "not a repo".
  const needsGitInit = state?.isGitRepo === false;
  // Default repo name = the project folder name.
  const defaultRepoName = (state?.cwd ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";

  function pickSlashCommand(cmd: SlashCommand): void {
    // Fill the input with the command; the user can add args or press Enter.
    setInput(`/${cmd.name} `);
    setSlashIndex(0);
  }

  // Submit arbitrary text as if typed + entered. Shared by the input and the
  // top-right commit button. `label` shows a friendly shimmer phrase in the
  // transcript while the full `text` is still sent to the agent.
  function submitText(text: string, label?: string): void {
    const trimmed = text.trim();
    if (!trimmed || !readyRef.current || running) return;
    pushItem({
      kind: "user",
      id: nextId(),
      text: trimmed,
      command: label !== undefined || isWorkflowCommand(trimmed),
      ...(label !== undefined ? { label } : {}),
    });
    setInput("");
    setSlashIndex(0);
    streamingIdRef.current = null;
    void sendPrompt(trimmed);
  }

  // Submit the current input together with any staged attachments. Images are
  // echoed inline in the user's bubble; all media is sent to the agent.
  function submit(): void {
    const trimmed = input.trim();
    if (!readyRef.current) return;
    if (!trimmed && attachments.length === 0) return;
    // While a run is in flight, a plain text message is QUEUED as steering (the
    // sidecar injects it mid-loop). Attachments can't be queued — block those.
    if (running) {
      if (attachments.length > 0) return;
      pushItem({ kind: "user", id: nextId(), text: trimmed, command: isWorkflowCommand(trimmed) });
      setInput("");
      setSlashIndex(0);
      void sendPrompt(trimmed);
      return;
    }
    const wire = attachments.map(toWire);
    const imgPreviews = attachments.filter((a) => a.previewUrl).map((a) => a.previewUrl!);
    pushItem({
      kind: "user",
      id: nextId(),
      text: trimmed,
      command: isWorkflowCommand(trimmed),
      images: imgPreviews.length > 0 ? imgPreviews : undefined,
    });
    setInput("");
    setAttachments([]);
    setSlashIndex(0);
    streamingIdRef.current = null;
    void sendPrompt(trimmed, wire);
  }

  // ── Attachment intake (paste / attach button / drag-drop) ──
  async function addFiles(files: FileList | File[]): Promise<void> {
    const list = Array.from(files);
    const pendings = await Promise.all(list.map((f) => fileToPending(f).catch(() => null)));
    const ok = pendings.filter((p): p is PendingAttachment => p !== null);
    if (ok.length > 0) setAttachments((prev) => [...prev, ...ok]);
  }

  function removeAttachment(id: number): void {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  // ── Plan review actions (mirror the ggcoder CLI plan overlay) ──
  // Each closes the modal, drops a short info line, and drives the agent with
  // the corresponding instruction via the existing prompt path.
  function runPlanPrompt(prompt: string, info: string): void {
    setPlanReview(null);
    if (!readyRef.current || running) return;
    pushItem({ kind: "info", id: nextId(), text: info });
    streamingIdRef.current = null;
    void sendPrompt(prompt);
  }

  function acceptPlan(): void {
    // Start activity-bar progress tracking from the approved plan's step count.
    setPlanTotal(planReview ? countPlanSteps(planReview) : 0);
    setPlanDone(new Set());
    runPlanPrompt(
      "The plan has been approved. Implement it now, following each step in order.",
      "\u2713 Plan accepted. Implementing.",
    );
  }

  function sendPlanFeedback(feedback: string): void {
    runPlanPrompt(
      `The plan was not approved. Feedback from the user:\n\n${feedback}\n\n` +
        "Revise the plan based on this feedback, then call exit_plan again for review.",
      "\u270e Feedback sent. Revising the plan.",
    );
  }

  function rejectPlan(): void {
    runPlanPrompt(
      "The plan was rejected and dismissed. Do not implement it. Wait for new instructions.",
      "\u2715 Plan rejected.",
    );
  }

  // Start a fresh session on this window's project. Clears the transcript only
  // after the sidecar confirms (it emits `session_reset`, handled below).
  async function startNewSession(): Promise<void> {
    if (newSessionBusy || running) return;
    setNewSessionBusy(true);
    try {
      await newSession();
      setConfirmNewSession(false);
    } catch {
      // Surface nothing extra — agent.ts logged it; keep the modal open.
    } finally {
      setNewSessionBusy(false);
    }
  }

  // Re-point this window at a freshly chosen project: clear the old transcript
  // and force a re-hydrate against the new sidecar. Bumping the nonce re-runs
  // the hydrate effect even when needsProject is already false (switching
  // sessions from the reopened picker), which flipping the boolean alone won't.
  function onProjectChosen(): void {
    setItems([]);
    setLiveToolFeed([]);
    setState(null);
    setTasks([]);
    setContextTokens(0);
    setSessionTitle(null);
    setPlanReview(null);
    setPlanTotal(0);
    setPlanDone(new Set());
    setAttachments([]);
    setQueuedCount(0);
    setHydrated(false);
    setNeedsProject(false);
    setHydrateNonce((n) => n + 1);
  }

  if (needsProject) {
    return (
      <div className="app" style={{ background: theme.background }}>
        {entryView === "home" ? (
          <HomeScreen
            onProjects={() => setEntryView("projects")}
            onLogin={() => setEntryView("login")}
          />
        ) : entryView === "login" ? (
          <LoginScreen onClose={() => setEntryView("home")} />
        ) : (
          <ProjectPicker
            onChosen={onProjectChosen}
            // Secondary windows start on the picker and have no home screen, so
            // they get no "back" affordance; the main window returns home.
            onClose={isSecondaryWindow ? undefined : () => setEntryView("home")}
          />
        )}
        <Toaster />
      </div>
    );
  }

  // Picker reopened over an already-open project (to switch sessions). Deep-links
  // to the current project's session list. From the session list, back returns
  // to the project list; from the top-level project list, back goes to the home
  // screen (not the open session).
  if (showPicker) {
    return (
      <div className="app" style={{ background: theme.background }}>
        <ProjectPicker
          initialProjectPath={state?.cwd ?? null}
          onChosen={() => {
            setShowPicker(false);
            onProjectChosen();
          }}
          onClose={() => {
            setShowPicker(false);
            setNeedsProject(true);
            setEntryView("home");
          }}
        />
      </div>
    );
  }

  return (
    <div className="app" style={{ background: theme.background }}>
      <div className="chat-head">
        {/* Top strip — the macOS traffic-light row. Holds the window title (where
            the native title used to sit) and the show/hide toggle. Always
            present, so collapsing the nav below never moves the title up into
            the traffic lights. */}
        <div className="chat-head-strip" data-tauri-drag-region>
          {/* The title fills the strip (flex:1), so it must carry the drag
              attribute itself — Tauri only drags when the element directly under
              the cursor has it, and a bare child would otherwise block dragging
              across the whole bar. */}
          <span className="chat-head-title" data-tauri-drag-region>
            {sessionTitle ?? "GG Coder"}
          </span>
          <button
            className="nav-toggle"
            title={navHidden ? "Show nav buttons" : "Hide nav buttons"}
            aria-label={navHidden ? "Show nav buttons" : "Hide nav buttons"}
            onClick={toggleNav}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ display: "block" }}
            >
              <polyline points={navHidden ? "6 9 12 15 18 9" : "6 15 12 9 18 15"} />
            </svg>
          </button>
        </div>

        {/* Nav row — the action buttons. Collapsed away by the toggle. */}
        {!navHidden && (
          <div className="chat-head-nav" data-tauri-drag-region>
            <BackButton
              label="Back to this project's sessions"
              onClick={() => setShowPicker(true)}
            />
            <span className="picker-head-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={running}
                title="Start a new session for this project"
                onClick={() => setConfirmNewSession(true)}
              >
                {"+ New session"}
              </button>
              {needsGitInit ? (
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={running}
                  title="Initialize git + create a GitHub repository"
                  onClick={() => setShowInitGit(true)}
                >
                  {"Initialize Git"}
                </button>
              ) : (
                commitCommand && (
                  <button
                    className={`btn btn-sm ${hasCommit ? "btn-success" : "btn-ghost"}`}
                    disabled={running}
                    title={hasCommit ? "Run /commit" : "Generate a /commit command"}
                    onClick={() =>
                      submitText(
                        `/${commitCommand}`,
                        hasCommit ? "Committing\u2026" : "Setting up commits\u2026",
                      )
                    }
                  >
                    {`/${commitCommand}`}
                  </button>
                )
              )}
              <WindowLayoutButton onArrange={() => setNavHiddenPersisted(true)} />
            </span>
          </div>
        )}
      </div>

      <div className="transcript" ref={scrollRef}>
        {!hydrated && items.length === 0 ? (
          <TranscriptSkeleton />
        ) : (
          <>
            {items.length === 0 && (
              <div className="line transcript-reveal" style={{ color: theme.textDim }}>
                {status === "ready"
                  ? "Ready. Type a message below to start coding."
                  : `\u273b ${status}`}
              </div>
            )}
            {items.map((it) => (
              <TranscriptRow key={it.id} item={it} onImageLoad={scrollToBottom} />
            ))}
          </>
        )}
      </div>

      <div className="liveregion">
        <LiveToolPanel entries={liveToolFeed} />
        <ActivityBar
          running={running}
          tokens={tokens}
          doneStatus={doneStatus}
          isThinking={isThinking}
          thinkingStartTs={thinkingStartTs}
          thinkingAccumMs={thinkingAccumMs}
          planTotal={planTotal}
          planDone={Math.min(planDone.size, planTotal)}
          onCancel={() => void cancel()}
        />
      </div>

      <div
        className="inputwrap"
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add("dragover");
        }}
        onDragLeave={(e) => e.currentTarget.classList.remove("dragover")}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove("dragover");
          if (e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files);
        }}
      >
        {slashOpen && (
          <SlashMenu
            commands={slashMatches}
            activeIndex={clampedSlashIndex}
            onSelect={pickSlashCommand}
            onHover={setSlashIndex}
          />
        )}
        <AttachmentBar attachments={attachments} onRemove={removeAttachment} />
        {queuedCount > 0 && (
          <div className="queued-bar">
            <span className="queued-dot" />
            {`${queuedCount} message${queuedCount === 1 ? "" : "s"} queued · will send after this run`}
          </div>
        )}
        <div className="inputrow">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            className="attach-btn"
            title="Attach files"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip size={16} />
          </button>
          <span className="prompt" style={{ color: theme.primary }}>
            {">"}
          </span>
          <input
            ref={inputRef}
            className="input"
            value={input}
            placeholder={
              running
                ? "Agent is working \u2014 queue a follow-up…"
                : "Type your message or / to run a command"
            }
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length > 0) {
                e.preventDefault();
                void addFiles(files);
              }
            }}
            onChange={(e) => {
              setInput(e.target.value);
              setSlashIndex(0);
            }}
            onKeyDown={(e) => {
              if (slashOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setSlashIndex((i) => (i + delta + slashMatches.length) % slashMatches.length);
              } else if (slashOpen && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
                e.preventDefault();
                const cmd = slashMatches[clampedSlashIndex];
                if (cmd) pickSlashCommand(cmd);
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                if (slashOpen) setInput("");
                else if (running) void cancel();
              }
            }}
            autoFocus
          />
        </div>
      </div>

      <div className="footer" style={{ color: theme.footerText }}>
        {!hydrated ? (
          <FooterSkeleton />
        ) : (
          <>
            <span className="footer-left footer-reveal" style={{ fontFamily: "var(--mono)" }}>
              {state?.cwd && (
                <span className="footer-cwd" style={{ color: theme.textDim }}>
                  {basename(state.cwd)}
                </span>
              )}
              {state?.gitBranch && (
                <>
                  {state?.cwd && <FooterSep />}
                  <span style={{ color: theme.secondary }}>{`\u2387 ${state.gitBranch}`}</span>
                </>
              )}
              {runningTaskCount > 0 && (
                <>
                  {(state?.cwd || state?.gitBranch) && <FooterSep />}
                  <BackgroundTasksButton tasks={tasks} />
                </>
              )}
              {state?.planMode && (
                <>
                  {(state?.cwd || state?.gitBranch || runningTaskCount > 0) && <FooterSep />}
                  <span className="footer-plan">
                    <ShimmerText base={theme.secondary} bright="#ddd6fe">
                      {"\u25C6 plan mode"}
                    </ShimmerText>
                  </span>
                </>
              )}
            </span>
            <span className="footer-right footer-reveal">
              {contextPct > 0 && (
                <>
                  <ContextMeter pct={contextPct} />
                  <FooterSep />
                </>
              )}
              {(state?.supportedThinkingLevels?.length ?? 0) > 0 &&
                (() => {
                  const level = state?.thinkingLevel ?? null;
                  const label = level ? `Thinking ${level}` : "Thinking off";
                  const maxPower = level === "xhigh" || level === "max";
                  return (
                    <>
                      <button
                        className="thinking-toggle"
                        style={{
                          color: thinkingColor(level),
                          fontWeight: level === "high" ? 600 : 400,
                        }}
                        title="Cycle reasoning level"
                        onClick={() => void cycleThinking()}
                      >
                        {maxPower ? (
                          <ShimmerText base={MAX_POWER_COLOR} bright={MAX_POWER_SHIMMER}>
                            {label}
                          </ShimmerText>
                        ) : (
                          label
                        )}
                      </button>
                      <FooterSep />
                    </>
                  );
                })()}
              <span className="model-anchor">
                {modelMenuOpen && models.length > 0 && (
                  <ModelMenu
                    models={models}
                    currentModel={state?.model ?? ""}
                    onSelect={onSelectModel}
                    onClose={() => setModelMenuOpen(false)}
                  />
                )}
                <button
                  className="model-button"
                  style={{ color: theme.text }}
                  disabled={running || models.length === 0}
                  title="Switch model"
                  onClick={() => setModelMenuOpen((o) => !o)}
                >
                  {state?.model ?? "\u2026"}
                </button>
              </span>
            </span>
          </>
        )}
      </div>

      {appUpdate.phase === "available" && (
        <button
          className="update-banner"
          title={`Update to ${appUpdate.version} — installs and restarts the app`}
          onClick={() => void appUpdate.install()}
        >
          <span className="update-banner-dot" />
          {`Ken just pushed a new update (${appUpdate.version}) — click here to install`}
        </button>
      )}
      {appUpdate.phase === "installing" && (
        <div className="update-banner update-banner-busy">
          <span className="update-banner-dot" />
          {"Installing update\u2026 the app will restart automatically."}
        </div>
      )}

      {showInitGit && (
        <InitGitModal
          defaultName={defaultRepoName}
          onClose={() => setShowInitGit(false)}
          onInitialize={(prompt) => {
            setShowInitGit(false);
            submitText(prompt, "Initializing Git\u2026");
          }}
        />
      )}

      {confirmNewSession && (
        <ConfirmModal
          title="New Session"
          message="This will create a new session for this project. The current conversation will be cleared. Are you sure?"
          confirmLabel="New Session"
          busy={newSessionBusy}
          onConfirm={() => void startNewSession()}
          onClose={() => setConfirmNewSession(false)}
        />
      )}

      {planReview !== null && (
        <PlanReviewModal
          content={planReview}
          onAccept={acceptPlan}
          onFeedback={sendPlanFeedback}
          onReject={rejectPlan}
        />
      )}
    </div>
  );
}

// ── Row renderers ──────────────────────────────────────────
function TranscriptRow({
  item,
  onImageLoad,
}: {
  item: Item;
  onImageLoad?: () => void;
}): React.ReactElement | null {
  switch (item.kind) {
    case "user":
      if (item.command) {
        // Workflow command: show just the short `/name` (or a friendly `label`
        // phrase) with a highlight + shimmer sweep. The full expanded prompt
        // was sent to the agent. Labels read as prose, so drop the mono font.
        return (
          <div className={`user-msg command${item.label ? " labelled" : ""}`}>
            <span className="command-shimmer" style={{ color: theme.commandColor }}>
              {item.label ?? item.text}
            </span>
          </div>
        );
      }
      return (
        <div className="user-msg">
          {item.images && item.images.length > 0 && (
            <div className="user-img-row">
              {item.images.map((src, i) => (
                <img key={i} className="user-img" src={src} alt="attachment" onLoad={onImageLoad} />
              ))}
            </div>
          )}
          {item.text}
        </div>
      );
    case "assistant": {
      // Split out [DONE:n] plan-step markers so each renders as a "✓ Step n"
      // completion row instead of leaking the raw marker into the prose.
      const segments = hasDoneMarker(item.text)
        ? segmentDoneMarkers(item.text)
        : [{ kind: "text" as const, text: item.text }];
      return (
        <>
          {segments.map((seg, i) =>
            seg.kind === "done" ? (
              <div key={i} className="plan-step-done">
                <span className="plan-step-check" aria-hidden="true">
                  {"\u2713"}
                </span>
                <span className="plan-step-label">{`Step ${seg.stepNum} complete`}</span>
              </div>
            ) : (
              <div key={i} className="assistant-msg">
                <span className="assistant-dot" style={{ color: theme.primary }}>
                  {DOT}
                </span>
                <div className="assistant-text">
                  <Markdown>{seg.text}</Markdown>
                </div>
              </div>
            ),
          )}
        </>
      );
    }
    case "info":
      return (
        <div className="line info" style={{ color: theme.textDim }}>
          {item.text}
        </div>
      );
    case "error":
      return (
        <div className="line error" style={{ color: theme.error }}>
          {item.text}
        </div>
      );
    case "hook": {
      // Mirrors the TUI IdealHookMessage: assistant-style dot + a shimmering
      // tone-colored one-liner so the self-correction is obvious.
      const { text, color } = HOOK_PRESENTATION[item.hook];
      return (
        <div className="assistant-msg">
          <span className="assistant-dot" style={{ color }}>
            {DOT}
          </span>
          <div className="assistant-text">
            <ShimmerText base={color} bright="#ffffff">
              {text}
            </ShimmerText>
          </div>
        </div>
      );
    }
    case "images":
      return (
        <div className="img-grid">
          {item.images.map((img, i) => (
            <figure key={img.path ?? i} className="img-card">
              <img
                className="img-thumb"
                src={img.src}
                alt={img.path ?? "image"}
                onLoad={onImageLoad}
              />
              {img.path && (
                <figcaption className="img-cap" title={img.path}>
                  {img.path.split("/").filter(Boolean).pop()}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      );
    case "plan":
      return <PlanModeLogo reason={item.reason} />;
    case "subagent_group":
      return <SubAgentFeed agents={item.agents} aborted={item.aborted} />;
    default:
      return null;
  }
}

export default App;
