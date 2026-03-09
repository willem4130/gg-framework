import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/theme.js";

interface OverlayProps {
  title: string;
  children: React.ReactNode;
}

export function Overlay({ title, children }: OverlayProps) {
  const theme = useTheme();

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1}>
      <Box marginBottom={1}>
        <Text color={theme.primary} bold>
          {title}
        </Text>
      </Box>
      {children}
    </Box>
  );
}
