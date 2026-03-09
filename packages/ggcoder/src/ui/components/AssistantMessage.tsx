import React from "react";
import { Text, Box } from "ink";
import { useTheme } from "../theme/theme.js";
import { Markdown } from "./Markdown.js";
import { ThinkingBlock } from "./ThinkingBlock.js";

interface AssistantMessageProps {
  text: string;
  thinking?: string;
  thinkingMs?: number;
  showThinking?: boolean;
}

export function AssistantMessage({
  text,
  thinking,
  thinkingMs,
  showThinking = true,
}: AssistantMessageProps) {
  const theme = useTheme();

  return (
    <Box flexDirection="column" marginTop={1}>
      {showThinking && thinking && <ThinkingBlock text={thinking} durationMs={thinkingMs} />}
      {text && (
        <Box flexShrink={1}>
          <Text color={theme.primary}>{"⏺ "}</Text>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0}>
            <Markdown>{text.trimStart()}</Markdown>
          </Box>
        </Box>
      )}
    </Box>
  );
}
