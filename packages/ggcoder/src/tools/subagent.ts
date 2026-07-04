import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import type { Provider } from "@kenkaiiii/gg-ai";
import type { AgentDefinition } from "../core/agents.js";
import { getFastModel } from "../core/model-registry.js";
import { log } from "../core/logger.js";
import { truncateTail } from "./truncate.js";
import { isPlanModeActive, planModeRestriction } from "../core/runtime-mode.js";

// Tools that can mutate the workspace. A named agent whose allow-list contains
// none of these is a read-only scout (recon/research) — safe to route to the
// provider's fast/cheap model. An agent that can write/edit keeps the parent
// model so code changes never regress in quality.
const MUTATING_TOOLS = new Set(["write", "edit"]);

/**
 * True when the sub-agent is a read-only scout: an explicit named agent with a
 * non-empty tool allow-list that grants no mutating tool. A subagent call with
 * no `agent` (full toolset) is NOT read-only — it keeps the parent model.
 */
function isReadOnlyAgent(agentDef: AgentDefinition | undefined): boolean {
  if (!agentDef || agentDef.tools.length === 0) return false;
  return !agentDef.tools.some((tool) => MUTATING_TOOLS.has(tool.toLowerCase()));
}

const SUB_AGENT_MAX_TURNS = 50;
const SUB_AGENT_MAX_OUTPUT_CHARS = 100_000; // ~25k tokens, matches other tool limits
const SUB_AGENT_MAX_OUTPUT_LINES = 500;
const SUB_AGENT_MAX_STDERR_CHARS = 10_000; // Cap stderr to prevent unbounded growth
const SUB_AGENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minute hard timeout

/**
 * Absolute path to the ggcoder CLI entry (dist/cli.js) that runs a sub-agent in
 * JSON mode. Resolved relative to this module so it's correct no matter how the
 * host process was launched (CLI bin, desktop app sidecar, tests). Falls back to
 * the launching script only if the sibling file is missing.
 */
function resolveCliEntry(): string {
  const cliPath = fileURLToPath(new URL("../cli.js", import.meta.url));
  return existsSync(cliPath) ? cliPath : process.argv[1];
}

const SubAgentParams = z.object({
  task: z.string().describe("The task to delegate to the sub-agent"),
  agent: z
    .string()
    .optional()
    .describe("Named agent definition to use (from ~/.gg/agents/ or .gg/agents/)"),
});

export interface SubAgentUpdate {
  toolUseCount: number;
  tokenUsage: { input: number; output: number };
  currentActivity?: string;
}

export interface SubAgentDetails {
  toolUseCount: number;
  tokenUsage: { input: number; output: number };
  durationMs: number;
}

export function createSubAgentTool(
  cwd: string,
  agents: AgentDefinition[],
  getParentProvider: () => string,
  getParentModel: () => string,
  getParentCacheKey?: () => string | undefined,
  planModeRef?: { current: boolean },
): AgentTool<typeof SubAgentParams> {
  const agentList = agents.map((a) => `- ${a.name}: ${a.description}`).join("\n");
  const agentDesc = agentList
    ? `\n\nAvailable named agents:\n${agentList}`
    : "\n\nNo named agents configured.";

  return {
    name: "subagent",
    description:
      `Spawn an isolated sub-agent to handle a focused task. The sub-agent runs as a separate process with its own context window, tools, and system prompt. Use this for tasks that benefit from an isolated context.` +
      agentDesc,
    parameters: SubAgentParams,
    // Sub-agents are isolated child processes (own cwd, context, and PID), so
    // they're safe to run concurrently — unlike bash/edit/write, which mutate
    // shared local state. Parallel lets the model fan out 3+ sub-agents in one
    // turn. NOTE: the loop serializes the WHOLE batch if any call is
    // sequential, so this only fans out when every call in the turn is parallel.
    executionMode: "parallel",
    async execute(args, context) {
      if (isPlanModeActive(planModeRef)) {
        return planModeRestriction("subagent");
      }

      const startTime = Date.now();

      // Resolve agent definition if specified
      let agentDef: AgentDefinition | undefined;
      if (args.agent) {
        agentDef = agents.find((a) => a.name.toLowerCase() === args.agent!.toLowerCase());
        if (!agentDef) {
          return {
            content: `Unknown agent: "${args.agent}". Available agents: ${agents.map((a) => a.name).join(", ") || "none"}`,
          };
        }
      }

      const useProvider = getParentProvider();
      // Read-only scouts (recon/research) run on the provider's fast/cheap model
      // — lower TTFT + spend, no quality risk since they never edit code.
      // Agents that can write, and default (unnamed) sub-agents, keep the
      // parent model.
      const parentModel = getParentModel();
      const useModel = isReadOnlyAgent(agentDef)
        ? getFastModel(useProvider as Provider, parentModel).id
        : parentModel;

      // Build CLI args — limit turns to prevent runaway context growth
      const cliArgs: string[] = [
        "--json",
        "--provider",
        useProvider,
        "--model",
        useModel,
        "--max-turns",
        String(SUB_AGENT_MAX_TURNS),
      ];

      // Inherit parent's cache-routing key so all sub-agents in one parent run
      // share the same prompt_cache_key prefix instead of each spawning with a
      // fresh sessionId-derived key (cold cache every time). Suffix the key so
      // the parent and its sub-agents route to distinct shards but each share
      // among themselves.
      const parentCacheKey = getParentCacheKey?.();
      if (parentCacheKey) {
        cliArgs.push("--prompt-cache-key", `${parentCacheKey}:subagent`);
      }

      if (agentDef?.systemPrompt) {
        cliArgs.push("--system-prompt", agentDef.systemPrompt);
      }

      // Forward the agent's declared tool allow-list to the child so its tool
      // set is filtered to exactly these names (see AgentSession.allowedTools).
      // Empty/unset → the child keeps the full toolset (backward compatible),
      // so agents with no `tools:` frontmatter behave exactly as before.
      if (agentDef?.tools && agentDef.tools.length > 0) {
        cliArgs.push("--tools", agentDef.tools.join(","));
      }

      cliArgs.push(args.task);

      // Spawn the ggcoder CLI as a child process. We must run the CLI entry
      // (dist/cli.js, the JSON-mode agent runner), NOT process.argv[1]: in the
      // desktop app the host process is app-sidecar.js, which ignores CLI args
      // and just boots another HTTP server — the sub-agent would then emit no
      // NDJSON and hang until the hard timeout. cli.js sits one level up from
      // this module (dist/tools/subagent.js → dist/cli.js); fall back to
      // argv[1] only if that resolution somehow misses.
      const child = spawn(process.execPath, [resolveCliEntry(), ...cliArgs], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      // Track progress
      let toolUseCount = 0;
      const tokenUsage = { input: 0, output: 0 };
      const cacheTotals = { read: 0, write: 0 };
      let turnCount = 0;
      let currentActivity: string | undefined;
      let textOutput = "";
      // Set when the child emits the terminal `max_turns` signal — the sub-agent
      // hit its turn budget mid-task, so its final answer may be incomplete. We
      // prepend a notice to the returned content so the parent doesn't treat a
      // cut-off run as a finished one.
      let hitMaxTurns = false;
      let maxTurnsLimit = 0;

      // Mirror the child sub-agent's cache key into the parent log so
      // `grep cacheRead ~/.gg/debug.log` shows whether sub-agents are
      // hitting the cache. JSON mode in the child has no logger of its
      // own (concurrent writes would corrupt the shared file), so the
      // parent is the only place this can be observed.
      const subCacheKey = parentCacheKey ? `${parentCacheKey}:subagent` : "(unset)";
      log("INFO", "subagent", "Sub-agent spawn", {
        cacheKey: subCacheKey,
        provider: useProvider,
        model: useModel,
        agent: agentDef?.name ?? "(default)",
      });

      // Track whether the child has actually exited
      let childExited = false;

      const killChild = () => {
        if (childExited) return;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!childExited) child.kill("SIGKILL");
        }, 3000);
      };

      // Handle abort signal
      const abortHandler = () => killChild();
      context.signal.addEventListener("abort", abortHandler, { once: true });

      // If already aborted (e.g. reset happened before we got here), kill immediately
      if (context.signal.aborted) killChild();

      return new Promise((resolve) => {
        // Hard timeout to prevent subagents from hanging indefinitely
        const timeout = setTimeout(() => {
          killChild();
        }, SUB_AGENT_TIMEOUT_MS);
        // Read NDJSON from stdout
        const rl = createInterface({ input: child.stdout! });
        rl.on("line", (line) => {
          try {
            const event = JSON.parse(line);
            const type = event.type as string;
            switch (type) {
              case "text_delta":
                // Cap accumulation to ~2x the truncation limit (keeps tail for truncateTail)
                if (textOutput.length < SUB_AGENT_MAX_OUTPUT_CHARS * 2) {
                  textOutput += event.text;
                } else if (!textOutput.endsWith("[output capped]")) {
                  textOutput += "\n[output capped]";
                }
                break;
              case "tool_call_start":
                toolUseCount++;
                currentActivity = formatToolActivity(
                  event.name as string,
                  event.args as Record<string, unknown>,
                );
                context.onUpdate?.({
                  toolUseCount,
                  tokenUsage: { ...tokenUsage },
                  currentActivity,
                });
                break;
              case "tool_call_end":
                break;
              case "max_turns":
                hitMaxTurns = true;
                maxTurnsLimit = Number(event.maxTurns) || SUB_AGENT_MAX_TURNS;
                break;
              case "turn_end": {
                const usage = event.usage as
                  | {
                      inputTokens: number;
                      outputTokens: number;
                      cacheRead?: number;
                      cacheWrite?: number;
                    }
                  | undefined;
                if (usage) {
                  tokenUsage.input += usage.inputTokens;
                  tokenUsage.output += usage.outputTokens;
                  if (usage.cacheRead) cacheTotals.read += usage.cacheRead;
                  if (usage.cacheWrite) cacheTotals.write += usage.cacheWrite;
                  turnCount++;
                  // Per-turn line lets you eyeball cache health turn-by-turn
                  // when debugging a runaway sub-agent. The aggregate sum on
                  // close is also useful but hides the curve.
                  log("INFO", "subagent", "Sub-agent turn", {
                    turn: turnCount,
                    inputTokens: String(usage.inputTokens),
                    outputTokens: String(usage.outputTokens),
                    ...(usage.cacheRead != null && { cacheRead: String(usage.cacheRead) }),
                    ...(usage.cacheWrite != null && { cacheWrite: String(usage.cacheWrite) }),
                  });
                }
                context.onUpdate?.({
                  toolUseCount,
                  tokenUsage: { ...tokenUsage },
                  currentActivity,
                });
                break;
              }
            }
          } catch {
            // Skip malformed lines
          }
        });

        // Collect stderr (capped to prevent unbounded memory growth)
        let stderr = "";
        child.stderr?.on("data", (chunk: Buffer) => {
          if (stderr.length < SUB_AGENT_MAX_STDERR_CHARS) {
            stderr += chunk.toString();
            if (stderr.length > SUB_AGENT_MAX_STDERR_CHARS) {
              stderr = stderr.slice(0, SUB_AGENT_MAX_STDERR_CHARS);
            }
          }
        });

        child.on("close", (code) => {
          childExited = true;
          clearTimeout(timeout);
          rl.close();
          context.signal.removeEventListener("abort", abortHandler);
          const durationMs = Date.now() - startTime;
          const details: SubAgentDetails = {
            toolUseCount,
            tokenUsage: { ...tokenUsage },
            durationMs,
          };

          // Roll-up. Total cacheRead vs cumulative input shows whether the
          // cache key propagation actually saved tokens — read this number,
          // not the raw input sum, to judge regressions.
          log("INFO", "subagent", "Sub-agent done", {
            durationMs: String(durationMs),
            turns: String(turnCount),
            toolUseCount: String(toolUseCount),
            inputTokens: String(tokenUsage.input),
            outputTokens: String(tokenUsage.output),
            cacheRead: String(cacheTotals.read),
            cacheWrite: String(cacheTotals.write),
            exitCode: String(code),
          });

          if (code !== 0 && !textOutput) {
            resolve({
              content: `Sub-agent failed (exit ${code}): ${stderr.trim() || "unknown error"}`,
              details,
            });
            return;
          }

          // Truncate output to prevent blowing up parent's context
          const raw = textOutput || "(no output)";
          const result = truncateTail(raw, SUB_AGENT_MAX_OUTPUT_LINES, SUB_AGENT_MAX_OUTPUT_CHARS);
          const body = result.truncated
            ? `[Sub-agent output truncated: ${result.totalLines} total lines, showing last ${result.keptLines}]\n\n` +
              result.content
            : result.content;
          // Prepend the cut-off notice so the parent knows this run stopped
          // mid-task and shouldn't be trusted as a completed result.
          const content = hitMaxTurns
            ? `[Sub-agent reached its ${maxTurnsLimit}-turn limit — it stopped mid-task and this output may be incomplete.]\n\n${body}`
            : body;

          resolve({ content, details });
        });

        child.on("error", (err) => {
          childExited = true;
          clearTimeout(timeout);
          rl.close();
          context.signal.removeEventListener("abort", abortHandler);
          resolve({
            content: `Failed to spawn sub-agent: ${err.message}`,
          });
        });
      });
    },
  };
}

/** Build a short, human-readable activity string for a sub-agent tool call. */
function formatToolActivity(name: string, args: Record<string, unknown>): string {
  // Extract the most meaningful short value for common tools
  switch (name) {
    case "read":
      return `Reading ${shortenPath(String(args.file_path ?? ""))}`;
    case "write":
      return `Writing ${shortenPath(String(args.file_path ?? ""))}`;
    case "edit":
      return `Editing ${shortenPath(String(args.file_path ?? ""))}`;
    case "grep": {
      const pat = String(args.pattern ?? "");
      return `Searching for "${truncateStr(pat, 30)}"`;
    }
    case "find": {
      const pat = String(args.pattern ?? "");
      return `Finding "${truncateStr(pat, 30)}"`;
    }
    case "ls":
      return `Listing ${shortenPath(String(args.path ?? "."))}`;
    case "bash": {
      const cmd = String(args.command ?? "").split("\n")[0];
      return `Running ${truncateStr(cmd, 35)}`;
    }
    case "web_fetch":
      return `Fetching ${truncateStr(String(args.url ?? ""), 35)}`;
    case "source_path":
      return `Resolving source for ${truncateStr(String(args.package ?? ""), 30)}`;
    case "task_output":
      return `Reading task output ${truncateStr(String(args.id ?? ""), 20)}`;
    case "task_stop":
      return `Stopping task ${truncateStr(String(args.id ?? ""), 20)}`;
    case "web_search":
      return `Searching web for ${truncateStr(String(args.query ?? ""), 30)}`;
    case "skill":
      return `Loading skill ${truncateStr(String(args.skill ?? ""), 30)}`;
    default: {
      // MCP or unknown tools — show name + first short arg value
      const firstVal = Object.values(args).find((v) => typeof v === "string" && v.length > 0);
      const detail = firstVal ? truncateStr(String(firstVal), 30) : "";
      return detail ? `${name}: ${detail}` : name;
    }
  }
}

function shortenPath(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 3) return filePath;
  return "…/" + parts.slice(-2).join("/");
}

function truncateStr(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
