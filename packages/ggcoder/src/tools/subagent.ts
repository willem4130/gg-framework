import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import type { AgentDefinition } from "../core/agents.js";
import { truncateTail } from "./truncate.js";

const SUB_AGENT_MAX_TURNS = 10;
const SUB_AGENT_MAX_OUTPUT_CHARS = 100_000; // ~25k tokens, matches other tool limits
const SUB_AGENT_MAX_OUTPUT_LINES = 500;
const SUB_AGENT_MAX_STDERR_CHARS = 10_000; // Cap stderr to prevent unbounded growth

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
  parentProvider: string,
  parentModel: string,
): AgentTool<typeof SubAgentParams> {
  const agentList = agents.map((a) => `- ${a.name}: ${a.description}`).join("\n");
  const agentDesc = agentList
    ? `\n\nAvailable named agents:\n${agentList}`
    : "\n\nNo named agents configured.";

  return {
    name: "subagent",
    description:
      `Spawn an isolated sub-agent to handle a focused task. The sub-agent runs as a separate process with its own context window, tools, and system prompt. Use this for tasks that benefit from isolation or parallelism.` +
      agentDesc,
    parameters: SubAgentParams,
    async execute(args, context) {
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

      const useModel = agentDef?.model ?? parentModel;
      const useProvider = parentProvider;

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

      if (agentDef?.systemPrompt) {
        cliArgs.push("--system-prompt", agentDef.systemPrompt);
      }
      cliArgs.push(args.task);

      // Spawn child process using same binary
      const binPath = process.argv[1];
      const child = spawn(process.execPath, [binPath, ...cliArgs], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      // Track progress
      let toolUseCount = 0;
      const tokenUsage = { input: 0, output: 0 };
      let currentActivity: string | undefined;
      let textOutput = "";

      // Handle abort signal
      const abortHandler = () => {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 3000);
      };
      context.signal.addEventListener("abort", abortHandler, { once: true });

      return new Promise((resolve) => {
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
                currentActivity = `${event.name}: ${truncateStr(JSON.stringify(event.args), 60)}`;
                context.onUpdate?.({
                  toolUseCount,
                  tokenUsage: { ...tokenUsage },
                  currentActivity,
                });
                break;
              case "tool_call_end":
                currentActivity = undefined;
                context.onUpdate?.({
                  toolUseCount,
                  tokenUsage: { ...tokenUsage },
                  currentActivity,
                });
                break;
              case "turn_end": {
                const usage = event.usage as
                  | { inputTokens: number; outputTokens: number }
                  | undefined;
                if (usage) {
                  tokenUsage.input += usage.inputTokens;
                  tokenUsage.output += usage.outputTokens;
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
          rl.close();
          context.signal.removeEventListener("abort", abortHandler);
          const durationMs = Date.now() - startTime;
          const details: SubAgentDetails = {
            toolUseCount,
            tokenUsage: { ...tokenUsage },
            durationMs,
          };

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
          const content = result.truncated
            ? `[Sub-agent output truncated: ${result.totalLines} total lines, showing last ${result.keptLines}]\n\n` +
              result.content
            : result.content;

          resolve({ content, details });
        });

        child.on("error", (err) => {
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

function truncateStr(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
