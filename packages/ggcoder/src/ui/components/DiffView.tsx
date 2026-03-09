import React from "react";
import { Text, Box } from "ink";
import { useTheme } from "../theme/theme.js";

const MAX_DISPLAY_LINES = 20;

export function DiffView({ diff }: { diff: string }) {
  const theme = useTheme();
  const lines = diff.split("\n");
  const truncated = lines.length > MAX_DISPLAY_LINES;
  const displayLines = truncated ? lines.slice(0, MAX_DISPLAY_LINES) : lines;

  return (
    <Box flexDirection="column" marginLeft={2}>
      {displayLines.map((line, i) => {
        let color = theme.diffContext;
        if (line.startsWith("+")) color = theme.diffAdded;
        else if (line.startsWith("-")) color = theme.diffRemoved;

        return (
          <Text key={i} color={color}>
            {line}
          </Text>
        );
      })}
      {truncated && (
        <Text color={theme.textDim}>... ({lines.length - MAX_DISPLAY_LINES} more lines)</Text>
      )}
    </Box>
  );
}
