import { useCallback } from "react";
import type { SlashCommandRegistry, SlashCommandContext } from "../../core/slash-commands.js";

export interface UseSlashCommandsReturn {
  isSlashCommand: (input: string) => boolean;
  execute: (input: string) => Promise<string | null>;
}

export function useSlashCommands(
  registry: SlashCommandRegistry,
  context: SlashCommandContext,
): UseSlashCommandsReturn {
  const isSlashCommand = useCallback(
    (input: string) => {
      return registry.parse(input.trim()) !== null;
    },
    [registry],
  );

  const execute = useCallback(
    async (input: string) => {
      return registry.execute(input.trim(), context);
    },
    [registry, context],
  );

  return { isSlashCommand, execute };
}
