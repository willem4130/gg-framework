import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/theme.js";

export interface SlashCommandInfo {
  name: string;
  aliases: string[];
  description: string;
}

interface SlashCommandMenuProps {
  commands: SlashCommandInfo[];
  filter: string;
  selectedIndex: number;
}

export function SlashCommandMenu({ commands, filter, selectedIndex }: SlashCommandMenuProps) {
  const theme = useTheme();

  const filtered = commands.filter((cmd) => {
    if (!filter) return true;
    const lower = filter.toLowerCase();
    return (
      cmd.name.toLowerCase().startsWith(lower) ||
      cmd.aliases.some((a) => a.toLowerCase().startsWith(lower))
    );
  });

  if (filtered.length === 0) return null;

  // Clamp index
  const idx = Math.min(selectedIndex, filtered.length - 1);

  return (
    <Box flexDirection="column" paddingLeft={2} paddingRight={1} marginBottom={0}>
      {filtered.map((cmd, i) => {
        const isSelected = i === idx;
        const aliasStr =
          cmd.aliases.length > 0 ? ` (${cmd.aliases.map((a) => "/" + a).join(", ")})` : "";
        return (
          <Box key={cmd.name}>
            <Text color={isSelected ? theme.commandColor : theme.textDim}>
              {isSelected ? "› " : "  "}
            </Text>
            <Text color={isSelected ? theme.commandColor : theme.text} bold={isSelected}>
              /{cmd.name}
            </Text>
            <Text color={theme.textDim}>{aliasStr}</Text>
            <Text color={theme.textDim}> — {cmd.description}</Text>
          </Box>
        );
      })}
      <Box>
        <Text color={theme.border}> ↑↓ navigate · Enter select · Esc cancel</Text>
      </Box>
    </Box>
  );
}

/** Filter commands by partial name/alias match */
export function filterCommands(commands: SlashCommandInfo[], filter: string): SlashCommandInfo[] {
  if (!filter) return commands;
  const lower = filter.toLowerCase();
  return commands.filter(
    (cmd) =>
      cmd.name.toLowerCase().startsWith(lower) ||
      cmd.aliases.some((a) => a.toLowerCase().startsWith(lower)),
  );
}
