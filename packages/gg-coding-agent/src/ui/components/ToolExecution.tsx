import React from "react";
import { Text, Box } from "ink";
import { useTheme } from "../theme/theme.js";
import { Spinner } from "./Spinner.js";
import { highlightCode, langFromPath } from "../utils/highlight.js";

const MAX_OUTPUT_LINES = 8;

interface ToolRunningProps {
  status: "running";
  name: string;
  args: Record<string, unknown>;
}

interface ToolDoneProps {
  status: "done";
  name: string;
  args: Record<string, unknown>;
  result: string;
  isError: boolean;
}

type ToolExecutionProps = ToolRunningProps | ToolDoneProps;

export function ToolExecution(props: ToolExecutionProps) {
  const theme = useTheme();

  if (props.status === "running") {
    const { label, detail } = getToolHeaderParts(props.name, props.args);
    return (
      <Box marginTop={1}>
        <Spinner label={detail ? `${label}(${detail})` : label} />
      </Box>
    );
  }

  const { name, args, result, isError } = props;
  const isDiff = name === "edit" && !isError && result.includes("---");

  const { label, detail } = getToolHeaderParts(name, args);
  const body = isDiff ? buildDiffBody(result, args) : buildResultBody(name, result, isError, args);

  const headerColor = isError ? theme.toolError : theme.toolName;

  // Compact display — no body to show, but show inline summary
  if (!body) {
    const inline = getInlineSummary(name, result, isError);
    return (
      <Box marginTop={1} flexShrink={1}>
        <Text>
          <Text color={theme.primary}>{"⏺ "}</Text>
          <Text bold color={headerColor}>
            {label}
          </Text>
          {detail && (
            <Text color={theme.text}>
              {"("}
              {detail}
              {")"}
            </Text>
          )}
          {inline && <Text color={theme.textDim}> {inline}</Text>}
        </Text>
      </Box>
    );
  }

  const { lines, totalLines } = body;
  const hiddenCount = totalLines - lines.length;

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Header */}
      <Box>
        <Text>
          <Text color={theme.primary}>{"⏺ "}</Text>
          <Text bold color={headerColor}>
            {label}
          </Text>
          {detail && (
            <Text color={theme.text}>
              {"("}
              {detail}
              {")"}
            </Text>
          )}
        </Text>
      </Box>
      {/* Body with ⎿ connector */}
      <Box flexDirection="column" paddingLeft={2}>
        {lines.map((line, i) => (
          <Box key={i}>
            <Text color={theme.textDim}>{i === 0 ? "⎿  " : "   "}</Text>
            <Box flexShrink={1}>{line}</Box>
          </Box>
        ))}
        {hiddenCount > 0 && (
          <Box>
            <Text color={theme.textDim}>
              {"   … +"}
              {hiddenCount} lines
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ── Header formatting ──────────────────────────────────────

function shortenPath(filePath: string): string {
  // Show last 2 path segments max, e.g. "src/components/App.tsx"
  const parts = filePath.split("/");
  if (parts.length <= 3) return filePath;
  return "…/" + parts.slice(-2).join("/");
}

function getToolHeaderParts(
  name: string,
  args: Record<string, unknown>,
): { label: string; detail: string } {
  const displayName = toolDisplayName(name);
  switch (name) {
    case "bash": {
      const cmd = String(args.command ?? "");
      const firstLine = cmd.split("\n")[0];
      const truncCmd = firstLine.length > 60 ? firstLine.slice(0, 57) + "…" : firstLine;
      const multiline = cmd.includes("\n");
      return { label: displayName, detail: `${truncCmd}${multiline ? " …" : ""}` };
    }
    case "edit":
      return { label: displayName, detail: shortenPath(String(args.file_path ?? "")) };
    case "write":
      return { label: displayName, detail: shortenPath(String(args.file_path ?? "")) };
    case "read":
      return { label: "Read", detail: shortenPath(String(args.file_path ?? "")) };
    case "grep": {
      const pat = String(args.pattern ?? "");
      return { label: displayName, detail: pat.length > 40 ? pat.slice(0, 37) + "…" : pat };
    }
    case "find": {
      const pat = String(args.pattern ?? "");
      return { label: displayName, detail: pat.length > 40 ? pat.slice(0, 37) + "…" : pat };
    }
    case "ls":
      return { label: displayName, detail: shortenPath(String(args.path ?? ".")) };
    case "subagent": {
      const task = String(args.task ?? "");
      const trunc = task.length > 50 ? task.slice(0, 47) + "…" : task;
      return { label: displayName, detail: trunc };
    }
    default:
      return { label: displayName, detail: "" };
  }
}

function toolDisplayName(name: string): string {
  switch (name) {
    case "bash":
      return "Bash";
    case "read":
      return "Read";
    case "write":
      return "Write";
    case "edit":
      return "Update";
    case "grep":
      return "Search";
    case "find":
      return "Find";
    case "ls":
      return "List";
    case "subagent":
      return "Agent";
    default:
      return name.charAt(0).toUpperCase() + name.slice(1);
  }
}

// ── Inline summary for compact tools ───────────────────────

function getInlineSummary(name: string, result: string, isError: boolean): string {
  if (isError) {
    const firstLine = result.split("\n")[0];
    return firstLine.length > 60 ? firstLine.slice(0, 57) + "…" : firstLine;
  }
  switch (name) {
    case "read": {
      const lines = result.split("\n").filter((l) => l.length > 0);
      return `${lines.length} line${lines.length !== 1 ? "s" : ""}`;
    }
    case "write": {
      const firstLine = result.split("\n")[0];
      return firstLine;
    }
    case "bash": {
      const match = result.match(/^Exit code: (.+)/);
      return match ? `exit ${match[1]}` : "done";
    }
    case "subagent":
      return "completed";
    default:
      return "";
  }
}

// ── Body builders ──────────────────────────────────────────

interface BodyContent {
  lines: React.ReactNode[];
  totalLines: number;
}

interface NumberedDiffLine {
  type: "add" | "remove" | "context";
  lineNo: number;
  content: string;
}

function parseDiffWithLineNumbers(result: string): NumberedDiffLine[] {
  const allLines = result.split("\n");
  const diffLines = allLines.filter(
    (l) => !l.startsWith("---") && !l.startsWith("+++") && !l.startsWith("@@"),
  );

  const numbered: NumberedDiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const line of diffLines) {
    const prefix = line[0];
    const content = line.slice(1);

    if (prefix === "+") {
      numbered.push({ type: "add", lineNo: newLine, content });
      newLine++;
    } else if (prefix === "-") {
      numbered.push({ type: "remove", lineNo: oldLine, content });
      oldLine++;
    } else {
      numbered.push({ type: "context", lineNo: newLine, content });
      oldLine++;
      newLine++;
    }
  }

  return numbered;
}

function buildDiffBody(result: string, args?: Record<string, unknown>): BodyContent {
  const added = (result.match(/^\+[^+]/gm) ?? []).length;
  const removed = (result.match(/^-[^-]/gm) ?? []).length;

  const summaryText = `Added ${added} line${added !== 1 ? "s" : ""}, removed ${removed} line${removed !== 1 ? "s" : ""}`;

  const numbered = parseDiffWithLineNumbers(result);
  const firstChangeIdx = numbered.findIndex((l) => l.type !== "context");
  const lastChangeIdx =
    numbered.length - 1 - [...numbered].reverse().findIndex((l) => l.type !== "context");
  const startIdx = Math.max(0, firstChangeIdx - 2);
  const endIdx = Math.min(numbered.length, lastChangeIdx + 3);
  const focused = numbered.slice(startIdx, endIdx);

  // Highlight context lines using file extension
  const filePath = String(args?.file_path ?? "");
  const lang = langFromPath(filePath);
  const highlighted = focused.map((line) =>
    line.type === "context" ? { ...line, content: highlightCode(line.content, lang) } : line,
  );

  const maxLineNo = highlighted.reduce((m, l) => Math.max(m, l.lineNo), 0);
  const padWidth = String(maxLineNo).length;

  const displayLines = highlighted.slice(0, MAX_OUTPUT_LINES);
  const rendered = displayLines.map((line, i) => (
    <DiffLine key={i} line={line} padWidth={padWidth} />
  ));

  return {
    lines: [
      <Text key="summary" color="#9ca3af">
        {summaryText}
      </Text>,
      ...rendered,
    ],
    totalLines: focused.length + 1,
  };
}

function buildResultBody(
  name: string,
  result: string,
  isError: boolean,
  args?: Record<string, unknown>,
): BodyContent | null {
  if (isError) {
    const lines = result.split("\n");
    const display = lines.slice(0, MAX_OUTPUT_LINES);
    return {
      lines: display.map((l, i) => (
        <Text key={i} color="#f87171">
          {l}
        </Text>
      )),
      totalLines: lines.length,
    };
  }

  switch (name) {
    case "bash": {
      const allLines = result.split("\n");
      // Check exit code
      const exitMatch = allLines[0]?.match(/^Exit code: (.+)/);
      const exitCode = exitMatch ? exitMatch[1].trim() : "0";
      const outputLines = allLines.slice(1).filter((l) => l.length > 0);
      if (outputLines.length === 0) return null;
      const display = outputLines.slice(0, MAX_OUTPUT_LINES);
      return {
        lines: display.map((l, i) => (
          <Text key={i} color={exitCode !== "0" ? "#fbbf24" : "#9ca3af"}>
            {l}
          </Text>
        )),
        totalLines: outputLines.length,
      };
    }
    case "read":
      return null;
    case "write": {
      const allLines = result.split("\n");
      const summary = allLines[0]; // "Wrote 12 lines to random-info.md"
      let contentLines = allLines.slice(1);
      // Trim trailing empty line from content that ends with \n
      if (contentLines.length > 0 && contentLines[contentLines.length - 1] === "") {
        contentLines = contentLines.slice(0, -1);
      }
      if (contentLines.length === 0) return null;
      // Highlight the full content, then split back into lines
      const filePath = String(args?.file_path ?? "");
      const lang = langFromPath(filePath);
      const rawContent = contentLines.join("\n");
      const highlighted = highlightCode(rawContent, lang);
      const hlLines = highlighted.split("\n");
      const displayLines = hlLines.slice(0, MAX_OUTPUT_LINES);
      const padWidth = String(contentLines.length).length;
      return {
        lines: [
          <Text key="summary" color="#9ca3af">
            {summary}
          </Text>,
          ...displayLines.map((line, i) => (
            <WrittenLine key={i + 1} lineNo={i + 1} content={line} padWidth={padWidth} />
          )),
        ],
        totalLines: 1 + contentLines.length, // summary + all content lines
      };
    }
    case "grep": {
      const lines = result.split("\n").filter((l) => l.length > 0);
      if (lines.length === 0 || result === "No matches found.") return null;
      const display = lines.slice(0, MAX_OUTPUT_LINES);
      return {
        lines: display.map((l, i) => <GrepLine key={i} line={l} />),
        totalLines: lines.length,
      };
    }
    case "find": {
      const lines = result.split("\n").filter((l) => l.length > 0);
      if (lines.length === 0) return null;
      const display = lines.slice(0, MAX_OUTPUT_LINES);
      return {
        lines: display.map((l, i) => <FindLine key={i} line={l} />),
        totalLines: lines.length,
      };
    }
    case "ls": {
      const lines = result.split("\n").filter((l) => l.length > 0);
      if (lines.length === 0) return null;
      const display = lines.slice(0, MAX_OUTPUT_LINES);
      return {
        lines: display.map((l, i) => <LsLine key={i} line={l} />),
        totalLines: lines.length,
      };
    }
    case "subagent": {
      const lines = result.split("\n").filter((l) => l.length > 0);
      if (lines.length === 0) return null;
      const display = lines.slice(0, MAX_OUTPUT_LINES);
      return {
        lines: display.map((l, i) => (
          <Text key={i} color="#9ca3af">
            {l}
          </Text>
        )),
        totalLines: lines.length,
      };
    }
    default:
      return null;
  }
}

// ── Diff line component ────────────────────────────────────

function DiffLine({ line, padWidth }: { line: NumberedDiffLine; padWidth: number }) {
  const lineNo = String(line.lineNo).padStart(padWidth, " ");

  if (line.type === "add") {
    return (
      <Text backgroundColor="#16a34a" color="#ffffff">
        {lineNo}
        {"  "}
        {line.content}
      </Text>
    );
  }
  if (line.type === "remove") {
    return (
      <Text backgroundColor="#dc2626" color="#ffffff">
        {lineNo}
        {"  "}
        {line.content}
      </Text>
    );
  }
  return (
    <Text>
      <Text color="#6b7280">
        {lineNo}
        {"  "}
      </Text>
      {line.content}
    </Text>
  );
}

// ── Written line component ─────────────────────────────────

function WrittenLine({
  lineNo,
  content,
  padWidth,
}: {
  lineNo: number;
  content: string;
  padWidth: number;
}) {
  const num = String(lineNo).padStart(padWidth, " ");
  return (
    <Text>
      <Text color="#6b7280">{num} </Text>
      {content}
    </Text>
  );
}

// ── Grep result line ───────────────────────────────────────

function GrepLine({ line }: { line: string }) {
  // Format: filepath:lineNo:content
  const firstColon = line.indexOf(":");
  if (firstColon === -1) return <Text color="#9ca3af">{line}</Text>;

  const secondColon = line.indexOf(":", firstColon + 1);
  if (secondColon === -1) return <Text color="#9ca3af">{line}</Text>;

  const file = line.slice(0, firstColon);
  const lineNo = line.slice(firstColon + 1, secondColon);
  const content = line.slice(secondColon + 1);

  return (
    <Text>
      <Text color="#60a5fa">{file}</Text>
      <Text color="#6b7280">:</Text>
      <Text color="#fbbf24">{lineNo}</Text>
      <Text color="#6b7280">:</Text>
      <Text color="#9ca3af">{content}</Text>
    </Text>
  );
}

// ── Find result line ───────────────────────────────────────

function FindLine({ line }: { line: string }) {
  const trimmed = line.trim();
  if (trimmed.endsWith("/")) {
    return <Text color="#60a5fa">{trimmed}</Text>;
  }
  // Highlight the filename, dim the path
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash === -1) {
    return <Text color="#e5e7eb">{trimmed}</Text>;
  }
  return (
    <Text>
      <Text color="#6b7280">{trimmed.slice(0, lastSlash + 1)}</Text>
      <Text color="#e5e7eb">{trimmed.slice(lastSlash + 1)}</Text>
    </Text>
  );
}

// ── Ls result line ─────────────────────────────────────────

function LsLine({ line }: { line: string }) {
  // Format: "d  -        dirname/" or "f  1.2K     filename"
  const parts = line.match(/^([dfl])\s+(\S+)\s+(.+)$/);
  if (!parts) return <Text color="#9ca3af">{line}</Text>;

  const [, type, size, name] = parts;

  if (type === "d") {
    return (
      <Text>
        <Text color="#60a5fa" bold>
          {name}
        </Text>
        <Text color="#6b7280"> {size === "-" ? "" : size}</Text>
      </Text>
    );
  }
  // File or symlink
  return (
    <Text>
      <Text color="#e5e7eb">{name}</Text>
      <Text color="#6b7280"> {size}</Text>
    </Text>
  );
}
