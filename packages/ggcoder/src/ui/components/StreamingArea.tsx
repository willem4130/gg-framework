import React, { useState, useEffect, useRef } from "react";
import { Text, Box } from "ink";
import { useTheme } from "../theme/theme.js";
import { Markdown } from "./Markdown.js";
import { ThinkingBlock } from "./ThinkingBlock.js";

interface StreamingAreaProps {
  isRunning: boolean;
  streamingText: string;
  streamingThinking: string;
  showThinking?: boolean;
  thinkingMs?: number;
}

export function StreamingArea({
  isRunning,
  streamingText,
  streamingThinking,
  showThinking = true,
  thinkingMs,
}: StreamingAreaProps) {
  const theme = useTheme();

  // Blinking cursor — only blink when text is NOT actively changing.
  // While text streams, the reveal animation already provides visual feedback,
  // so we show a static cursor and avoid the extra re-renders from blinking.
  const [cursorVisible, setCursorVisible] = useState(true);
  const prevTextRef = useRef(streamingText);
  const textChangingRef = useRef(false);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track whether text is actively changing
  useEffect(() => {
    if (streamingText !== prevTextRef.current) {
      prevTextRef.current = streamingText;
      textChangingRef.current = true;
      // Clear any existing stale timer
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
      // Mark text as "not changing" if no update for 600ms
      staleTimerRef.current = setTimeout(() => {
        textChangingRef.current = false;
      }, 600);
    }
    return () => {
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    };
  }, [streamingText]);

  useEffect(() => {
    if (!isRunning) return;
    setCursorVisible(true);
    const timer = setInterval(() => {
      // Only blink when text has stopped changing (waiting for LLM)
      if (!textChangingRef.current) {
        setCursorVisible((v) => !v);
      } else {
        setCursorVisible(true);
      }
    }, 800);
    return () => clearInterval(timer);
  }, [isRunning]);

  // Return null when there is nothing to display.  Previously this kept an
  // empty <Box marginTop={1}> alive while isRunning was true, adding phantom
  // height to Ink's live area.  When isRunning later flipped to false in a
  // separate render batch, the live area shrank and Ink's cursor math
  // miscalculated the rewrite offset — clipping the bottom of the content.
  if (!streamingText && !streamingThinking) return null;
  if (!isRunning && !streamingText) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      {showThinking && streamingThinking && (
        <ThinkingBlock text={streamingThinking} streaming durationMs={thinkingMs} />
      )}

      {streamingText && (
        <Box flexShrink={1}>
          <Text color={theme.primary}>{"⏺ "}</Text>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0}>
            <Markdown>
              {streamingText.trimStart() + (isRunning && cursorVisible ? "\u258D" : "")}
            </Markdown>
          </Box>
        </Box>
      )}
    </Box>
  );
}
