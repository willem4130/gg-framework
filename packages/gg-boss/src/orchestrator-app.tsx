import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, render, useApp, useInput, useStdout } from "ink";
import { ThemeContext, loadTheme, useTheme } from "@kenkaiiii/ggcoder/ui/theme";
import {
  ActivityIndicator,
  AnimationProvider,
  AssistantMessage,
  CompactionDone,
  CompactionSpinner,
  InputArea,
  MessageResponse,
  ModelSelector,
  StreamingArea,
  ToolExecution,
  ToolUseLoader,
  UserMessage,
  useAnimationActive,
  useAnimationTick,
} from "@kenkaiiii/ggcoder/ui";
import { useDoublePress } from "@kenkaiiii/ggcoder/ui/hooks/double-press";
import type { Provider } from "@kenkaiiii/gg-ai";
import { TerminalSizeProvider, useTerminalSize } from "@kenkaiiii/ggcoder/ui/hooks/terminal-size";
import { BossFooter } from "./boss-footer.js";
import { BossBanner } from "./banner.js";
import { bossStore, useBossState } from "./boss-store.js";
import type {
  AssistantItem,
  BossOverlay,
  HistoryItem,
  StreamingTool,
  StreamingTurn,
  ToolItem,
  WorkerEventItem,
  WorkerErrorItem,
  WorkerView,
} from "./boss-store.js";
import { BOSS_SLASH_COMMANDS, canonicalName, parseSlash, buildHelpText } from "./slash-commands.js";
import { bossToolFormatters } from "./tool-formatters.js";
import { projectColor } from "./colors.js";
import { BOSS_PHRASES } from "./boss-phrases.js";
import { COLORS, PULSE_COLORS as BOSS_PULSE_COLORS } from "./branding.js";
import { BossTasksOverlay } from "./boss-tasks-overlay.js";
import type { GGBoss } from "./orchestrator.js";
import { VERSION } from "./branding.js";
import { RadioPicker } from "./radio-picker.js";
import { getCurrentStation, playRadio, stopRadio, RADIO_STATIONS } from "./radio.js";
import {
  getPendingUpdate,
  startPeriodicUpdateCheck,
  stopPeriodicUpdateCheck,
} from "./auto-update.js";

interface BannerRow {
  kind: "banner";
  id: string;
}
type StaticRow = BannerRow | HistoryItem;

interface BossAppProps {
  boss: GGBoss;
  /**
   * Called from /clear. Wired in `renderBossApp` to ANSI-wipe the terminal,
   * unmount the current Ink instance, and render a fresh one — the only
   * reliable way to reset log-update's internal cursor/line-count tracking
   * without the drift that manifests as "input pushed upward" after /clear.
   */
  resetUI?: () => void;
}

export function BossApp(props: BossAppProps): React.ReactElement {
  const theme = loadTheme("dark");
  return (
    <TerminalSizeProvider>
      <ThemeContext.Provider value={theme}>
        <AnimationProvider>
          <BossAppInner {...props} />
        </AnimationProvider>
      </ThemeContext.Provider>
    </TerminalSizeProvider>
  );
}

function BossAppInner({ boss, resetUI }: BossAppProps): React.ReactElement {
  const state = useBossState();
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { resizeKey, columns, rows } = useTerminalSize();
  const runStartRef = useRef<number | null>(null);
  runStartRef.current = state.runStartMs;
  // Live char count of the current streaming text — drives ActivityIndicator's
  // smooth token-counter animation between turn_end events.
  const charCountRef = useRef<number>(0);
  charCountRef.current = state.streaming?.text.length ?? 0;
  // Accumulated real input tokens across completed turns — used alongside
  // charCountRef so the counter interpolates smoothly between hard updates.
  const realTokensAccumRef = useRef<number>(0);
  realTokensAccumRef.current = state.bossInputTokens;
  // Track the most recent user message so the activity bar's contextual phrase
  // selection has something to riff on (when not using BOSS_PHRASES override).
  const [lastUserMessage, setLastUserMessage] = useState<string>("");
  // Overlay state lives in bossStore so it survives the unmount/remount
  // performed by openOverlay/closeOverlay. The new mount reads this back
  // and renders the same overlay it had pre-remount. See the resetUI
  // comment in renderBossApp for why we remount instead of just toggling
  // React state.
  const overlay = state.overlay;
  // Track the currently-playing station id so the picker can mark it with *
  // and so we have a reactive value for any future "now playing" indicator.
  // Seeded from the radio module's module-level state — usually null on
  // launch but resilient to a hot-restart of the React tree.
  const [currentRadio, setCurrentRadio] = useState<string | null>(() => getCurrentStation());
  // Auto-update indicator: true when a newer version of @kenkaiiii/gg-boss
  // is on disk waiting for the next restart. Seeded synchronously from the
  // state file (so we show the indicator immediately if a previous session
  // queued one) and bumped to true by the periodic check below if a fresh
  // version drops mid-session.
  const [updatePending, setUpdatePending] = useState<boolean>(
    () => getPendingUpdate(VERSION) !== null,
  );

  // Periodic in-session check — pings npm every hour while the session is
  // alive. If a newer version arrives, we set updatePending so the worker
  // bar shows the "✨ Update ready · restart to apply" hint, AND drop a
  // friendly info row into chat so the user sees the news immediately.
  useEffect(() => {
    startPeriodicUpdateCheck(VERSION, (msg) => {
      // Dedicated update_notice item so the renderer wraps it in a
      // rounded success-bordered ✨ box. Plain info rows render flat and
      // disappear into worker chatter.
      bossStore.appendUpdateNotice(msg);
      setUpdatePending(true);
    });
    return () => stopPeriodicUpdateCheck();
  }, []);

  // Terminal title — dynamically reflects worker activity so the user can
  // glance at the tab/window from another app and see how many workers are
  // still running. OSC 0 sets both window and tab title in most modern
  // terminals (Ghostty, Terminal.app, iTerm2, Kitty).
  //
  // States:
  //   N workers running    "● 5 workers running · GG Boss"
  //   1 worker running     "● 1 worker running · GG Boss"
  //   boss thinking only   "● GG Boss"
  //   idle                 "GG Boss"
  const workersRunning = state.workers.filter((w) => w.status === "working").length;
  const titlePrevRef = useRef("");
  useEffect(() => {
    if (!stdout) return;
    let title: string;
    if (workersRunning > 0) {
      const label = `${workersRunning} worker${workersRunning === 1 ? "" : "s"} running`;
      title = `● ${label} · GG Boss`;
    } else if (state.phase === "working") {
      title = "● GG Boss";
    } else {
      title = "GG Boss";
    }
    if (title !== titlePrevRef.current) {
      titlePrevRef.current = title;
      stdout.write(`\x1b]0;${title}\x1b\\`);
    }
  }, [stdout, workersRunning, state.phase]);
  useEffect(() => {
    return () => {
      stdout?.write(`\x1b]0;GG Boss\x1b\\`);
    };
  }, [stdout]);

  const staticItems: StaticRow[] = useMemo(
    () => [{ kind: "banner", id: "banner" }, ...state.history],
    [state.history],
  );

  /**
   * Opening or closing an overlay shrinks/grows the live area dramatically
   * (tasks pane → chat chrome, model picker → chat chrome, etc.). Toggling
   * React state alone leaves Ink's log-update cursor math drifting on the
   * very next streaming response, surfacing as "input pushed upward, new
   * chat lines disappear off the top". Mirrors ggcoder's broader fix
   * (commit 0246c6d): every overlay open/close goes through resetUI which
   * unmounts the Ink instance and renders a fresh one. The overlay
   * selection survives via bossStore.overlay.
   */
  const openOverlay = useCallback(
    (next: BossOverlay): void => {
      bossStore.setOverlay(next);
      if (resetUI) resetUI();
    },
    [resetUI],
  );

  const closeOverlay = useCallback((): void => {
    bossStore.setOverlay(null);
    if (resetUI) resetUI();
  }, [resetUI]);
  void stdout;

  // ggcoder's double-press pattern: 800ms window. First press shows
  // "Press Ctrl+C again to exit" in the footer; second within 800ms exits.
  const handleDoubleExit = useDoublePress(
    (pending) => bossStore.setExitPending(pending),
    () => exit(),
  );

  // Two-phase flush — see boss-store.ts for the rationale. Phase 1 (orchestrator
  // pushes into pendingFlush, live area shrinks) already happened; phase 2 here
  // commits to history on the next render so Ink doesn't clip long responses.
  useEffect(() => {
    if (state.pendingFlush.length > 0) {
      bossStore.commitPendingFlush();
    }
  }, [state.flushGeneration, state.pendingFlush.length]);

  // ── App-level keyboard ──────────────────────────────────
  // ESC: abort current boss call when working (InputArea handles otherwise).
  // Ctrl+T: toggle the Tasks overlay (matches ggcoder's keybind).
  useInput((input, key) => {
    if (key.ctrl && input === "t") {
      if (overlay === "tasks") closeOverlay();
      else openOverlay("tasks");
      return;
    }
    if (key.escape && state.phase === "working") {
      boss.abort();
    }
  });

  const handleSlashCommand = async (value: string): Promise<boolean> => {
    const parsed = parseSlash(value);
    if (!parsed) return false;
    const name = canonicalName(parsed.name);
    if (!name) {
      bossStore.appendInfo(`Unknown command: /${parsed.name}`, "warning");
      return true;
    }
    switch (name) {
      case "help":
        bossStore.appendUser(value);
        // Render help via an assistant block so Markdown formatting + dot prefix.
        bossStore.appendInfo(buildHelpText(), "info");
        return true;
      case "clear":
        // Order matters. resetUI() unmounts the old Ink instance and
        // synchronously renders a fresh one — that first render reads the
        // bossStore via useBossState(). If we clear the store AFTER resetUI,
        // the new <Static> emits every old history item into the just-wiped
        // scrollback, which is exactly the "input pushed upward, subsequent
        // messages look cleared" symptom. Empty the store first so the new
        // instance mounts against an empty history.
        bossStore.clearHistory();
        resetUI?.();
        await boss.resetConversation();
        bossStore.appendInfo("Session cleared.", "info");
        return true;
      case "model-boss":
        openOverlay("model-boss");
        return true;
      case "model-workers":
        openOverlay("model-workers");
        return true;
      case "compact":
        bossStore.appendUser(value);
        await boss.manualCompact();
        return true;
      case "radio":
        openOverlay("radio");
        return true;
      case "quit":
        exit();
        return true;
    }
    return false;
  };

  const handleModelSelect = (value: string): void => {
    const colon = value.indexOf(":");
    if (colon < 0) {
      closeOverlay();
      return;
    }
    const provider = value.slice(0, colon) as Provider;
    const model = value.slice(colon + 1);
    if (overlay === "model-boss") {
      void boss.switchBossModel(provider, model);
    } else if (overlay === "model-workers") {
      void boss.switchWorkerModel(provider, model);
    }
    closeOverlay();
  };

  const handleSubmit = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
      void handleSlashCommand(trimmed);
      return;
    }
    // Show the user's literal text in chat history.
    bossStore.appendUser(trimmed);
    setLastUserMessage(trimmed);
    // Inject the scope pill into the message the boss actually sees, so the
    // user doesn't have to write "for the yaatuber project, …" every prompt.
    const scoped = scopePrefix(state.scope) + trimmed;
    boss.enqueueUserMessage(scoped);
  };

  const handleAbort = (): void => {
    // Ctrl+C while boss is running → single-press abort (matches ggcoder).
    if (state.phase === "working") {
      boss.abort();
      return;
    }
    // Boss is idle → double-press to exit, with footer pending message.
    handleDoubleExit();
  };

  // Live area = streaming + activity + input (≥3 lines, bordered) + footer +
  // workerbar. Below ~14 rows we can't fit all of it without log-update
  // running out of vertical space — at which point Ink's cursor math drifts
  // and you see "input pushed upward, new output disappears." Render a
  // friendly resize hint instead so the user knows what's happening rather
  // than thinking the app is broken. We're already past the static history
  // mount, so scrollback survives the resize that brings the user back.
  if (rows < 14) {
    return (
      <Box flexDirection="column" width={columns} paddingX={1} marginTop={1}>
        <Text bold color={COLORS.accent}>
          {"Terminal too small"}
        </Text>
        <Text color={COLORS.primary}>
          {`Resize to at least 14 rows to use GG Boss (currently ${rows}).`}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={columns}>
      {/* Static is mounted ONCE for the lifetime of the app and never remounts
          on overlay toggles. resizeKey still triggers a remount on terminal
          resize (which is necessary so the layout recomputes) — that's the
          only legitimate reason to drop and re-emit the scrollback. */}
      <Static key={resizeKey} items={staticItems} style={{ width: "100%" }}>
        {(item) => (
          <Box key={item.id} flexDirection="column" paddingRight={1}>
            <StaticRowView row={item} />
          </Box>
        )}
      </Static>

      {overlay === "tasks" ? (
        <BossTasksOverlay boss={boss} workers={state.workers} onClose={closeOverlay} />
      ) : (
        <>
          {state.streaming && (
            <StreamingTurnView turn={state.streaming} isRunning={state.phase === "working"} />
          )}
          {state.phase === "working" && (
            <Box marginTop={1}>
              <ActivityIndicator
                phase={state.activityPhase}
                elapsedMs={state.runStartMs ? Date.now() - state.runStartMs : 0}
                runStartRef={runStartRef as React.RefObject<number>}
                thinkingMs={state.streaming?.thinkingMs ?? 0}
                isThinking={state.activityPhase === "thinking"}
                tokenEstimate={state.bossInputTokens}
                charCountRef={charCountRef}
                realTokensAccumRef={realTokensAccumRef}
                userMessage={lastUserMessage}
                activeToolNames={(state.streaming?.tools ?? [])
                  .filter((t) => t.status === "running")
                  .map((t) => t.name)}
                retryInfo={state.retryInfo}
                phrases={BOSS_PHRASES}
                pulseColors={BOSS_PULSE_COLORS}
              />
            </Box>
          )}
          {state.compaction?.state === "running" && <CompactionSpinner />}
          {state.compaction?.state === "done" && (
            <CompactionDone
              originalCount={state.compaction.originalCount}
              newCount={state.compaction.newCount}
              tokensBefore={state.compaction.tokensBefore}
              tokensAfter={state.compaction.tokensAfter}
            />
          )}

          <InputArea
            onSubmit={handleSubmit}
            onAbort={handleAbort}
            disabled={state.phase === "working"}
            isActive={!overlay}
            cwd={process.cwd()}
            commands={BOSS_SLASH_COMMANDS}
            scopeBadge={<ScopePill scope={state.scope} />}
            // Mouse-tracking escape sequences cause Ghostty to emit phantom
            // pastes of the system clipboard during high-frequency UI updates
            // (workers running, shimmer animating). gg-boss's UI updates a lot,
            // so we forfeit click-to-position-cursor in the input to keep
            // the clipboard from leaking into the chat field.
            disableMouseTracking
            onTab={() => bossStore.cycleScope()}
            onShiftTab={() => {
              // Don't appendInfo — Static lives outside the overlay branch, so
              // any history row added here renders in scrollback above the
              // tasks pane and looks like it's inside it. The footer already
              // shows live "Thinking on/off" — that's the indicator.
              const next = state.bossThinkingLevel ? undefined : "medium";
              void boss.setBossThinking(next);
            }}
          />

          {overlay === "model-boss" || overlay === "model-workers" ? (
            <ModelSelector
              onSelect={handleModelSelect}
              onCancel={closeOverlay}
              loggedInProviders={state.loggedInProviders}
              currentModel={overlay === "model-boss" ? state.bossModel : state.workerModel}
              currentProvider={overlay === "model-boss" ? state.bossProvider : state.workerProvider}
            />
          ) : overlay === "radio" ? (
            <RadioPicker
              currentStationId={currentRadio}
              onCancel={closeOverlay}
              onSelect={(value) => {
                if (value === "off") {
                  stopRadio();
                  setCurrentRadio(null);
                  bossStore.appendInfo("Radio off.", "info");
                } else {
                  const result = playRadio(value);
                  if (result.ok) {
                    setCurrentRadio(value);
                    const station = RADIO_STATIONS.find((s) => s.id === value);
                    bossStore.appendInfo(`Now playing: ${station?.name ?? value}`, "info");
                  } else {
                    bossStore.appendInfo(result.error ?? "Radio failed to start.", "warning");
                  }
                }
                closeOverlay();
              }}
            />
          ) : (
            <>
              <BossFooter
                bossModel={state.bossModel}
                workerModel={state.workerModel}
                tokensIn={state.bossInputTokens}
                exitPending={state.exitPending}
                bossThinkingLevel={state.bossThinkingLevel}
                updatePending={updatePending}
                currentRadioStationId={currentRadio}
              />
              {!state.exitPending && (
                <WorkerStatusBar
                  workers={state.workers}
                  pendingMessages={state.pendingUserMessages}
                />
              )}
            </>
          )}
        </>
      )}
    </Box>
  );
}

// ── Scope pill (gg-boss specific) ──────────────────────────

function ScopePill({ scope }: { scope: string }): React.ReactElement {
  const theme = useTheme();
  const isAll = scope === "all";
  // "All" → boss accent (fuchsia) so multi-project mode wears the brand.
  // Specific project → its stable project color so the pill matches its
  // appearances elsewhere in the TUI.
  const bg = isAll ? COLORS.accent : projectColor(scope);
  const label = isAll ? "All" : scope;
  // Black text reads cleanly on every color in the palette — the project hues
  // are deliberately light/saturated, which is unreadable with white on top.
  return (
    <Text>
      <Text color={theme.textDim}>Project </Text>
      <Text color="black" backgroundColor={bg} bold>
        {` ${label} `}
      </Text>
      <Text color={theme.textDim}>
        {"  "}
        <Text color={theme.primary}>Tab</Text>
        {" to switch"}
      </Text>
    </Text>
  );
}

/**
 * Prepend the active scope to the user's message before it reaches the boss.
 * Boss's system prompt teaches it to interpret these prefixes.
 */
function scopePrefix(scope: string): string {
  if (scope === "all") return "[scope:all] ";
  return `[scope:${scope}] `;
}

// ── Worker status row (gg-boss specific) ───────────────────

const SHIMMER_WIDTH = 3;

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Mount this when (and only when) the shimmer needs to tick. AnimationProvider
 * stops the global timer when its subscriber count hits zero, so unmounting
 * this sentinel halts the 10Hz re-render loop while every worker is idle.
 */
function AnimationActiveSentinel(): null {
  useAnimationActive();
  return null;
}

/**
 * Same shimmer pattern used by ggcoder's ActivityIndicator phrases — a bright
 * highlight band of width `SHIMMER_WIDTH` slides across the text while the
 * rest stays dim. Driven by the global animation tick.
 */
function ShimmerName({
  name,
  color,
  tick,
}: {
  name: string;
  color: string;
  tick: number;
}): React.ReactElement {
  // Cycle covers the name length plus a SHIMMER_WIDTH-wide pre-roll/post-roll
  // so the bright band fully exits one side before re-entering the other.
  const cycle = name.length + SHIMMER_WIDTH * 2;
  const shimmerPos = (tick % cycle) - SHIMMER_WIDTH;
  return (
    <Text>
      {name.split("").map((ch, i) => {
        const isBright = Math.abs(i - shimmerPos) <= SHIMMER_WIDTH;
        return (
          <Text key={i} color={color} bold={isBright} dimColor={!isBright}>
            {ch}
          </Text>
        );
      })}
    </Text>
  );
}

function WorkerStatusBar({
  workers,
  pendingMessages,
}: {
  workers: WorkerView[];
  pendingMessages: number;
}): React.ReactElement | null {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  // Active-first layout: only working and errored workers get named slots.
  // Idle workers collapse into a single "+N idle" trailer so the bar scales
  // cleanly from 5 projects to 50. With 4 of 50 projects active, you see
  // four shimmering names + "+46 idle" instead of fifty repeated glyphs.
  const working = workers.filter((w) => w.status === "working");
  const errored = workers.filter((w) => w.status === "error");
  const idleCount = workers.length - working.length - errored.length;
  const anyWorking = working.length > 0;
  // Passive tick consumer — when no Sentinel is mounted (no working worker),
  // the global timer is paused and the tick value stops changing, so this
  // component doesn't re-render at 10Hz when everything is idle.
  const tick = useAnimationTick();
  const now = Date.now();

  if (workers.length === 0) return null;
  // Render order: working (shimmer + timer) → errored (✗ + name) → idle
  // count (dim "N idle"). The shimmer + project hue already announce
  // "active" — no need for a leading ● dot. The errored ✗ stays because
  // colour alone isn't enough to call out a stuck worker. The idle slot
  // keeps the ○ as a glyph-only quantifier ("○ 17"). Separator: thin
  // vertical bar, matching the footer's style.
  const slots: React.ReactElement[] = [];
  for (const w of working) {
    const projectHue = projectColor(w.name);
    const elapsed = w.workStartedAt ? formatElapsed(now - w.workStartedAt) : null;
    slots.push(
      <React.Fragment key={`w-${w.name}`}>
        <ShimmerName name={w.name} color={projectHue} tick={tick} />
        {elapsed && <Text color={theme.textDim}> {elapsed}</Text>}
      </React.Fragment>,
    );
  }
  for (const w of errored) {
    slots.push(
      <React.Fragment key={`e-${w.name}`}>
        <Text color={theme.error}>✗ {w.name}</Text>
      </React.Fragment>,
    );
  }
  if (idleCount > 0) {
    slots.push(
      <React.Fragment key="idle">
        <Text color={theme.textDim}>○ {idleCount} idle</Text>
      </React.Fragment>,
    );
  }
  // Hard-pin the bar to a single line: any wrap multiplies live-area height
  // and Ink's log-update can't redraw a varying-height live area while a
  // streaming response is mid-flight (the symptom: bordered input duplicates
  // upward and new chat lines fall off the top). With many workers + a
  // narrow terminal this would otherwise wrap to two or three lines, so we
  // truncate at the right edge instead. Width=columns + flexShrink lets the
  // truncation kick in cleanly inside the parent column layout.
  return (
    <Box paddingX={1} width={columns} flexShrink={1}>
      {anyWorking && <AnimationActiveSentinel />}
      <Text wrap="truncate">
        {slots.map((slot, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Text color={theme.border}>{" │ "}</Text>}
            {slot}
          </React.Fragment>
        ))}
        {pendingMessages > 0 && (
          <>
            <Text color={theme.textDim}>{"   "}</Text>
            <Text color={theme.warning}>
              {pendingMessages} message{pendingMessages === 1 ? "" : "s"} queued
            </Text>
          </>
        )}
      </Text>
    </Box>
  );
}

// ── Row dispatch ───────────────────────────────────────────

function StaticRowView({ row }: { row: StaticRow }): React.ReactElement | null {
  if (row.kind === "banner") {
    return (
      <Box paddingX={1}>
        <BossBanner subtitle="Orchestrator" showShortcuts />
      </Box>
    );
  }
  if (row.kind === "user") return <UserMessage text={row.text} />;
  if (row.kind === "assistant") return <AssistantRow item={row} />;
  if (row.kind === "tool") return <ToolHistoryRow item={row} />;
  if (row.kind === "worker_event") return <WorkerEventRow item={row} />;
  if (row.kind === "worker_error") return <WorkerErrorRow item={row} />;
  if (row.kind === "info") return <InfoRow text={row.text} level={row.level ?? "info"} />;
  if (row.kind === "task_dispatch") return <TaskDispatchRow tasks={row.tasks} />;
  if (row.kind === "update_notice") return <UpdateNoticeRow text={row.text} />;
  return null;
}

/**
 * Update-available notice — gg-boss brand aesthetic. Rounded box, fuchsia
 * accent border, crimson primary body text. Mirrors the gradient feel of the
 * splash + banner so the notice reads as part of gg-boss rather than a
 * borrowed-green ggcoder element. The ✨ rides the accent so the eye lands
 * on the highlight first, then reads the primary-colored body.
 */
function UpdateNoticeRow({ text }: { text: string }): React.ReactElement {
  return (
    <Box marginTop={1} flexShrink={1} borderStyle="round" borderColor={COLORS.accent} paddingX={1}>
      <Text wrap="wrap">
        <Text color={COLORS.accent} bold>
          {"✨ "}
        </Text>
        <Text color={COLORS.primary} bold>
          {text}
        </Text>
      </Text>
    </Box>
  );
}

function TaskDispatchRow({
  tasks,
}: {
  tasks: { project: string; title: string }[];
}): React.ReactElement {
  const theme = useTheme();
  const count = tasks.length;
  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text>
        <Text color={COLORS.primary} bold>
          {"⏺ "}
        </Text>
        <Text color={theme.text} bold>
          Running {count} task{count === 1 ? "" : "s"}
          {":"}
        </Text>
      </Text>
      {tasks.map((t, i) => (
        <Text key={`${t.project}-${i}`}>
          <Text color={theme.textDim}>{"    • "}</Text>
          <Text color={projectColor(t.project)} bold>
            {t.project}
          </Text>
          <Text color={theme.textDim}>{": "}</Text>
          <Text color={theme.text}>{t.title}</Text>
        </Text>
      ))}
    </Box>
  );
}

/**
 * Auto-highlight common keyboard shortcuts in any boss-written prose by
 * wrapping them in backticks before passing to the Markdown renderer (which
 * styles inline code with a distinctive color/background). Catches things
 * like Ctrl+T, Shift+Tab, Cmd+K, Esc, F-keys, arrow-key combos. The boss may
 * already wrap them itself — these regexes deliberately skip text that's
 * already inside backticks (or fenced blocks) so we don't double-wrap.
 */
const SHORTCUT_PATTERNS: RegExp[] = [
  // Modifier+Key combos: Ctrl+T, Shift+Tab, Cmd+K, Ctrl+Shift+P, Ctrl+C
  /\b(?:Ctrl|Cmd|Alt|Option|Opt|Shift|Meta|Win|Super)(?:\s*\+\s*(?:Ctrl|Cmd|Alt|Option|Opt|Shift|Meta|Win|Super))*\s*\+\s*(?:Tab|Enter|Esc|Escape|Space|Backspace|Delete|Del|Home|End|PageUp|PageDown|Up|Down|Left|Right|F[1-9]|F1[0-2]|[A-Z0-9]|\/|\?|\.|,|;|=|-)\b/g,
  // Bare named keys (only when surrounded by clear key context)
  /\b(?:Ctrl-[A-Z]|F[1-9]|F1[0-2])\b/g,
];

function highlightShortcuts(text: string): string {
  if (!text) return text;
  // Mask code spans + fenced blocks so we don't try to re-wrap shortcuts that
  // are already in backtick territory. The sentinel uses a private-use unicode
  // codepoint so it can't realistically collide with anything the boss writes.
  const SENTINEL = "";
  const masks: string[] = [];
  let masked = text.replace(/```[\s\S]*?```|`[^`]+`/g, (m) => {
    const idx = masks.push(m) - 1;
    return `${SENTINEL}${idx}${SENTINEL}`;
  });
  for (const re of SHORTCUT_PATTERNS) {
    masked = masked.replace(re, (m) => `\`${m}\``);
  }
  return masked.replace(
    new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, "g"),
    (_, i) => masks[Number(i)]!,
  );
}

function AssistantRow({ item }: { item: AssistantItem }): React.ReactElement {
  return (
    <AssistantMessage
      text={highlightShortcuts(item.text)}
      thinking={item.thinking}
      thinkingMs={item.thinkingMs}
    />
  );
}

function ToolHistoryRow({ item }: { item: ToolItem }): React.ReactElement {
  return (
    <ToolExecution
      status="done"
      name={item.name}
      args={item.args}
      result={item.result}
      isError={item.isError}
      details={item.details}
      formatters={bossToolFormatters}
    />
  );
}

// ── Worker rows (gg-boss specific) ─────────────────────────

type WorkerStatusGrade = "DONE" | "UNVERIFIED" | "PARTIAL" | "BLOCKED" | "INFO";

/**
 * Pull the `Status:` line out of a worker's final text (the brief in
 * tools.ts asks every worker to end with one of: DONE | UNVERIFIED |
 * PARTIAL | BLOCKED | INFO). Returns null if the line is missing or invalid.
 */
function parseStatusGrade(text: string): WorkerStatusGrade | null {
  // Use the LAST occurrence of "Status: X" (some workers explain status
  // mid-text and re-emit it in the trailer). Also accept anything after the
  // grade word — workers occasionally write "Status: INFO — trailing comment"
  // which the previous end-of-line anchor would have rejected.
  const matches = [...text.matchAll(/^\s*Status:\s*(DONE|UNVERIFIED|PARTIAL|BLOCKED|INFO)\b/gim)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  return last[1]!.toUpperCase() as WorkerStatusGrade;
}

interface WorkerTrailer {
  changed?: string;
  skipped?: string;
  verified?: string;
  notes?: string;
}

/**
 * Pull the structured fields out of the worker's reply trailer (appended by
 * WORKER_PROMPT_BRIEF). Each field is captured up to (but not including) the
 * next field marker or end-of-text.
 */
function parseWorkerTrailer(text: string): WorkerTrailer {
  const out: WorkerTrailer = {};
  const grab = (label: string): string | undefined => {
    // Match "Label: value" up to the next "Label:" line or end. Multi-line.
    const re = new RegExp(
      `^\\s*${label}:\\s*([\\s\\S]*?)(?=^\\s*(?:Changed|Skipped|Verified|Notes|Status):|$)`,
      "im",
    );
    const m = re.exec(text);
    if (!m) return undefined;
    const v = m[1]!
      .replace(/```[\s\S]*?```/g, "[code]")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    return v.length > 0 ? v : undefined;
  };
  out.changed = grab("Changed");
  out.skipped = grab("Skipped");
  out.verified = grab("Verified");
  out.notes = grab("Notes");
  return out;
}

function clip(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, Math.max(1, maxLen - 1)) + "…";
}

/**
 * Build a one-line summary from the trailer. Prefers the substantive fields
 * (Changed, Verified, Notes) that actually tell the user what happened — not
 * the worker's preamble like "I'll start by detecting...". Falls back to
 * first-sentence-of-preamble only when the trailer is empty (non-conforming
 * worker reply).
 */
function summarizeFinalText(text: string, maxLen: number): string {
  if (!text) return "";
  const trailer = parseWorkerTrailer(text);
  const parts: string[] = [];
  if (trailer.changed) parts.push(`Changed: ${trailer.changed}`);
  if (trailer.verified) parts.push(`Verified: ${trailer.verified}`);
  if (trailer.skipped) parts.push(`Skipped: ${trailer.skipped}`);
  if (trailer.notes) parts.push(`Notes: ${trailer.notes}`);
  if (parts.length > 0) return clip(parts.join("  ·  "), maxLen);

  // No trailer — fall back to the first sentence of the response body.
  const beforeSummary = text.split(/^Changed:|^Skipped:|^Verified:|^Notes:|^Status:/im)[0];
  const stripped = beforeSummary
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "";
  const firstSentence = stripped.match(/^[^.!?\n]+[.!?]/);
  return clip(firstSentence ? firstSentence[0] : stripped, maxLen);
}

function statusGradeColor(
  grade: WorkerStatusGrade | null,
  theme: ReturnType<typeof useTheme>,
): string {
  switch (grade) {
    case "DONE":
      return theme.success;
    case "UNVERIFIED":
    case "PARTIAL":
      return theme.warning;
    case "BLOCKED":
      return theme.error;
    case "INFO":
      return theme.textDim;
    default:
      return theme.textDim;
  }
}

function WorkerEventRow({ item }: { item: WorkerEventItem }): React.ReactElement {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const failedCount = item.toolsUsed.filter((t) => !t.ok).length;
  const total = item.toolsUsed.length;
  const grade = parseStatusGrade(item.finalText);
  // Loader status: prefer the worker's self-reported grade. Fall back to
  // tool-error count if the worker omitted Status (older runs / non-conforming).
  const loaderStatus =
    grade === "BLOCKED" || failedCount > 0
      ? "error"
      : grade === "UNVERIFIED" || grade === "PARTIAL"
        ? "queued"
        : "done";
  // Errors override the project hue with red; otherwise the project gets its
  // stable color so successive turns from the same worker visually cluster.
  const headerColor = loaderStatus === "error" ? theme.toolError : projectColor(item.project);
  const toolSummary =
    total === 0
      ? "no tools"
      : failedCount > 0
        ? `${total} tools (${failedCount} failed)`
        : `${total} tool${total === 1 ? "" : "s"}`;
  // MessageResponse uses 6 chars for "  ⎿  " gutter; reserve a few more for
  // safety. Each trailer field renders on its own line so users can scan
  // Changed / Verified / Notes independently rather than a single squished line.
  const fieldMaxLen = Math.max(20, columns - 14);
  const trailer = parseWorkerTrailer(item.finalText);
  const hasTrailer = !!(trailer.changed || trailer.skipped || trailer.verified || trailer.notes);
  const fallbackSummary = hasTrailer ? "" : summarizeFinalText(item.finalText, fieldMaxLen);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <ToolUseLoader status={loaderStatus} />
        <Box flexGrow={1}>
          <Text wrap="wrap">
            <Text color={headerColor} bold>
              {item.project}
            </Text>
            <Text color={theme.text}>{`  turn ${item.turnIndex}`}</Text>
            <Text color={theme.textDim}>{`  ·  ${toolSummary}`}</Text>
            {grade && (
              <>
                <Text color={theme.textDim}>{"  ·  "}</Text>
                <Text color={statusGradeColor(grade, theme)} bold>
                  {grade}
                </Text>
              </>
            )}
          </Text>
        </Box>
      </Box>
      {hasTrailer ? (
        <>
          {trailer.changed && (
            <TrailerLine label="Changed" value={trailer.changed} maxLen={fieldMaxLen} />
          )}
          {trailer.verified && (
            <TrailerLine
              label="Verified"
              value={trailer.verified}
              maxLen={fieldMaxLen}
              labelColor={theme.success}
            />
          )}
          {trailer.skipped && (
            <TrailerLine
              label="Skipped"
              value={trailer.skipped}
              maxLen={fieldMaxLen}
              labelColor={theme.warning}
            />
          )}
          {trailer.notes && (
            <TrailerLine label="Notes" value={trailer.notes} maxLen={fieldMaxLen} />
          )}
        </>
      ) : (
        fallbackSummary && (
          <MessageResponse>
            <Text color={theme.textDim} wrap="truncate">
              {fallbackSummary}
            </Text>
          </MessageResponse>
        )
      )}
    </Box>
  );
}

function TrailerLine({
  label,
  value,
  maxLen,
  labelColor,
}: {
  label: string;
  value: string;
  maxLen: number;
  labelColor?: string;
}): React.ReactElement {
  const theme = useTheme();
  return (
    <MessageResponse>
      <Text wrap="truncate">
        <Text color={labelColor ?? theme.textDim} bold>
          {label}:
        </Text>
        <Text color={theme.text}>{` ${clip(value, maxLen - label.length - 2)}`}</Text>
      </Text>
    </MessageResponse>
  );
}

function WorkerErrorRow({ item }: { item: WorkerErrorItem }): React.ReactElement {
  const theme = useTheme();
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <ToolUseLoader status="error" />
        <Box flexGrow={1}>
          <Text wrap="wrap">
            <Text color={theme.toolError} bold>
              {item.project}
            </Text>
            <Text color={theme.textDim}>{"  worker error"}</Text>
          </Text>
        </Box>
      </Box>
      <MessageResponse>
        <Text color={theme.error} wrap="wrap">
          {item.message}
        </Text>
      </MessageResponse>
    </Box>
  );
}

function InfoRow({
  text,
  level,
}: {
  text: string;
  level: "info" | "warning" | "error";
}): React.ReactElement {
  // info → render through AssistantMessage so it gets the dot + Markdown.
  if (level === "info") return <AssistantMessage text={text} />;
  // warning / error → match the ToolUseLoader chrome so the row reads as a
  // first-class event (consistent with worker errors / failed tool calls)
  // rather than bare colored text.
  const theme = useTheme();
  const color = level === "error" ? theme.error : theme.warning;
  return (
    <Box marginTop={1} flexDirection="row">
      <ToolUseLoader status={level === "error" ? "error" : "queued"} />
      <Box flexGrow={1}>
        <Text color={color} wrap="wrap">
          {text}
        </Text>
      </Box>
    </Box>
  );
}

// ── Streaming (live) ───────────────────────────────────────

function StreamingTurnView({
  turn,
  isRunning,
}: {
  turn: StreamingTurn;
  isRunning: boolean;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <StreamingArea
        isRunning={isRunning}
        streamingText={turn.text}
        streamingThinking={turn.thinking}
        thinkingMs={turn.thinkingMs}
      />
      {turn.tools.map((t) => (
        <StreamingToolRow key={t.toolCallId} tool={t} />
      ))}
    </Box>
  );
}

function StreamingToolRow({ tool }: { tool: StreamingTool }): React.ReactElement {
  if (tool.status === "running") {
    return (
      <ToolExecution
        status="running"
        name={tool.name}
        args={tool.args}
        formatters={bossToolFormatters}
      />
    );
  }
  return (
    <ToolExecution
      status="done"
      name={tool.name}
      args={tool.args}
      result={tool.result ?? ""}
      isError={tool.status === "error"}
      details={tool.details}
      formatters={bossToolFormatters}
    />
  );
}

// ── Renderer ───────────────────────────────────────────────

export interface RenderBossAppOptions {
  boss: GGBoss;
}

export function renderBossApp(opts: RenderBossAppOptions): {
  waitUntilExit: () => Promise<void>;
  unmount: () => void;
} {
  // Nuke-and-rebuild approach for /clear. Three earlier attempts at patching
  // Ink's internal frame-tracking state in place all hit the same wall: even
  // with log-update reset + lastOutput cleared + fullStaticOutput dropped,
  // the live area drifts after the next streaming response because Ink's
  // cursor math depends on terminal-state assumptions that ANSI clearing
  // breaks. The only RELIABLE reset is to teardown the React tree entirely
  // and render a fresh Ink instance. State outside React (GGBoss class,
  // bossStore singleton) survives and the new tree picks it up correctly.
  const ref: { instance: ReturnType<typeof render> | null } = { instance: null };
  const resetUI = (): void => {
    const old = ref.instance;
    if (!old) return;
    // Clear the visible viewport first without erasing saved scrollback.
    process.stdout.write("\x1b[2J\x1b[H");
    // Unmount unsubscribes Ink's stdin handlers + tears down the React tree.
    old.unmount();
    // Build a fresh Ink instance with totally clean log-update state and
    // start cursor tracking. BossApp re-mounts and reads the (already
    // cleared) bossStore, so the chat shows just the banner + "Session
    // cleared." info row — exactly as the user expects.
    ref.instance = render(<BossApp boss={opts.boss} resetUI={resetUI} />, {
      exitOnCtrlC: false,
    });
  };
  const instance = render(<BossApp boss={opts.boss} resetUI={resetUI} />, {
    // Disable Ink's built-in exit-on-Ctrl+C — we need our own double-press
    // handler in BossApp to drive the "Press Ctrl+C again to exit" footer
    // message. With this flag true (the default), Ink kills the process on
    // the very first Ctrl+C and InputArea's onAbort never runs.
    exitOnCtrlC: false,
  });
  ref.instance = instance;

  // Terminal resize → full unmount/remount of the Ink instance.
  //
  // useTerminalSize already debounces resize events (300ms) and writes a
  // screen clear at the end of a drag, but that doesn't reset Ink's
  // log-update internal line-count tracking — so on the very next render
  // the live area is positioned against stale cursor state and the input
  // box ends up pinned to the top of the viewport with new chat lines
  // disappearing off-screen. That's the exact symptom /clear hit, and the
  // fix is the same: tear down the React tree and start fresh.
  //
  // Debounce is 250ms — slightly shorter than the hook's 300ms so resetUI
  // wins the race. When resetUI's unmount runs, the hook's pending
  // setTimeout is cleared by its own useEffect cleanup, so we don't
  // double-fire. State outside React (GGBoss class, bossStore singleton,
  // overlay) survives.
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const onTerminalResize = (): void => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      resetUI();
    }, 250);
  };
  process.stdout.on("resize", onTerminalResize);

  return {
    // Follow ref.instance through restarts: when /clear nukes the current
    // instance and creates a new one, this promise re-binds to whichever
    // Ink instance is alive now. Without the loop, we'd wait on the OLD
    // instance's waitUntilExit (which already resolved on unmount) and
    // exit the CLI immediately after every /clear.
    waitUntilExit: async () => {
      while (true) {
        const current = ref.instance;
        if (!current) {
          process.stdout.off("resize", onTerminalResize);
          if (resizeTimer) clearTimeout(resizeTimer);
          return;
        }
        await current.waitUntilExit();
        // If the user ran /clear, ref.instance is now a NEW instance —
        // loop and wait on that one. If exit was final (no replacement),
        // ref.instance was nulled below and the loop ends.
        if (ref.instance === current) {
          ref.instance = null;
          process.stdout.off("resize", onTerminalResize);
          if (resizeTimer) clearTimeout(resizeTimer);
          return;
        }
      }
    },
    unmount: () => {
      process.stdout.off("resize", onTerminalResize);
      if (resizeTimer) clearTimeout(resizeTimer);
      ref.instance?.unmount();
    },
  };
}
