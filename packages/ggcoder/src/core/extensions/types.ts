import type { AgentTool } from "@kenkaiiii/gg-agent";
import type { EventBus } from "../event-bus.js";
import type { SettingsManager } from "../settings-manager.js";
import type { SlashCommand } from "../slash-commands.js";

export interface ExtensionContext {
  eventBus: EventBus;
  registerTool: (tool: AgentTool) => void;
  registerSlashCommand: (command: SlashCommand) => void;
  cwd: string;
  settingsManager: SettingsManager;
}

export interface Extension {
  name: string;
  version?: string;
  activate: (context: ExtensionContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

export type ExtensionFactory = () => Extension;
