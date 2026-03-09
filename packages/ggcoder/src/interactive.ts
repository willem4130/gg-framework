import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { agentLoop, type AgentEvent } from "@kenkaiiii/gg-agent";
import type { Message } from "@kenkaiiii/gg-ai";
import type { CliConfig } from "./types.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { createTools } from "./tools/index.js";
import {
  createSession,
  loadSession,
  getMostRecentSession,
  persistMessage,
  type Session,
} from "./session.js";
import {
  formatToolCallStart,
  formatToolCallEnd,
  formatUsage,
  formatError,
  formatWelcome,
} from "./utils/format.js";
import { AuthStorage } from "./core/auth-storage.js";
import { ensureAppDirs } from "./config.js";

export async function runInteractive(config: CliConfig): Promise<void> {
  const { provider, model, cwd } = config;

  // Build system prompt
  const systemPrompt = config.systemPrompt ?? (await buildSystemPrompt(cwd));

  // Create tools
  const { tools, processManager } = createTools(cwd);
  process.on("exit", () => processManager.shutdownAll());

  // Load auth
  const paths = await ensureAppDirs();
  const authStorage = new AuthStorage(paths.authFile);
  await authStorage.load();

  // Initialize messages and session
  const messages: Message[] = [];
  let session: Session;

  // Resume session or create new
  if (config.sessionId) {
    const loaded = await loadSession(config.sessionId);
    messages.push({ role: "system", content: systemPrompt });
    messages.push(...loaded.messages);
    session = await createSession(cwd, provider, model);
    // Re-persist loaded messages to new session file
    for (const msg of loaded.messages) {
      await persistMessage(session, msg);
    }
  } else if (config.continueRecent) {
    const recentPath = await getMostRecentSession(cwd);
    if (recentPath) {
      const loaded = await loadSession(recentPath);
      messages.push({ role: "system", content: systemPrompt });
      messages.push(...loaded.messages);
      session = await createSession(cwd, provider, model);
      for (const msg of loaded.messages) {
        await persistMessage(session, msg);
      }
    } else {
      messages.push({ role: "system", content: systemPrompt });
      session = await createSession(cwd, provider, model);
    }
  } else {
    messages.push({ role: "system", content: systemPrompt });
    session = await createSession(cwd, provider, model);
  }

  // Welcome banner
  stdout.write(formatWelcome(model, provider, cwd) + "\n");

  // Readline loop
  const rl = readline.createInterface({ input: stdin, output: stdout });

  rl.on("close", () => {
    stdout.write("\nGoodbye!\n");
    process.exit(0);
  });

  while (true) {
    let input: string;
    try {
      input = await rl.question("> ");
    } catch {
      break; // readline closed
    }

    input = input.trim();
    if (!input) continue;

    // Push user message
    const userMessage: Message = { role: "user", content: input };
    messages.push(userMessage);
    await persistMessage(session, userMessage);

    // Track where we are for persisting new messages after agentLoop
    const lastPersistedIndex = messages.length;

    // Create abort controller for this run
    const ac = new AbortController();
    const onSigint = () => {
      ac.abort();
    };
    process.on("SIGINT", onSigint);

    try {
      stdout.write("\n");

      const creds = await authStorage.resolveCredentials(provider);
      const generator = agentLoop(messages, {
        provider,
        model,
        tools,
        maxTokens: 16384,
        apiKey: creds.accessToken,
        baseUrl: config.baseUrl,
        signal: ac.signal,
        accountId: creds.accountId,
      });

      for await (const event of generator as AsyncIterable<AgentEvent>) {
        renderEvent(event);
      }

      stdout.write("\n");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        stdout.write("\n\nInterrupted.\n");
      } else {
        stdout.write(
          "\n" + formatError(err instanceof Error ? err : new Error(String(err))) + "\n",
        );
      }
    } finally {
      process.removeListener("SIGINT", onSigint);
    }

    // Persist new messages added by agentLoop
    for (let i = lastPersistedIndex; i < messages.length; i++) {
      await persistMessage(session, messages[i]);
    }
  }

  rl.close();
}

// Track tool names by toolCallId since tool_call_end doesn't include name
const toolCallNames = new Map<string, string>();

function renderEvent(event: AgentEvent): void {
  switch (event.type) {
    case "text_delta":
      stdout.write(event.text);
      break;

    case "thinking_delta":
      // Show thinking in dim
      stdout.write(`\x1b[2m${event.text}\x1b[0m`);
      break;

    case "tool_call_start":
      toolCallNames.set(event.toolCallId, event.name);
      stdout.write("\n" + formatToolCallStart(event.name, event.args) + "\n");
      break;

    case "tool_call_end": {
      const name = toolCallNames.get(event.toolCallId) ?? "unknown";
      toolCallNames.delete(event.toolCallId);
      stdout.write(formatToolCallEnd(name, event.result, event.isError, event.durationMs) + "\n\n");
      break;
    }

    case "turn_end":
      stdout.write(formatUsage(event.usage.inputTokens, event.usage.outputTokens) + "\n");
      break;

    case "agent_done":
      // Final usage summary already shown via turn_end
      break;

    case "error":
      stdout.write(formatError(event.error) + "\n");
      break;
  }
}
