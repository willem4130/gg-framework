import React from "react";
import { Text, Box } from "ink";
import { useTheme } from "../theme/theme.js";

export function UserMessage({ text, imageCount }: { text: string; imageCount?: number }) {
  const theme = useTheme();

  return (
    <Box marginTop={1} flexDirection="column">
      <Text wrap="wrap">
        <Text color={theme.inputPrompt}>{"❯ "}</Text>
        <Text color={theme.textMuted}>{text}</Text>
        {imageCount != null &&
          imageCount > 0 &&
          Array.from({ length: imageCount }, (_, i) => (
            <Text key={i} color={theme.accent}>
              {" "}
              [Image #{i + 1}]
            </Text>
          ))}
      </Text>
    </Box>
  );
}
