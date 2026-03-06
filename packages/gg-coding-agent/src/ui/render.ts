import React from "react";
import { render } from "ink";
import type { Message, Provider, ServerToolDefinition, ThinkingLevel } from "@kenkaiiii/gg-ai";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import type { ProcessManager } from "../core/process-manager.js";
import { App, type CompletedItem } from "./App.js";
import { ThemeContext, loadTheme } from "./theme/theme.js";

export interface RenderAppConfig {
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
  theme?: "dark" | "light";
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

export async function renderApp(config: RenderAppConfig): Promise<void> {
  const theme = loadTheme(config.theme ?? "dark");

  const { waitUntilExit } = render(
    React.createElement(
      ThemeContext.Provider,
      { value: theme },
      React.createElement(App, {
        provider: config.provider,
        model: config.model,
        tools: config.tools,
        serverTools: config.serverTools,
        messages: config.messages,
        maxTokens: config.maxTokens,
        thinking: config.thinking,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        accountId: config.accountId,
        cwd: config.cwd,
        version: config.version,
        showThinking: config.showThinking,
        showTokenUsage: config.showTokenUsage,
        onSlashCommand: config.onSlashCommand,
        loggedInProviders: config.loggedInProviders,
        credentialsByProvider: config.credentialsByProvider,
        initialHistory: config.initialHistory,
        sessionsDir: config.sessionsDir,
        sessionPath: config.sessionPath,
        processManager: config.processManager,
        settingsFile: config.settingsFile,
      }),
    ),
  );

  await waitUntilExit();
}
