#!/usr/bin/env node

import { parseArgs } from "node:util";
import fs from "node:fs";
import readline from "node:readline/promises";
import { exec } from "node:child_process";
import { createRequire } from "node:module";
import { runPrintMode } from "./modes/print-mode.js";
import { renderApp } from "./ui/render.js";
import { formatUserError } from "./utils/error-handler.js";
import type { Provider, ThinkingLevel } from "@kenkaiiii/gg-ai";
import { AuthStorage } from "./core/auth-storage.js";
import { ensureAppDirs } from "./config.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { createTools } from "./tools/index.js";
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

Options:
  -p, --provider <name>     LLM provider (anthropic, openai) [default: anthropic]
  -m, --model <name>        Model name [default: claude-opus-4-6]
      --base-url <url>      Custom API base URL
      --system-prompt <text> Override system prompt
      --thinking <level>    Thinking level (low, medium, high)
  -c, --continue            Resume the most recent session for this directory
  -s, --session <path>      Resume a specific session file
      --print               Print mode: one-shot, output to stdout, then exit
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

  const { values, positionals } = parseArgs({
    options: {
      provider: { type: "string", short: "p" },
      model: { type: "string", short: "m" },
      "base-url": { type: "string" },
      "system-prompt": { type: "string" },
      thinking: { type: "string" },
      continue: { type: "boolean", short: "c" },
      session: { type: "string", short: "s" },
      print: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const provider = (values.provider ?? "anthropic") as "anthropic" | "openai";
  const model = values.model ?? (provider === "openai" ? "gpt-4.1" : "claude-opus-4-6");

  const thinkingLevel = values.thinking as ThinkingLevel | undefined;

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

  // Interactive mode (Ink TUI)
  const cwd = process.cwd();

  runInkTUI({
    provider,
    model,
    baseUrl: values["base-url"],
    cwd,
    thinkingLevel,
    systemPrompt: values["system-prompt"],
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

  // Build system prompt & tools
  const systemPrompt = opts.systemPrompt ?? (await buildSystemPrompt(cwd));
  const tools = createTools(cwd);

  // Seed messages with system prompt
  const messages = [{ role: "system" as const, content: systemPrompt }];

  await renderApp({
    provider,
    model,
    tools,
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
  });
}

// ── Login ──────────────────────────────────────────────────

async function runLogin(): Promise<void> {
  await ensureAppDirs();
  const authStorage = new AuthStorage();
  await authStorage.load();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    // Interactive provider selection
    const provider = await selectProvider(rl);

    console.log(`\nLogging in to ${displayName(provider)}...\n`);

    const callbacks: OAuthLoginCallbacks = {
      onOpenUrl: (url) => {
        console.log("Opening browser...");
        openBrowser(url);
        console.log(`\nIf the browser didn't open, visit:\n${chalk.dim(url)}\n`);
      },
      onPromptCode: async (message) => {
        return rl.question(message + " ");
      },
      onStatus: (message) => {
        console.log(chalk.dim(message));
      },
    };

    const creds =
      provider === "anthropic" ? await loginAnthropic(callbacks) : await loginOpenAI(callbacks);

    await authStorage.setCredentials(provider, creds);
    console.log(chalk.green(`\nLogged in to ${displayName(provider)} successfully!`));
  } finally {
    rl.close();
  }
}

async function selectProvider(rl: readline.Interface): Promise<Provider> {
  const providers: { key: string; label: string; value: Provider }[] = [
    { key: "1", label: "Anthropic (Claude)", value: "anthropic" },
    { key: "2", label: "OpenAI (ChatGPT)", value: "openai" },
  ];

  console.log("\nSelect a provider to log in:\n");
  for (const p of providers) {
    console.log(`  ${chalk.bold(p.key)}) ${p.label}`);
  }
  console.log();

  while (true) {
    const answer = (await rl.question("Choice (1-2): ")).trim();
    const match = providers.find((p) => p.key === answer);
    if (match) return match.value;
    console.log("Invalid choice. Enter 1 or 2.");
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

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";

  exec(`${cmd} "${url}"`, () => {
    // Ignore errors — user can copy URL manually
  });
}

main();
