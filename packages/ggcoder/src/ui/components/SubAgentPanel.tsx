import React, { useState, useEffect } from "react";
import { Text, Box } from "ink";
import { useTheme } from "../theme/theme.js";

export interface SubAgentInfo {
  toolCallId: string;
  task: string;
  agentName: string;
  status: "running" | "done" | "error" | "aborted";
  toolUseCount: number;
  tokenUsage: { input: number; output: number };
  currentActivity?: string;
  result?: string;
  durationMs?: number;
}

interface SubAgentPanelProps {
  agents: SubAgentInfo[];
  expanded?: boolean;
  aborted?: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

import { SPINNER_FRAMES, SPINNER_INTERVAL } from "../spinner-frames.js";

// ── Agent row with animation ────────────────────────────────

function AgentRow({
  agent,
  isLast,
  isActive,
  aborted,
  expanded,
}: {
  agent: SubAgentInfo;
  isLast: boolean;
  isActive: boolean;
  aborted: boolean;
  expanded: boolean;
}) {
  const theme = useTheme();
  const isRunning = agent.status === "running" && !aborted;

  // Spinner for running agents
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL);
    return () => clearInterval(timer);
  }, [isRunning]);

  // Connector pulse for running agents (alternate thin/thick)
  const [connectorBold, setConnectorBold] = useState(false);
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      setConnectorBold((b) => !b);
    }, 600);
    return () => clearInterval(timer);
  }, [isRunning]);

  const connector = isLast ? "\u2514\u2500" : "\u251C\u2500";
  const subConnector = isLast ? "   " : isRunning && connectorBold ? "\u2503  " : "\u2502  ";

  const totalTokens = agent.tokenUsage.input + agent.tokenUsage.output;

  const statusColor =
    agent.status === "done"
      ? theme.success
      : agent.status === "error" || agent.status === "aborted"
        ? theme.error
        : undefined;

  const taskDisplay = agent.task.length > 50 ? agent.task.slice(0, 47) + "\u2026" : agent.task;

  return (
    <Box flexDirection="column">
      {/* Agent summary line */}
      <Box>
        <Text color={theme.textDim}>{connector} </Text>
        {isRunning ? (
          <Text color={theme.primary} bold>
            {SPINNER_FRAMES[spinnerFrame]}{" "}
          </Text>
        ) : agent.status === "done" ? (
          <Text color={theme.success}>{"\u2713 "}</Text>
        ) : (
          <Text color={theme.error}>{"\u2717 "}</Text>
        )}
        <Text bold={isRunning} color={statusColor}>
          {taskDisplay}
        </Text>
        <Text color={theme.textDim}>
          {" \u00B7 "}
          {agent.toolUseCount} tool use{agent.toolUseCount !== 1 ? "s" : ""}
          {" \u00B7 "}
          {formatTokens(totalTokens)} tokens
          {agent.durationMs != null ? ` \u00B7 ${formatDuration(agent.durationMs)}` : ""}
        </Text>
      </Box>

      {/* Current activity (only when actively running) */}
      {isActive && isRunning && agent.currentActivity && (
        <Box>
          <Text color={theme.textDim}>
            {subConnector}\u23BF {agent.currentActivity}
          </Text>
        </Box>
      )}

      {/* Result preview (when expanded and done) */}
      {expanded && agent.status !== "running" && agent.result && (
        <Box>
          <Text color={theme.textDim}>
            {subConnector}\u23BF {agent.result.split("\n")[0]?.slice(0, 80)}
            {(agent.result.split("\n").length > 1 || agent.result.length > 80) && "\u2026"}
          </Text>
        </Box>
      )}
    </Box>
  );
}

// ── Panel ───────────────────────────────────────────────────

export function SubAgentPanel({ agents, expanded = false, aborted = false }: SubAgentPanelProps) {
  const theme = useTheme();

  if (agents.length === 0) return null;

  const runningCount = agents.filter((a) => a.status === "running").length;
  const allDone = runningCount === 0;
  const isActive = !allDone && !aborted;

  // Header text
  const headerText = aborted
    ? `${agents.length} agent${agents.length !== 1 ? "s" : ""} interrupted`
    : allDone
      ? `${agents.length} agent${agents.length !== 1 ? "s" : ""} completed`
      : `Running ${runningCount} agent${runningCount !== 1 ? "s" : ""}\u2026`;

  return (
    <Box marginTop={1}>
      <Text color={theme.primary}>{"\u23FA "}</Text>
      <Box flexDirection="column" flexShrink={1}>
        {/* Header */}
        <Text bold>{headerText}</Text>

        {/* Agent list */}
        {agents.map((agent, i) => (
          <AgentRow
            key={agent.toolCallId}
            agent={agent}
            isLast={i === agents.length - 1}
            isActive={isActive}
            aborted={aborted}
            expanded={expanded}
          />
        ))}
      </Box>
    </Box>
  );
}
