import React from "react";
import { Box, Text } from "ink";

export const PLAN_MODE_LOGO = [
  "▗▄▄▖ ▗▖    ▗▄▖ ▗▖  ▗▖    ▗▖  ▗▖ ▗▄▖ ▗▄▄▄ ▗▄▄▄▖",
  "▐▌ ▐▌▐▌   ▐▌ ▐▌▐▛▚▖▐▌    ▐▛▚▞▜▌▐▌ ▐▌▐▌  █▐▌",
  "▐▛▀▘ ▐▌   ▐▛▀▜▌▐▌ ▝▜▌    ▐▌  ▐▌▐▌ ▐▌▐▌  █▐▛▀▀▘",
  "▐▌   ▐▙▄▄▖▐▌ ▐▌▐▌  ▐▌    ▐▌  ▐▌▝▚▄▞▘▐▙▄▄▀▐▙▄▄▖",
];

const AMBER_GRADIENT = [
  "#f59e0b",
  "#fbbf24",
  "#f59e0b",
  "#d97706",
  "#f59e0b",
  "#fbbf24",
  "#d97706",
];

function PlanGradientText({ text }: { text: string }) {
  const spans: React.ReactNode[] = [];
  let colorIdx = 0;
  let currentColor = "";
  let currentChars = "";

  const flush = () => {
    if (!currentChars) return;
    spans.push(
      <Text key={spans.length} color={currentColor}>
        {currentChars}
      </Text>,
    );
    currentChars = "";
  };

  for (const ch of text) {
    if (ch === " ") {
      currentChars += ch;
      continue;
    }
    const color = AMBER_GRADIENT[colorIdx % AMBER_GRADIENT.length];
    if (color !== currentColor) {
      flush();
      currentColor = color;
    }
    currentChars += ch;
    colorIdx++;
  }
  flush();

  return <Text>{spans}</Text>;
}

export function PlanModeLogo() {
  return (
    <Box flexDirection="column" paddingLeft={1}>
      {PLAN_MODE_LOGO.map((line) => (
        <PlanGradientText key={line} text={line} />
      ))}
    </Box>
  );
}
