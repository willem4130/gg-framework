import { z } from "zod";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import type { ProcessManager } from "../core/process-manager.js";
import { truncateTail } from "./truncate.js";

const TaskOutputParams = z.object({
  id: z.string().describe("The background process ID"),
  from_start: z
    .boolean()
    .optional()
    .describe("If true, read output from the beginning instead of incrementally"),
});

export function createTaskOutputTool(
  processManager: ProcessManager,
): AgentTool<typeof TaskOutputParams> {
  return {
    name: "task_output",
    description:
      "Read output from a background process. Returns new output since last read by default. " +
      "Use from_start=true to read from the beginning.",
    parameters: TaskOutputParams,
    async execute({ id, from_start }) {
      const result = await processManager.readOutput(id, from_start);

      const status = result.isRunning ? "running" : `exited (code ${result.exitCode})`;

      let output = result.output;
      if (output) {
        const truncated = truncateTail(output);
        output = truncated.truncated
          ? `[Truncated: showing last ${truncated.keptLines} of ${truncated.totalLines} lines]\n${truncated.content}`
          : truncated.content;
      } else {
        output = "(no new output)";
      }

      return `Process ${id}: ${status}\n${output}`;
    },
  };
}
