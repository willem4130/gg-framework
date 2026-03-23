import { useEffect, useMemo, useRef } from "react";
import { useStdout } from "ink";
import type { ActivityPhase } from "./useAgentLoop.js";

import { SPINNER_FRAMES, SPINNER_INTERVAL } from "../spinner-frames.js";
import { useAnimationTick, deriveFrame } from "../components/AnimationContext.js";
import { PLANNING_PHRASES, selectPhrases, shuffleArray } from "../activity-phrases.js";

const PHRASE_INTERVAL = 3000;

export interface TerminalTitleOptions {
  phase: ActivityPhase;
  isRunning: boolean;
  userMessage?: string;
  activeToolNames?: string[];
  planMode?: boolean;
}

export function useTerminalTitle({
  phase,
  isRunning,
  userMessage = "",
  activeToolNames = [],
  planMode = false,
}: TerminalTitleOptions): void {
  const { stdout } = useStdout();

  // Derive spinner frame from global animation tick — no independent timer
  const tick = useAnimationTick();
  const spinnerFrame = isRunning ? deriveFrame(tick, SPINNER_INTERVAL, SPINNER_FRAMES.length) : 0;

  // Phrase rotation — mirrors ActivityIndicator logic
  const toolNamesKey = activeToolNames.sort().join(",");
  const phrases = useMemo(
    () =>
      shuffleArray(
        planMode && phase === "waiting"
          ? PLANNING_PHRASES
          : selectPhrases(phase, userMessage, activeToolNames),
      ),
    [phase, userMessage, toolNamesKey, planMode],
  );
  const phraseIndex = Math.floor(deriveFrame(tick, PHRASE_INTERVAL, phrases.length * 1000) / 1000);
  const phrase = phrases[phraseIndex] ?? phrases[0];

  // Track previous title to avoid redundant writes
  const prevTitleRef = useRef("");

  // Write terminal title
  useEffect(() => {
    if (!stdout) return;
    const title = isRunning ? `${SPINNER_FRAMES[spinnerFrame]} ${phrase}...` : "GG Coder";
    if (title !== prevTitleRef.current) {
      prevTitleRef.current = title;
      stdout.write(`\x1b]0;${title}\x1b\\`);
    }
  }, [stdout, phrase, isRunning, spinnerFrame]);

  // Reset title on unmount
  useEffect(() => {
    return () => {
      stdout?.write(`\x1b]0;GG Coder\x1b\\`);
    };
  }, [stdout]);
}
