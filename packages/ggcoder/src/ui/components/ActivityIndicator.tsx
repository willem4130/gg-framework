import React, { useState, useEffect, useMemo } from "react";
import { Text, Box } from "ink";
import { useTheme } from "../theme/theme.js";
import type { ActivityPhase } from "../hooks/useAgentLoop.js";

import { SPINNER_FRAMES, SPINNER_INTERVAL } from "../spinner-frames.js";
import { PLANNING_PHRASES, selectPhrases, shuffleArray } from "../activity-phrases.js";

// ── Color pulse cycle ─────────────────────────────────────

const PULSE_COLORS = [
  "#60a5fa", // blue
  "#818cf8", // indigo
  "#a78bfa", // violet
  "#818cf8", // indigo (back)
  "#60a5fa", // blue (back)
  "#38bdf8", // sky
  "#60a5fa", // blue (back)
];

const PLAN_PULSE_COLORS = [
  "#f59e0b", // amber
  "#fbbf24", // amber light
  "#f59e0b", // amber
  "#d97706", // amber dark
  "#f59e0b", // amber
  "#fbbf24", // amber light
  "#d97706", // amber dark
];
const PULSE_INTERVAL = 400;

// ── Ellipsis animation ────────────────────────────────────

const ELLIPSIS_FRAMES = ["", ".", "..", "..."];
const ELLIPSIS_INTERVAL = 500;

// ── Phrase rotation ───────────────────────────────────────

const WAITING_PHRASE_INTERVAL = 3000;
const OTHER_PHRASE_INTERVAL = 4000;

// ── Formatting helpers ────────────────────────────────────

function formatElapsed(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

function formatTokenCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return String(n);
}

function buildMetaSuffix(
  elapsedMs: number,
  thinkingMs: number,
  isThinking: boolean,
  tokenEstimate: number,
): string {
  const parts: string[] = [];
  parts.push(formatElapsed(elapsedMs));

  if (tokenEstimate > 0) parts.push(`↓ ${formatTokenCount(tokenEstimate)} tokens`);

  if (isThinking) {
    // Live label — always show while thinking, add duration once >= 1s
    parts.push(thinkingMs >= 1000 ? `thinking for ${formatElapsed(thinkingMs)}` : "thinking");
  } else if (thinkingMs >= 1000) {
    // Frozen — past tense with duration
    parts.push(`thought for ${formatElapsed(thinkingMs)}`);
  }

  return parts.join(" · ");
}

// ── Shimmer effect ────────────────────────────────────────

const SHIMMER_WIDTH = 3;
const SHIMMER_INTERVAL = 100;

const ShimmerText: React.FC<{ text: string; color: string; shimmerPos: number }> = ({
  text,
  color,
  shimmerPos,
}) => (
  <Text>
    {text.split("").map((char, i) => {
      const isBright = Math.abs(i - shimmerPos) <= SHIMMER_WIDTH;
      return (
        <Text bold={isBright} color={color} dimColor={!isBright} key={i}>
          {char}
        </Text>
      );
    })}
  </Text>
);

// ── Component ─────────────────────────────────────────────

interface ActivityIndicatorProps {
  phase: ActivityPhase;
  elapsedMs: number;
  thinkingMs: number;
  isThinking: boolean;
  tokenEstimate: number;
  userMessage?: string;
  activeToolNames?: string[];
  planMode?: boolean;
}

export function ActivityIndicator({
  phase,
  elapsedMs,
  thinkingMs,
  isThinking,
  tokenEstimate,
  userMessage = "",
  activeToolNames = [],
  planMode,
}: ActivityIndicatorProps) {
  const theme = useTheme();

  // ── Single animation tick ────────────────────────────────
  // Instead of 5 separate setIntervals (spinner, pulse, ellipsis, shimmer,
  // phrase), we use ONE timer at the fastest cadence (SHIMMER_INTERVAL=100ms)
  // and derive all animation frames via modular arithmetic.  This reduces
  // Ink re-renders from ~5 independent state updates to 1 batched update
  // per tick, which prevents live-area height miscalculations that cause
  // viewport jumping.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, SHIMMER_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  // Derive all animation frames from the single tick counter
  const spinnerFrame =
    Math.floor((tick * SHIMMER_INTERVAL) / SPINNER_INTERVAL) % SPINNER_FRAMES.length;
  const pulseColors = planMode ? PLAN_PULSE_COLORS : PULSE_COLORS;
  const colorFrame = Math.floor((tick * SHIMMER_INTERVAL) / PULSE_INTERVAL) % pulseColors.length;
  const ellipsisFrame =
    Math.floor((tick * SHIMMER_INTERVAL) / ELLIPSIS_INTERVAL) % ELLIPSIS_FRAMES.length;

  // Phrase rotation — pick phrases based on phase + user message + active tools, shuffle, rotate
  const toolNamesKey = activeToolNames.sort().join(",");
  const phrases = useMemo(
    () =>
      shuffleArray(
        planMode && phase === "waiting"
          ? PLANNING_PHRASES
          : selectPhrases(phase, userMessage, activeToolNames),
      ),
    [phase, userMessage, toolNamesKey, planMode], // activeToolNames captured via stable string key
  );
  const phraseInterval = phase === "waiting" ? WAITING_PHRASE_INTERVAL : OTHER_PHRASE_INTERVAL;
  const phraseIndex = Math.floor((tick * SHIMMER_INTERVAL) / phraseInterval) % phrases.length;

  const spinnerColor = pulseColors[colorFrame];
  const phrase = phrases[phraseIndex] ?? phrases[0];
  const ellipsis = ELLIPSIS_FRAMES[ellipsisFrame];

  // Shimmer — derive position from tick, wrapping across phrase length
  const shimmerCycle = phrase.length + SHIMMER_WIDTH * 2;
  const shimmerPos = (tick % shimmerCycle) - SHIMMER_WIDTH;

  // Pad ellipsis to prevent text from shifting
  const paddedEllipsis = ellipsis + " ".repeat(3 - ellipsis.length);

  const meta = buildMetaSuffix(elapsedMs, thinkingMs, isThinking, tokenEstimate);

  return (
    <Box>
      <Text color={spinnerColor} bold>
        {SPINNER_FRAMES[spinnerFrame]}{" "}
      </Text>
      <ShimmerText text={phrase} color={spinnerColor} shimmerPos={shimmerPos} />
      <Text color={theme.textDim}>{paddedEllipsis}</Text>
      {meta && (
        <Text color={theme.textDim}>
          {"  ("}
          {meta}
          {")"}
        </Text>
      )}
    </Box>
  );
}
