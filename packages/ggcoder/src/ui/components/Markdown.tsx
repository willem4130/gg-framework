import React, { useMemo } from "react";
import { Text, Box, useStdout } from "ink";
import {
  renderInlineMarkdownToAnsi,
  renderMarkdownToAnsiLines,
  wrapAnsiMarkdownLine,
} from "../utils/markdown-renderer.js";
import { useTheme } from "../theme/theme.js";

interface MarkdownProps {
  children: string;
  width?: number;
  compact?: boolean;
  renderMarkdown?: boolean;
  isPending?: boolean;
  availableTerminalHeight?: number;
}

function RenderAnsiLines({ lines }: { lines: readonly string[] }): React.ReactElement {
  return (
    <Box flexDirection="column">
      {lines.map((line, index) =>
        line.length === 0 ? (
          <Box key={index} height={1} />
        ) : (
          <Text key={index} wrap="truncate-end">
            {line}
          </Text>
        ),
      )}
    </Box>
  );
}

export const Markdown = React.memo(function Markdown({
  children,
  width: explicitWidth,
  compact = false,
  renderMarkdown = true,
  isPending = false,
  availableTerminalHeight,
}: MarkdownProps) {
  const { stdout } = useStdout();
  const theme = useTheme();
  const terminalWidth = explicitWidth ?? Math.max(40, (stdout?.columns || 80) - 4);
  const text = compact ? children.trim() : children;

  const renderedLines = useMemo(
    () =>
      renderMarkdownToAnsiLines({
        text,
        theme,
        width: terminalWidth,
        isPending,
        availableTerminalHeight,
        renderMarkdown,
      }),
    [availableTerminalHeight, isPending, renderMarkdown, terminalWidth, text, theme],
  );

  if (!text || renderedLines.length === 0) return null;

  return (
    <Box flexDirection="column" width={terminalWidth} flexShrink={1}>
      <RenderAnsiLines lines={renderedLines} />
    </Box>
  );
});

export const StreamingMarkdown = React.memo(function StreamingMarkdown({
  children,
  width,
  compact = false,
}: {
  children: string;
  width: number;
  compact?: boolean;
}) {
  return (
    <Markdown width={width} compact={compact} isPending>
      {children}
    </Markdown>
  );
});

export { renderInlineMarkdownToAnsi, wrapAnsiMarkdownLine };
