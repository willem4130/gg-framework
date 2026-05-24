import React from "react";
import { Text, Box } from "ink";
import { useTheme } from "../theme/theme.js";
import { Markdown } from "./Markdown.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { BLACK_CIRCLE } from "../constants/figures.js";

interface AssistantMessageProps {
  text: string;
  thinking?: string;
  thinkingMs?: number;
  showThinking?: boolean;
  streaming?: boolean;
  renderMarkdown?: boolean;
  availableTerminalHeight?: number;
  marginTop?: number;
  continuation?: boolean;
}

const RESPONSE_LEFT_PADDING = 1;
const RESPONSE_RIGHT_GUARD = 1;
// BLACK_CIRCLE + " " = 2 chars.
const PREFIX_WIDTH = 2;

export const AssistantMessage = React.memo(function AssistantMessage({
  text,
  thinking,
  thinkingMs,
  showThinking = false,
  streaming = false,
  renderMarkdown = true,
  availableTerminalHeight,
  marginTop = 0,
  continuation = false,
}: AssistantMessageProps) {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const contentWidth = Math.max(
    10,
    columns - RESPONSE_LEFT_PADDING - PREFIX_WIDTH - RESPONSE_RIGHT_GUARD,
  );

  // Trim because stripDoneMarkers leaves a single space when an assistant
  // turn was JUST a [DONE:N] marker — we don't want a lone "⏺" rendered
  // for that. Skip the entire block (incl. the marginTop spacer) when
  // there's nothing visible to show.
  const trimmedText = text.trim();
  const hasThinking = showThinking && !!thinking;
  if (!trimmedText && !hasThinking) return null;

  const constrainedHeight = availableTerminalHeight
    ? Math.max(1, availableTerminalHeight - marginTop)
    : undefined;

  return (
    <Box
      flexDirection="column"
      marginTop={marginTop}
      maxHeight={constrainedHeight}
      overflowY={constrainedHeight ? "hidden" : undefined}
    >
      {hasThinking && (
        <ThinkingBlock text={thinking!} streaming={streaming} durationMs={thinkingMs} />
      )}
      {trimmedText && (
        <Box flexDirection="row" paddingLeft={RESPONSE_LEFT_PADDING} flexShrink={1}>
          <Box width={PREFIX_WIDTH} flexShrink={0}>
            <Text color={theme.primary}>{continuation ? "  " : BLACK_CIRCLE + " "}</Text>
          </Box>
          <Box flexDirection="column" width={contentWidth} flexShrink={1}>
            <Markdown
              width={contentWidth}
              compact
              renderMarkdown={renderMarkdown}
              isPending={streaming}
              availableTerminalHeight={availableTerminalHeight}
            >
              {trimmedText}
            </Markdown>
          </Box>
        </Box>
      )}
    </Box>
  );
});
