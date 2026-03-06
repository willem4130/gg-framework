import React, { useState, useEffect } from "react";
import { Text, Box } from "ink";
import { useTheme } from "../theme/theme.js";
import { Markdown } from "./Markdown.js";

interface StreamingAreaProps {
  isRunning: boolean;
  streamingText: string;
  streamingThinking: string;
  showThinking?: boolean;
}

export function StreamingArea({
  isRunning,
  streamingText,
  streamingThinking,
  showThinking = true,
}: StreamingAreaProps) {
  const theme = useTheme();

  // Blinking cursor for streaming text
  const [cursorVisible, setCursorVisible] = useState(true);
  useEffect(() => {
    if (!isRunning) return;
    setCursorVisible(true);
    const timer = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 530);
    return () => clearInterval(timer);
  }, [isRunning]);

  if (!isRunning && !streamingText) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      {showThinking && streamingThinking && (
        <Box marginBottom={1}>
          <Text color={theme.textDim} italic>
            {streamingThinking}
          </Text>
        </Box>
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
