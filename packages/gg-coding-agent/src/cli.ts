#!/usr/bin/env node

import { parseArgs } from "node:util";
import fs from "node:fs";
import readline from "node:readline/promises";
import { exec } from "node:child_process";
import { createRequire } from "node:module";
import { runPrintMode } from "./modes/print-mode.js";
import { runJsonMode } from "./modes/json-mode.js";
import { renderApp } from "./ui/render.js";
import { renderLoginSelector } from "./ui/login.js";
import type { CompletedItem } from "./ui/App.js";
import { formatUserError } from "./utils/error-handler.js";
import type { Message, Provider, ThinkingLevel } from "@kenkaiiii/gg-ai";
import { AuthStorage } from "./core/auth-storage.js";
import { SessionManager } from "./core/session-manager.js";
import { ensureAppDirs } from "./config.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { createTools } from "./tools/index.js";
import { discoverAgents } from "./core/agents.js";
import { loginAnthropic } from "./core/oauth/anthropic.js";
import { loginOpenAI } from "./core/oauth/openai.js";
import type { OAuthLoginCallbacks } from "./core/oauth/types.js";
import chalk from "chalk";

const _require = createRequire(import.meta.url);
const CLI_VERSION = (_require("../package.json") as { version: string }).version;

const USAGE = `
Usage: ggcoder [command] [options] [message...]

Commands:
  login                     Log in to a provider via OAuth
  logout                    Log out (clear stored credentials)
  continue                  Resume the most recent session for this directory

Options:
  -p, --provider <name>     LLM provider (anthropic, openai) [default: anthropic]
  -m, --model <name>        Model name [default: claude-opus-4-6]
      --base-url <url>      Custom API base URL
      --system-prompt <text> Override system prompt
      --thinking <level>    Thinking level (low, medium, high)
      --max-turns <n>       Maximum agent loop turns [default: 40]
  -s, --session <path>      Resume a specific session file
      --print               Print mode: one-shot, output to stdout, then exit
      --json                JSON mode: one-shot, output NDJSON events to stdout
  -v, --version             Show version number
  -h, --help                Show this help message

Print mode:
  echo "hello" | ggcoder --print
  ggcoder --print "explain this code"

Authentication:
  ggcoder login             Log in (select provider interactively)
  ggcoder logout            Log out from all providers
`.trim();

function main(): void {
  // Handle subcommands before parseArgs
  const subcommand = process.argv[2];

  if (subcommand === "login") {
    runLogin().catch((err) => {
      process.stderr.write(formatUserError(err) + "\n");
      process.exit(1);
    });
    return;
  }

  if (subcommand === "logout") {
    runLogout().catch((err) => {
      process.stderr.write(formatUserError(err) + "\n");
      process.exit(1);
    });
    return;
  }

  if (subcommand === "continue") {
    // Remove "continue" so parseArgs handles remaining flags
    process.argv.splice(2, 1);
  }

  const { values, positionals } = parseArgs({
    options: {
      provider: { type: "string", short: "p" },
      model: { type: "string", short: "m" },
      "base-url": { type: "string" },
      "system-prompt": { type: "string" },
      thinking: { type: "string" },
      "max-turns": { type: "string" },
      session: { type: "string", short: "s" },
      print: { type: "boolean" },
      json: { type: "boolean" },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.version) {
    console.log(CLI_VERSION);
    process.exit(0);
  }

  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const provider = (values.provider ?? "anthropic") as "anthropic" | "openai";
  const model = values.model ?? (provider === "openai" ? "gpt-4.1" : "claude-opus-4-6");

  const thinkingLevel = values.thinking as ThinkingLevel | undefined;
  const maxTurns = values["max-turns"] ? parseInt(values["max-turns"], 10) : undefined;

  // Print mode
  if (values.print) {
    const message = positionals.join(" ").trim() || readStdinSync();
    if (!message) {
      console.error("Error: --print requires a message (positional args or stdin)");
      process.exit(1);
    }

    runPrintMode({
      message,
      provider,
      model,
      baseUrl: values["base-url"],
      systemPrompt: values["system-prompt"],
      cwd: process.cwd(),
      thinkingLevel,
    }).catch((err) => {
      process.stderr.write(formatUserError(err) + "\n");
      process.exit(1);
    });
    return;
  }

  // JSON mode
  if (values.json) {
    const message = positionals.join(" ").trim() || readStdinSync();
    if (!message) {
      console.error("Error: --json requires a message (positional args or stdin)");
      process.exit(1);
    }

    runJsonMode({
      message,
      provider,
      model,
      baseUrl: values["base-url"],
      systemPrompt: values["system-prompt"],
      cwd: process.cwd(),
      thinkingLevel,
      maxTurns,
    }).catch((err) => {
      process.stderr.write(formatUserError(err) + "\n");
      process.exit(1);
    });
    return;
  }

  // Interactive mode (Ink TUI)
  const cwd = process.cwd();
  const continueRecent = subcommand === "continue";

  runInkTUI({
    provider,
    model,
    baseUrl: values["base-url"],
    cwd,
    thinkingLevel,
    systemPrompt: values["system-prompt"],
    continueRecent,
    sessionPath: values.session,
  }).catch((err) => {
    process.stderr.write(formatUserError(err) + "\n");
    process.exit(1);
  });
}

// ── Ink TUI ───────────────────────────────────────────────

async function runInkTUI(opts: {
  provider: Provider;
  model: string;
  baseUrl?: string;
  cwd: string;
  thinkingLevel?: ThinkingLevel;
  systemPrompt?: string;
  continueRecent?: boolean;
  sessionPath?: string;
}): Promise<void> {
  const { provider, model, cwd } = opts;

  // Resolve auth
  const paths = await ensureAppDirs();
  const authStorage = new AuthStorage(paths.authFile);
  await authStorage.load();
  const creds = await authStorage.resolveCredentials(provider);

  // Detect all logged-in providers and preload their credentials
  const allProviders: Provider[] = ["anthropic", "openai"];
  const loggedInProviders: Provider[] = [];
  const credentialsByProvider: Record<string, { accessToken: string; accountId?: string }> = {};

  for (const p of allProviders) {
    const stored = await authStorage.getCredentials(p);
    if (stored) {
      loggedInProviders.push(p);
      try {
        const resolved = await authStorage.resolveCredentials(p);
        credentialsByProvider[p] = {
          accessToken: resolved.accessToken,
          accountId: resolved.accountId,
        };
      } catch {
        // Token refresh failed — still mark as logged in
      }
    }
  }

  // Discover agents and build tools
  const agents = await discoverAgents({
    globalAgentsDir: paths.agentsDir,
    projectDir: cwd,
  });

  // Build system prompt & tools (with sub-agent support)
  const systemPrompt = opts.systemPrompt ?? (await buildSystemPrompt(cwd));
  const tools = createTools(cwd, { agents, provider, model });

  // Seed messages with system prompt
  const messages: Message[] = [{ role: "system" as const, content: systemPrompt }];

  // Session management — create or reuse session file
  const sessionManager = new SessionManager(paths.sessionsDir);
  let sessionPath: string | undefined;
  let initialHistory: CompletedItem[] | undefined;

  if (opts.continueRecent || opts.sessionPath) {
    const existingPath = opts.sessionPath ?? (await sessionManager.getMostRecent(cwd));

    if (existingPath) {
      try {
        const loaded = await sessionManager.load(existingPath);
        const loadedMessages = sessionManager.getMessages(loaded.entries);

        if (loadedMessages.length > 0) {
          messages.push(...loadedMessages);
          sessionPath = existingPath; // reuse existing session file
          initialHistory = messagesToHistoryItems(loadedMessages);
          initialHistory.push({
            kind: "info",
            text: `↻ Restored session (${loadedMessages.length} messages)`,
            id: `restore-info`,
          });
        }
      } catch {
        // Session file corrupt or missing — start fresh
      }
    }
  }

  // Create a new session file if we didn't reuse one
  if (!sessionPath) {
    const session = await sessionManager.create(cwd, provider, model);
    sessionPath = session.path;
  }

  // Server-side tools (Anthropic only)
  const serverTools =
    provider === "anthropic" ? [{ type: "web_search_20250305", name: "web_search" }] : undefined;

  await renderApp({
    provider,
    model,
    tools,
    serverTools,
    messages,
    version: CLI_VERSION,
    maxTokens: 16384,
    thinking: opts.thinkingLevel,
    apiKey: creds.accessToken,
    baseUrl: opts.baseUrl,
    accountId: creds.accountId,
    cwd,
    loggedInProviders,
    credentialsByProvider,
    initialHistory,
    sessionsDir: paths.sessionsDir,
    sessionPath,
  });
}

// ── Login ──────────────────────────────────────────────────

async function runLogin(): Promise<void> {
  await ensureAppDirs();
  const authStorage = new AuthStorage();
  await authStorage.load();

  // Phase 1: Ink-based provider selector
  const provider = await renderLoginSelector();
  if (!provider) {
    console.log(chalk.hex("#6b7280")("Login cancelled."));
    return;
  }

  console.log(
    chalk.hex("#60a5fa").bold("\nLogging in to ") +
      chalk.hex("#a78bfa")(displayName(provider)) +
      chalk.hex("#60a5fa").bold("...\n"),
  );

  // Phase 2: OAuth flow (readline needed for Anthropic code paste)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const callbacks: OAuthLoginCallbacks = {
      onOpenUrl: (url) => {
        console.log(chalk.hex("#60a5fa").bold("Opening browser..."));
        openBrowser(url);
        console.log(
          chalk.hex("#6b7280")("\nIf the browser didn't open, visit:\n") +
            chalk.hex("#6b7280")(url) +
            "\n",
        );
      },
      onPromptCode: async (message) => {
        return rl.question(message + " ");
      },
      onStatus: (message) => {
        console.log(chalk.hex("#6b7280")(message));
      },
    };

    const creds =
      provider === "anthropic" ? await loginAnthropic(callbacks) : await loginOpenAI(callbacks);

    await authStorage.setCredentials(provider, creds);
    console.log(chalk.hex("#4ade80")(`\n✓ Logged in to ${displayName(provider)} successfully!`));
  } finally {
    rl.close();
  }
}

// ── Logout ─────────────────────────────────────────────────

async function runLogout(): Promise<void> {
  await ensureAppDirs();
  const authStorage = new AuthStorage();
  await authStorage.load();
  await authStorage.clearAll();
  console.log(chalk.green("Logged out successfully."));
}

// ── Helpers ────────────────────────────────────────────────

function readStdinSync(): string {
  if (process.stdin.isTTY) return "";
  try {
    return fs.readFileSync(0, "utf-8").trim();
  } catch {
    return "";
  }
}

function displayName(provider: Provider): string {
  return provider === "anthropic" ? "Anthropic" : "OpenAI";
}

function extractText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n");
}

function messagesToHistoryItems(msgs: Message[]): CompletedItem[] {
  const items: CompletedItem[] = [];
  let id = 0;
  for (const msg of msgs) {
    if (msg.role === "user") {
      const text = extractText(msg.content);
      if (text) items.push({ kind: "user", text, id: `restore-${id++}` });
    } else if (msg.role === "assistant") {
      const text = extractText(msg.content);
      if (text) items.push({ kind: "assistant", text, id: `restore-${id++}` });
    }
    // Skip tool result messages — they don't need visual display
  }
  return items;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";

  exec(`${cmd} "${url}"`, () => {
    // Ignore errors — user can copy URL manually
  });
}

main();
