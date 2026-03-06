import React, { useState, useRef, useCallback, useEffect } from "react";
import { Box, Text, Static, useStdout } from "ink";
import crypto from "node:crypto";
import type { Message, Provider, ServerToolDefinition, ThinkingLevel } from "@kenkaiiii/gg-ai";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import { useAgentLoop, type ActivityPhase } from "./hooks/useAgentLoop.js";
import { UserMessage } from "./components/UserMessage.js";
import { AssistantMessage } from "./components/AssistantMessage.js";
import { ToolExecution } from "./components/ToolExecution.js";
import { ServerToolExecution } from "./components/ServerToolExecution.js";
import { SubAgentPanel, type SubAgentInfo } from "./components/SubAgentPanel.js";
import type { SubAgentUpdate, SubAgentDetails } from "../tools/subagent.js";
import { StreamingArea } from "./components/StreamingArea.js";
import { ActivityIndicator } from "./components/ActivityIndicator.js";
import { InputArea } from "./components/InputArea.js";
import { Footer } from "./components/Footer.js";
import { Banner } from "./components/Banner.js";
import { ModelSelector } from "./components/ModelSelector.js";
import { BackgroundTasksBar } from "./components/BackgroundTasksBar.js";
import type { ProcessManager, BackgroundProcess } from "../core/process-manager.js";
import { useTheme } from "./theme/theme.js";
import { useTerminalTitle } from "./hooks/useTerminalTitle.js";
import { getGitBranch } from "../utils/git.js";
import { getModel } from "../core/model-registry.js";
import { SessionManager, type MessageEntry } from "../core/session-manager.js";
import { log } from "../core/logger.js";
import { SettingsManager } from "../core/settings-manager.js";

// ── Completed Item Types ───────────────────────────────────

interface UserItem {
  kind: "user";
  text: string;
  id: string;
}

interface AssistantItem {
  kind: "assistant";
  text: string;
  thinking?: string;
  id: string;
}

interface ToolStartItem {
  kind: "tool_start";
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  id: string;
}

interface ToolDoneItem {
  kind: "tool_done";
  name: string;
  args: Record<string, unknown>;
  result: string;
  isError: boolean;
  durationMs: number;
  id: string;
}

interface ErrorItem {
  kind: "error";
  message: string;
  id: string;
}

interface InfoItem {
  kind: "info";
  text: string;
  id: string;
}

interface DurationItem {
  kind: "duration";
  durationMs: number;
  toolsUsed: string[];
  verb: string;
  id: string;
}

interface BannerItem {
  kind: "banner";
  id: string;
}

interface SubAgentGroupItem {
  kind: "subagent_group";
  agents: SubAgentInfo[];
  aborted?: boolean;
  id: string;
}

interface ServerToolStartItem {
  kind: "server_tool_start";
  serverToolCallId: string;
  name: string;
  input: unknown;
  id: string;
}

interface ServerToolDoneItem {
  kind: "server_tool_done";
  name: string;
  input: unknown;
  resultType: string;
  data: unknown;
  id: string;
}

export type CompletedItem =
  | UserItem
  | AssistantItem
  | ToolStartItem
  | ToolDoneItem
  | ServerToolStartItem
  | ServerToolDoneItem
  | ErrorItem
  | InfoItem
  | DurationItem
  | BannerItem
  | SubAgentGroupItem;

// ── Duration summary ─────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

function pickDurationVerb(toolsUsed: string[]): string {
  const has = (name: string) => toolsUsed.includes(name);

  // Tool-specific phrases (most specific first)
  if (has("subagent")) return "Delegated work for";
  if (has("edit") && has("write")) return "Crafted code for";
  if (has("edit")) return "Refactored for";
  if (has("write")) return "Wrote code for";
  if (has("bash") && has("grep")) return "Hacked away for";
  if (has("bash")) return "Executed commands for";
  if (has("grep") && has("read")) return "Investigated for";
  if (has("grep")) return "Searched for";
  if (has("read") && has("find")) return "Explored for";
  if (has("read")) return "Studied the code for";
  if (has("find") || has("ls")) return "Browsed files for";

  // No tools used — pure text response
  const phrases = [
    "Pondered for",
    "Thought for",
    "Reasoned for",
    "Mulled it over for",
    "Noodled on it for",
    "Brewed up a response in",
    "Cooked up an answer in",
    "Worked out a reply in",
    "Channeled wisdom for",
    "Conjured a response in",
  ];
  return phrases[Math.floor(Math.random() * phrases.length)];
}

// ── Animated thinking border ────────────────────────────────

const THINKING_BORDER_COLORS = ["#60a5fa", "#818cf8", "#a78bfa", "#818cf8", "#60a5fa"];

// ── App Props ──────────────────────────────────────────────

export interface AppProps {
  provider: Provider;
  model: string;
  tools: AgentTool[];
  serverTools?: ServerToolDefinition[];
  messages: Message[];
  maxTokens: number;
  thinking?: ThinkingLevel;
  apiKey?: string;
  baseUrl?: string;
  accountId?: string;
  cwd: string;
  version: string;
  showThinking?: boolean;
  showTokenUsage?: boolean;
  onSlashCommand?: (input: string) => Promise<string | null>;
  loggedInProviders?: Provider[];
  credentialsByProvider?: Record<string, { accessToken: string; accountId?: string }>;
  initialHistory?: CompletedItem[];
  sessionsDir?: string;
  sessionPath?: string;
  processManager?: ProcessManager;
  settingsFile?: string;
}

// ── App Component ──────────────────────────────────────────

export function App(props: AppProps) {
  const theme = useTheme();

  // Terminal title — updated later after agentLoop is created
  // (hoisted here so the hook is always called in the same order)
  const [titlePhase, setTitlePhase] = useState<ActivityPhase>("idle");
  const [titleRunning, setTitleRunning] = useState(false);
  useTerminalTitle(titlePhase, titleRunning);

  // Items scrolled into Static (history)
  const [history, setHistory] = useState<CompletedItem[]>([]);
  // Items from the current/last turn — rendered in the live area so they stay visible
  const initialLiveItems: CompletedItem[] = props.initialHistory
    ? [{ kind: "banner", id: "banner" }, ...props.initialHistory]
    : [{ kind: "banner", id: "banner" }];
  const [liveItems, setLiveItems] = useState<CompletedItem[]>(initialLiveItems);
  const [overlay, setOverlay] = useState<"model" | null>(null);
  const [lastUserMessage, setLastUserMessage] = useState("");
  const [doneStatus, setDoneStatus] = useState<{
    durationMs: number;
    toolsUsed: string[];
    verb: string;
  } | null>(null);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState(props.model);
  const [currentProvider, setCurrentProvider] = useState(props.provider);
  const messagesRef = useRef<Message[]>(props.messages);
  const nextIdRef = useRef(0);
  const sessionManagerRef = useRef(
    props.sessionsDir ? new SessionManager(props.sessionsDir) : null,
  );
  const persistedIndexRef = useRef(messagesRef.current.length);

  const getId = () => String(nextIdRef.current++);

  // Derive credentials for the current provider
  const currentCreds = props.credentialsByProvider?.[currentProvider];
  const activeApiKey = currentCreds?.accessToken ?? props.apiKey;
  const activeAccountId = currentCreds?.accountId ?? props.accountId;

  // Load git branch
  useEffect(() => {
    getGitBranch(props.cwd).then(setGitBranch);
  }, [props.cwd]);

  const persistNewMessages = useCallback(async () => {
    const sm = sessionManagerRef.current;
    const sp = props.sessionPath;
    if (!sm || !sp) return;
    const allMsgs = messagesRef.current;
    for (let i = persistedIndexRef.current; i < allMsgs.length; i++) {
      const msg = allMsgs[i];
      if (msg.role === "system") continue;
      const entry: MessageEntry = {
        type: "message",
        id: crypto.randomUUID(),
        parentId: null,
        timestamp: new Date().toISOString(),
        message: msg,
      };
      await sm.appendEntry(sp, entry);
    }
    persistedIndexRef.current = allMsgs.length;
  }, [props.sessionPath]);

  // ── Background task bar state ───────────────────────────
  const [bgTasks, setBgTasks] = useState<BackgroundProcess[]>([]);
  const [taskBarFocused, setTaskBarFocused] = useState(false);
  const [taskBarExpanded, setTaskBarExpanded] = useState(false);
  const [selectedTaskIndex, setSelectedTaskIndex] = useState(0);

  // Poll ProcessManager every 2s for running tasks
  useEffect(() => {
    if (!props.processManager) return;
    const pm = props.processManager;
    const poll = () => {
      const running = pm.list().filter((p) => p.exitCode === null);
      setBgTasks(running);
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [props.processManager]);

  // Auto-exit task panel when all tasks gone
  useEffect(() => {
    if (bgTasks.length === 0) {
      setTaskBarFocused(false);
      setTaskBarExpanded(false);
    }
    // Clamp selected index
    const maxIdx = Math.min(bgTasks.length, 5) - 1;
    if (selectedTaskIndex > maxIdx && maxIdx >= 0) {
      setSelectedTaskIndex(maxIdx);
    }
  }, [bgTasks.length, selectedTaskIndex]);

  const handleFocusTaskBar = useCallback(() => {
    if (bgTasks.length > 0) {
      setTaskBarFocused(true);
    }
  }, [bgTasks.length]);

  const handleTaskBarExit = useCallback(() => {
    setTaskBarFocused(false);
    setTaskBarExpanded(false);
  }, []);

  const handleTaskBarExpand = useCallback(() => {
    setTaskBarExpanded(true);
    setSelectedTaskIndex(0);
  }, []);

  const handleTaskBarCollapse = useCallback(() => {
    setTaskBarExpanded(false);
  }, []);

  const handleTaskKill = useCallback(
    (id: string) => {
      props.processManager?.stop(id);
    },
    [props.processManager],
  );

  const handleTaskNavigate = useCallback((index: number) => {
    setSelectedTaskIndex(index);
  }, []);

  const agentLoop = useAgentLoop(
    messagesRef,
    {
      provider: currentProvider,
      model: currentModel,
      tools: props.tools,
      serverTools: props.serverTools,
      maxTokens: props.maxTokens,
      thinking: props.thinking,
      apiKey: activeApiKey,
      baseUrl: props.baseUrl,
      accountId: activeAccountId,
    },
    {
      onComplete: useCallback(() => {
        persistNewMessages();
      }, [persistNewMessages]),
      onTurnText: useCallback((text: string, thinking: string) => {
        setLiveItems((prev) => [...prev, { kind: "assistant", text, thinking, id: getId() }]);
      }, []),
      onToolStart: useCallback(
        (toolCallId: string, name: string, args: Record<string, unknown>) => {
          log("INFO", "tool", `Tool call started: ${name}`, { id: toolCallId });
          if (name === "subagent") {
            // Create or update the sub-agent group item
            const newAgent: SubAgentInfo = {
              toolCallId,
              task: String(args.task ?? ""),
              agentName: String(args.agent ?? "default"),
              status: "running",
              toolUseCount: 0,
              tokenUsage: { input: 0, output: 0 },
            };
            setLiveItems((prev) => {
              const groupIdx = prev.findIndex((item) => item.kind === "subagent_group");
              if (groupIdx !== -1) {
                const group = prev[groupIdx] as SubAgentGroupItem;
                const next = [...prev];
                next[groupIdx] = {
                  ...group,
                  agents: [...group.agents, newAgent],
                };
                return next;
              }
              return [...prev, { kind: "subagent_group", agents: [newAgent], id: getId() }];
            });
          } else {
            setLiveItems((prev) => [
              ...prev,
              { kind: "tool_start", toolCallId, name, args, id: getId() },
            ]);
          }
        },
        [],
      ),
      onToolUpdate: useCallback((toolCallId: string, update: unknown) => {
        setLiveItems((prev) => {
          const groupIdx = prev.findIndex((item) => item.kind === "subagent_group");
          if (groupIdx === -1) return prev;
          const group = prev[groupIdx] as SubAgentGroupItem;
          const agentIdx = group.agents.findIndex((a) => a.toolCallId === toolCallId);
          if (agentIdx === -1) return prev;

          const saUpdate = update as SubAgentUpdate;
          const updatedAgents = [...group.agents];
          updatedAgents[agentIdx] = {
            ...updatedAgents[agentIdx],
            toolUseCount: saUpdate.toolUseCount,
            tokenUsage: { ...saUpdate.tokenUsage },
            currentActivity: saUpdate.currentActivity,
          };

          const next = [...prev];
          next[groupIdx] = { ...group, agents: updatedAgents };
          return next;
        });
      }, []),
      onToolEnd: useCallback(
        (
          toolCallId: string,
          name: string,
          result: string,
          isError: boolean,
          durationMs: number,
          details?: unknown,
        ) => {
          const level = isError ? "ERROR" : "INFO";
          log(level as "INFO" | "ERROR", "tool", `Tool call ended: ${name}`, {
            id: toolCallId,
            duration: `${durationMs}ms`,
            isError: String(isError),
          });
          if (name === "subagent") {
            setLiveItems((prev) => {
              const groupIdx = prev.findIndex((item) => item.kind === "subagent_group");
              if (groupIdx === -1) return prev;
              const group = prev[groupIdx] as SubAgentGroupItem;
              const agentIdx = group.agents.findIndex((a) => a.toolCallId === toolCallId);
              if (agentIdx === -1) return prev;

              const saDetails = details as SubAgentDetails | undefined;
              const updatedAgents = [...group.agents];
              updatedAgents[agentIdx] = {
                ...updatedAgents[agentIdx],
                status: isError ? "error" : "done",
                result,
                durationMs: saDetails?.durationMs ?? durationMs,
                toolUseCount: saDetails?.toolUseCount ?? updatedAgents[agentIdx].toolUseCount,
                tokenUsage: saDetails?.tokenUsage ?? updatedAgents[agentIdx].tokenUsage,
              };

              const next = [...prev];
              next[groupIdx] = { ...group, agents: updatedAgents };
              return next;
            });
          } else {
            setLiveItems((prev) => {
              // Find the matching tool_start and replace it with tool_done
              const startIdx = prev.findIndex(
                (item) => item.kind === "tool_start" && item.toolCallId === toolCallId,
              );
              if (startIdx !== -1) {
                const startItem = prev[startIdx] as ToolStartItem;
                const doneItem: ToolDoneItem = {
                  kind: "tool_done",
                  name,
                  args: startItem.args,
                  result,
                  isError,
                  durationMs,
                  id: startItem.id,
                };
                const next = [...prev];
                next[startIdx] = doneItem;
                return next;
              }
              // Fallback: just append
              return [
                ...prev,
                { kind: "tool_done", name, args: {}, result, isError, durationMs, id: getId() },
              ];
            });
          }
        },
        [],
      ),
      onServerToolCall: useCallback((id: string, name: string, input: unknown) => {
        log("INFO", "server_tool", `Server tool call: ${name}`, { id });
        setLiveItems((prev) => [
          ...prev,
          { kind: "server_tool_start", serverToolCallId: id, name, input, id: getId() },
        ]);
      }, []),
      onServerToolResult: useCallback((toolUseId: string, resultType: string, data: unknown) => {
        log("INFO", "server_tool", `Server tool result`, { toolUseId, resultType });
        setLiveItems((prev) => {
          const startIdx = prev.findIndex(
            (item) => item.kind === "server_tool_start" && item.serverToolCallId === toolUseId,
          );
          if (startIdx !== -1) {
            const startItem = prev[startIdx] as ServerToolStartItem;
            const doneItem: ServerToolDoneItem = {
              kind: "server_tool_done",
              name: startItem.name,
              input: startItem.input,
              resultType,
              data,
              id: startItem.id,
            };
            const next = [...prev];
            next[startIdx] = doneItem;
            return next;
          }
          return [
            ...prev,
            { kind: "server_tool_done", name: "unknown", input: {}, resultType, data, id: getId() },
          ];
        });
      }, []),
      onTurnEnd: useCallback(
        (
          turn: number,
          stopReason: string,
          usage: { inputTokens: number; outputTokens: number },
        ) => {
          log("INFO", "turn", `Turn ${turn} ended`, {
            stopReason,
            inputTokens: String(usage.inputTokens),
            outputTokens: String(usage.outputTokens),
          });
        },
        [],
      ),
      onDone: useCallback((durationMs: number, toolsUsed: string[]) => {
        log("INFO", "agent", `Agent done`, {
          duration: `${durationMs}ms`,
          toolsUsed: toolsUsed.join(",") || "none",
        });
        setDoneStatus({ durationMs, toolsUsed, verb: pickDurationVerb(toolsUsed) });
      }, []),
      onAborted: useCallback(() => {
        log("WARN", "agent", "Agent run aborted by user");
        setLiveItems((prev) => {
          const next = prev.map((item) =>
            item.kind === "subagent_group" ? { ...item, aborted: true } : item,
          );
          return [...next, { kind: "info", text: "Request was stopped.", id: getId() }];
        });
      }, []),
    },
  );

  // Sync terminal title with agent loop state
  useEffect(() => {
    setTitlePhase(agentLoop.activityPhase);
    setTitleRunning(agentLoop.isRunning);
  }, [agentLoop.activityPhase, agentLoop.isRunning]);

  // Animated thinking border
  const [thinkingBorderFrame, setThinkingBorderFrame] = useState(0);
  useEffect(() => {
    if (agentLoop.activityPhase !== "thinking") return;
    const timer = setInterval(() => {
      setThinkingBorderFrame((f) => (f + 1) % THINKING_BORDER_COLORS.length);
    }, 500);
    return () => clearInterval(timer);
  }, [agentLoop.activityPhase]);

  // Success flash on turn completion
  const [doneFlash, setDoneFlash] = useState(false);
  useEffect(() => {
    if (doneStatus) {
      setDoneFlash(true);
      const timer = setTimeout(() => setDoneFlash(false), 600);
      return () => clearTimeout(timer);
    }
  }, [doneStatus]);

  const handleSubmit = useCallback(
    async (input: string) => {
      const trimmed = input.trim();

      if (trimmed.startsWith("/")) {
        log("INFO", "command", `Slash command: ${trimmed}`);
      } else {
        const truncated = trimmed.length > 100 ? trimmed.slice(0, 100) + "..." : trimmed;
        log("INFO", "input", `User input: ${truncated}`);
      }

      // Handle /model directly — open inline selector
      if (trimmed === "/model" || trimmed === "/m") {
        setOverlay("model");
        return;
      }

      // Handle /clear — reset session
      if (trimmed === "/clear") {
        setHistory([]);
        setLiveItems([]);
        messagesRef.current = messagesRef.current.slice(0, 1); // keep system prompt
        agentLoop.reset();
        setLiveItems([{ kind: "info", text: "Session cleared.", id: getId() }]);
        return;
      }

      // Check slash commands
      if (props.onSlashCommand && input.startsWith("/")) {
        const result = await props.onSlashCommand(input);
        if (result !== null) {
          setLiveItems((prev) => [...prev, { kind: "info", text: result, id: getId() }]);
          return;
        }
      }

      // Move current live items into history (Static) before starting new turn
      setLiveItems((prev) => {
        if (prev.length > 0) {
          setHistory((h) => [...h, ...prev]);
        }
        return [];
      });

      // Add user message to live area
      const userItem: UserItem = { kind: "user", text: input, id: getId() };
      setLastUserMessage(input);
      setDoneStatus(null);
      setLiveItems([userItem]);

      // Run agent
      try {
        await agentLoop.run(input);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log("ERROR", "error", msg);
        const isAbort = msg.includes("aborted") || msg.includes("abort");
        setLiveItems((prev) => [
          ...prev,
          isAbort
            ? { kind: "info", text: "Request was stopped.", id: getId() }
            : { kind: "error", message: msg, id: getId() },
        ]);
      }
    },
    [agentLoop, props.onSlashCommand],
  );

  const handleAbort = useCallback(() => {
    if (agentLoop.isRunning) {
      agentLoop.abort();
    } else {
      process.exit(0);
    }
  }, [agentLoop]);

  const handleModelSelect = useCallback(
    (value: string) => {
      setOverlay(null);
      const colonIdx = value.indexOf(":");
      if (colonIdx === -1) return;
      const newProvider = value.slice(0, colonIdx) as Provider;
      const newModelId = value.slice(colonIdx + 1);
      log("INFO", "model", `Model changed`, { provider: newProvider, model: newModelId });
      setCurrentProvider(newProvider);
      setCurrentModel(newModelId);
      const modelInfo = getModel(newModelId);
      const displayName = modelInfo?.name ?? newModelId;
      setLiveItems((prev) => [
        ...prev,
        { kind: "info", text: `Switched to ${displayName}`, id: getId() },
      ]);

      // Persist model selection for next CLI launch
      if (props.settingsFile) {
        const sm = new SettingsManager(props.settingsFile);
        sm.load().then(async () => {
          await sm.set("defaultProvider", newProvider);
          await sm.set("defaultModel", newModelId);
        });
      }
    },
    [props.settingsFile],
  );

  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows ?? 24;

  const renderItem = (item: CompletedItem) => {
    switch (item.kind) {
      case "banner":
        return (
          <Banner
            key={item.id}
            version={props.version}
            model={props.model}
            provider={props.provider}
            cwd={props.cwd}
          />
        );
      case "user":
        return <UserMessage key={item.id} text={item.text} />;
      case "assistant":
        return (
          <AssistantMessage
            key={item.id}
            text={item.text}
            thinking={item.thinking}
            showThinking={props.showThinking}
          />
        );
      case "tool_start":
        return <ToolExecution key={item.id} status="running" name={item.name} args={item.args} />;
      case "tool_done":
        return (
          <ToolExecution
            key={item.id}
            status="done"
            name={item.name}
            args={item.args}
            result={item.result}
            isError={item.isError}
          />
        );
      case "server_tool_start":
        return (
          <ServerToolExecution key={item.id} status="running" name={item.name} input={item.input} />
        );
      case "server_tool_done":
        return (
          <ServerToolExecution
            key={item.id}
            status="done"
            name={item.name}
            input={item.input}
            resultType={item.resultType}
            data={item.data}
          />
        );
      case "error":
        return (
          <Box key={item.id} marginTop={1}>
            <Text color={theme.error}>{"✗ "}</Text>
            <Text color={theme.error}>{item.message}</Text>
          </Box>
        );
      case "info":
        return (
          <Box key={item.id} marginTop={1}>
            <Text color={theme.textDim}>{item.text}</Text>
          </Box>
        );
      case "duration":
        return (
          <Box key={item.id} marginTop={1}>
            <Text color={theme.textDim}>
              {"✻ "}
              {item.verb} {formatDuration(item.durationMs)}
            </Text>
          </Box>
        );
      case "subagent_group":
        return <SubAgentPanel key={item.id} agents={item.agents} aborted={item.aborted} />;
    }
  };

  return (
    <Box flexDirection="column" minHeight={terminalHeight}>
      {/* History — scrolled up, managed by Ink Static.
          width="100%" is required because Static uses position:absolute internally,
          which causes auto-width resolution to shrink-wrap content. Without it,
          children using flexGrow+flexBasis=0 (like AssistantMessage) collapse to
          near-zero width and text wraps at ~3 chars. */}
      <Static items={history} style={{ width: "100%" }}>
        {(item) => renderItem(item)}
      </Static>

      {/* Content area — paddingRight prevents Yoga off-by-one blank lines
          when text wraps at the exact terminal edge */}
      <Box flexDirection="column" flexGrow={1} paddingRight={1}>
        {/* Live items — current/last turn, stays visible */}
        {liveItems.map((item) => renderItem(item))}

        {/* Streaming area — thinking text + response text */}
        <StreamingArea
          isRunning={agentLoop.isRunning}
          streamingText={agentLoop.streamingText}
          streamingThinking={agentLoop.streamingThinking}
          showThinking={props.showThinking}
        />
      </Box>

      {/* Pinned status line — activity indicator while running, duration summary when done */}
      {agentLoop.isRunning && agentLoop.activityPhase !== "idle" ? (
        <Box
          marginTop={1}
          borderStyle={agentLoop.activityPhase === "thinking" ? "round" : undefined}
          borderColor={
            agentLoop.activityPhase === "thinking"
              ? THINKING_BORDER_COLORS[thinkingBorderFrame]
              : undefined
          }
          paddingLeft={agentLoop.activityPhase === "thinking" ? 1 : 0}
          paddingRight={agentLoop.activityPhase === "thinking" ? 1 : 0}
        >
          <ActivityIndicator
            phase={agentLoop.activityPhase}
            elapsedMs={agentLoop.elapsedMs}
            thinkingMs={agentLoop.thinkingMs}
            isThinking={agentLoop.isThinking}
            tokenEstimate={agentLoop.streamedTokenEstimate}
            userMessage={lastUserMessage}
          />
        </Box>
      ) : (
        doneStatus && (
          <Box marginTop={1}>
            <Text color={doneFlash ? theme.success : theme.textDim}>
              {"✻ "}
              {doneStatus.verb} {formatDuration(doneStatus.durationMs)}
            </Text>
          </Box>
        )
      )}

      {/* Input + Footer/ModelSelector pinned at bottom */}
      <InputArea
        onSubmit={handleSubmit}
        onAbort={handleAbort}
        disabled={agentLoop.isRunning}
        isActive={!taskBarFocused}
        onDownAtEnd={handleFocusTaskBar}
      />
      {overlay === "model" ? (
        <ModelSelector
          onSelect={handleModelSelect}
          onCancel={() => setOverlay(null)}
          loggedInProviders={props.loggedInProviders ?? [currentProvider]}
          currentModel={currentModel}
          currentProvider={currentProvider}
        />
      ) : (
        <Footer
          model={currentModel}
          tokensIn={agentLoop.contextUsed}
          cwd={props.cwd}
          gitBranch={gitBranch}
        />
      )}
      {bgTasks.length > 0 && (
        <BackgroundTasksBar
          tasks={bgTasks}
          focused={taskBarFocused}
          expanded={taskBarExpanded}
          selectedIndex={selectedTaskIndex}
          onExpand={handleTaskBarExpand}
          onCollapse={handleTaskBarCollapse}
          onKill={handleTaskKill}
          onExit={handleTaskBarExit}
          onNavigate={handleTaskNavigate}
        />
      )}
    </Box>
  );
}
