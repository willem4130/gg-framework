import React from "react";
import { Box, Text } from "ink";
import {
  AssistantMessage,
  CompactionDone,
  CompactionSpinner,
  MessageResponse,
  StreamingArea,
  ToolExecution,
  ToolUseLoader,
  UserMessage,
} from "@kenkaiiii/ggcoder/ui";
import { TranscriptItemFrame } from "@kenkaiiii/ggcoder/ui/transcript/frame";
import {
  getTranscriptItemMarginTop,
  shouldTopSpaceStreamingAssistant,
} from "@kenkaiiii/ggcoder/ui/transcript/spacing";
import { useTerminalSize } from "@kenkaiiii/ggcoder/ui/hooks/terminal-size";
import { useTheme } from "@kenkaiiii/ggcoder/ui/theme";
import { BossBanner } from "./banner.js";
import type {
  AssistantItem,
  HistoryItem,
  StreamingTurn,
  WorkerEventItem,
  WorkerErrorItem,
} from "./boss-store.js";
import type { BossToolDoneItem } from "./boss-ui-items.js";
import { bossToolFormatters } from "./tool-formatters.js";
import { projectColor } from "./colors.js";
import { COLORS } from "./branding.js";

interface BannerRow {
  kind: "banner";
  id: string;
}

export type BossTranscriptRowItem = BannerRow | HistoryItem;
export type BossDisplayTranscriptRowItem = HistoryItem;

const BOSS_TRANSCRIPT_SPACING_KINDS = new Set<string>([
  "user",
  "assistant",
  "tool_start",
  "tool_done",
  "worker_event",
  "worker_error",
  "task_dispatch",
  "info",
  "update_notice",
  "compacting",
  "compacted",
  "stopped",
]);

function getBossTranscriptMarginTop({
  row,
  previousRow,
}: {
  row: BossTranscriptRowItem;
  previousRow?: BossTranscriptRowItem;
}): number {
  if (row.kind === "banner" || previousRow?.kind === "banner") return 0;
  if (!BOSS_TRANSCRIPT_SPACING_KINDS.has(row.kind)) return 0;
  return getTranscriptItemMarginTop({
    item: row,
    previousLiveItem: previousRow,
  });
}

export function BossTranscriptRow({
  row,
  previousRow,
}: {
  row: BossTranscriptRowItem;
  previousRow?: BossTranscriptRowItem;
}): React.ReactElement | null {
  if (row.kind === "banner") {
    return (
      <Box paddingX={1}>
        <BossBanner subtitle="Orchestrator" showShortcuts />
      </Box>
    );
  }
  const marginTop = getBossTranscriptMarginTop({ row, previousRow });
  const renderWithSpacing = (node: React.ReactElement): React.ReactElement => (
    <TranscriptItemFrame marginTop={marginTop}>{node}</TranscriptItemFrame>
  );

  if (row.kind === "user") return renderWithSpacing(<UserMessage text={row.text} />);
  if (row.kind === "assistant") return renderWithSpacing(<AssistantRow item={row} />);
  if (row.kind === "tool_start") return renderWithSpacing(<ToolStartHistoryRow item={row} />);
  if (row.kind === "tool_done") return renderWithSpacing(<ToolHistoryRow item={row} />);
  if (row.kind === "worker_event") return renderWithSpacing(<WorkerEventRow item={row} />);
  if (row.kind === "worker_error") return renderWithSpacing(<WorkerErrorRow item={row} />);
  if (row.kind === "info") {
    return renderWithSpacing(<InfoRow text={row.text} level={row.level ?? "info"} />);
  }
  if (row.kind === "task_dispatch") return renderWithSpacing(<TaskDispatchRow tasks={row.tasks} />);
  if (row.kind === "update_notice") return renderWithSpacing(<UpdateNoticeRow text={row.text} />);
  if (row.kind === "compacting") return renderWithSpacing(<CompactionSpinner staticDisplay />);
  if (row.kind === "compacted") {
    return renderWithSpacing(
      <CompactionDone
        originalCount={row.originalCount}
        newCount={row.newCount}
        tokensBefore={row.tokensBefore}
        tokensAfter={row.tokensAfter}
      />,
    );
  }
  if (row.kind === "stopped") return renderWithSpacing(<InfoRow text={row.text} level="warning" />);
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
    <Box flexShrink={1} borderStyle="round" borderColor={COLORS.accent} paddingX={1}>
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
    <Box flexDirection="column" paddingX={1}>
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

export function highlightShortcuts(text: string): string {
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
  return <AssistantMessage text={highlightShortcuts(item.text)} renderMarkdown />;
}

function ToolStartHistoryRow({
  item,
}: {
  item: Extract<HistoryItem, { kind: "tool_start" }>;
}): React.ReactElement {
  return (
    <ToolExecution
      status="running"
      name={item.name}
      args={item.args}
      formatters={bossToolFormatters}
    />
  );
}

function ToolHistoryRow({ item }: { item: BossToolDoneItem }): React.ReactElement {
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

type WorkerStatusGrade = "DONE" | "UNVERIFIED" | "PARTIAL" | "BLOCKED" | "INFO";

/**
 * Pull the `Status:` line out of a worker's final text (the brief in
 * tools.ts asks every worker to end with one of: DONE | UNVERIFIED |
 * PARTIAL | BLOCKED | INFO). Returns null if the line is missing or invalid.
 */
export function parseStatusGrade(text: string): WorkerStatusGrade | null {
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
export function parseWorkerTrailer(text: string): WorkerTrailer {
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
export function summarizeFinalText(text: string, maxLen: number): string {
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
    <Box flexDirection="column">
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
    <Box flexDirection="column">
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
    <Box flexDirection="row">
      <ToolUseLoader status={level === "error" ? "error" : "queued"} />
      <Box flexGrow={1}>
        <Text color={color} wrap="wrap">
          {text}
        </Text>
      </Box>
    </Box>
  );
}

export function BossStreamingTurnView({
  turn,
  isRunning,
  liveItems = [],
  lastHistoryItem,
}: {
  turn: StreamingTurn;
  isRunning: boolean;
  liveItems?: HistoryItem[];
  lastHistoryItem?: HistoryItem;
}): React.ReactElement {
  const visibleLiveItems = liveItems.filter(
    (item) =>
      item.kind === "tool_start" ||
      item.kind === "tool_done" ||
      item.kind === "compacting" ||
      item.kind === "compacted",
  );
  const lastLiveItem = visibleLiveItems[visibleLiveItems.length - 1];
  const assistantMarginTop = shouldTopSpaceStreamingAssistant({
    visibleStreamingText: turn.text,
    lastLiveItem,
    lastHistoryItem,
  })
    ? 1
    : 0;

  return (
    <Box flexDirection="column">
      {visibleLiveItems.map((item, index, items) => (
        <BossTranscriptRow
          key={item.id}
          row={item}
          previousRow={index > 0 ? items[index - 1] : lastHistoryItem}
        />
      ))}
      <StreamingArea
        isRunning={isRunning}
        streamingText={turn.text}
        streamingThinking=""
        thinkingMs={turn.thinkingMs}
        renderMarkdown
        assistantMarginTop={assistantMarginTop}
      />
    </Box>
  );
}
