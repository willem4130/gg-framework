import React from "react";
import { Box, Text } from "ink";
import { useAnimationActive, useAnimationTick } from "@kenkaiiii/ggcoder/ui";
import { useTerminalSize } from "@kenkaiiii/ggcoder/ui/hooks/terminal-size";
import { useTheme } from "@kenkaiiii/ggcoder/ui/theme";
import type { WorkerView } from "./boss-store.js";
import { projectColor } from "./colors.js";

const SHIMMER_WIDTH = 3;

export function formatWorkerElapsed(ms: number): string {
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

export function BossWorkerStatusRow({
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
    const elapsed = w.workStartedAt ? formatWorkerElapsed(now - w.workStartedAt) : null;
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
