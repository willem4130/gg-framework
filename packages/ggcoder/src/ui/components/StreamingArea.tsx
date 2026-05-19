import React, { memo, useMemo } from "react";
import { Text, Box } from "ink";
import { useTheme } from "../theme/theme.js";
import { StreamingMarkdown } from "./Markdown.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { stripDoneMarkers } from "../../utils/plan-steps.js";
import { BLACK_CIRCLE } from "../constants/figures.js";

// BLACK_CIRCLE + " " = 2 chars
const PREFIX_WIDTH = 2;

interface StreamingAreaProps {
  isRunning: boolean;
  streamingText: string;
  streamingThinking: string;
  showThinking?: boolean;
  thinkingMs?: number;
  planMode?: boolean;
}

export const StreamingArea = memo(function StreamingArea({
  isRunning,
  streamingText,
  streamingThinking,
  showThinking = false,
  thinkingMs,
  planMode,
}: StreamingAreaProps) {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const contentWidth = Math.max(10, columns - PREFIX_WIDTH);
  const displayText = useMemo(
    () => (streamingText ? stripDoneMarkers(streamingText) : ""),
    [streamingText],
  );

  // Return null when there is nothing to display.  Previously this kept an
  // empty <Box marginTop={1}> alive while isRunning was true, adding phantom
  // height to Ink's live area.  When isRunning later flipped to false in a
  // separate render batch, the live area shrank and Ink's cursor math
  // miscalculated the rewrite offset — clipping the bottom of the content.
  // Trim because a streaming turn whose entire content is "[DONE:N]" gets
  // reduced to a single space by stripDoneMarkers — don't render a lone "⏺".
  const trimmedDisplay = displayText.trim();
  const hasThinking = showThinking && !!streamingThinking;
  if (!trimmedDisplay && !hasThinking) return null;
  if (!isRunning && !trimmedDisplay) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      {hasThinking && <ThinkingBlock text={streamingThinking} streaming durationMs={thinkingMs} />}

      {trimmedDisplay && (
        <Box flexDirection="row">
          <Box width={PREFIX_WIDTH} flexShrink={0}>
            <Text color={planMode ? theme.planPrimary : theme.primary}>{BLACK_CIRCLE + " "}</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1} width={contentWidth}>
            {/* Stable/unstable split: only re-parses the tail block. */}
            <StreamingMarkdown width={contentWidth}>{trimmedDisplay}</StreamingMarkdown>
          </Box>
        </Box>
      )}
    </Box>
  );
});
