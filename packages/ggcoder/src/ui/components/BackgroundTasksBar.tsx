import React from "react";
import { Text, Box, useInput } from "ink";
import { useTheme } from "../theme/theme.js";
import type { BackgroundProcess } from "../../core/process-manager.js";

const MAX_VISIBLE = 5;

interface BackgroundTasksBarProps {
  tasks: BackgroundProcess[];
  focused: boolean;
  expanded: boolean;
  selectedIndex: number;
  onExpand: () => void;
  onCollapse: () => void;
  onKill: (id: string) => void;
  onExit: () => void;
  onNavigate: (index: number) => void;
}

function truncateCommand(command: string, maxLen: number): string {
  if (command.length <= maxLen) return command;
  return command.slice(0, maxLen - 1) + "\u2026";
}

export function BackgroundTasksBar({
  tasks,
  focused,
  expanded,
  selectedIndex,
  onExpand,
  onCollapse,
  onKill,
  onExit,
  onNavigate,
}: BackgroundTasksBarProps) {
  const theme = useTheme();

  // Keyboard: collapsed+focused — Enter opens, Esc/↑ exits
  useInput(
    (_input, key) => {
      if (!expanded) {
        if (key.return) {
          onExpand();
        } else if (key.escape || key.upArrow) {
          onExit();
        }
        return;
      }

      // Expanded mode
      if (key.escape) {
        onCollapse();
        return;
      }

      if (key.upArrow) {
        if (selectedIndex <= 0) {
          onCollapse();
        } else {
          onNavigate(selectedIndex - 1);
        }
        return;
      }

      if (key.downArrow) {
        const maxIdx = Math.min(tasks.length, MAX_VISIBLE) - 1;
        if (selectedIndex < maxIdx) {
          onNavigate(selectedIndex + 1);
        }
        return;
      }

      if (_input === "k" || _input === "K") {
        const task = tasks[selectedIndex];
        if (task) {
          onKill(task.id);
        }
      }
    },
    { isActive: focused },
  );

  if (tasks.length === 0) return null;

  const count = tasks.length;
  const label = `Background task${count !== 1 ? "s" : ""}`;

  // Collapsed: single summary line
  if (!expanded) {
    return (
      <Box paddingLeft={1} paddingRight={1}>
        <Text color={focused ? theme.primary : theme.textMuted}>{"\u27D0 "}</Text>
        <Text color={theme.accent} bold>
          ({count})
        </Text>
        <Text color={focused ? theme.text : theme.textMuted}> {label}</Text>
        {focused && (
          <Text color={theme.textDim}>
            {" \u00B7 "}
            <Text color={theme.accent}>Enter</Text> to view
          </Text>
        )}
      </Box>
    );
  }

  // Expanded: show up to MAX_VISIBLE tasks
  const visible = tasks.slice(0, MAX_VISIBLE);
  const hidden = count - visible.length;

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <Box>
        <Text color={theme.textMuted}>{"\u27D0 "}</Text>
        <Text color={theme.accent} bold>
          ({count})
        </Text>
        <Text color={theme.text}> {label}</Text>
      </Box>
      {visible.map((task, i) => {
        const isSelected = i === selectedIndex;
        const prefix = isSelected ? "\u276F " : "  ";
        const cmd = truncateCommand(task.command, 50);
        const isRunning = task.exitCode === null;
        const dot = isRunning ? "\u25CF" : "\u25CB";
        const statusColor = isRunning ? theme.success : theme.error;
        const statusLabel = isRunning ? "running" : `exit ${task.exitCode}`;

        return (
          <Box key={task.id}>
            <Text color={isSelected ? theme.primary : theme.textDim} bold={isSelected}>
              {prefix}
            </Text>
            <Text color={isSelected ? theme.accent : theme.textMuted}>{task.id}</Text>
            <Text>{"  "}</Text>
            <Box flexGrow={1}>
              <Text color={isSelected ? theme.text : theme.textMuted} bold={isSelected}>
                {cmd}
              </Text>
            </Box>
            <Text color={statusColor} bold>
              {dot} {statusLabel}
            </Text>
          </Box>
        );
      })}
      {hidden > 0 && (
        <Box>
          <Text color={theme.textMuted}>
            {"  "}+{hidden} more
          </Text>
        </Box>
      )}
      <Box>
        <Text color={theme.textDim}>
          {"  \u2191\u2193 navigate \u00B7 "}
          <Text color={theme.accent}>K</Text>
          {" kill \u00B7 "}
          <Text color={theme.accent}>Esc</Text>
          {" back"}
        </Text>
      </Box>
    </Box>
  );
}
