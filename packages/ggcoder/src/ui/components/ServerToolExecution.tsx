import React from "react";
import { Text, Box } from "ink";
import { useTheme } from "../theme/theme.js";
import { Spinner } from "./Spinner.js";

const MAX_RESULT_LINES = 6;

interface WebSearchResult {
  type?: string;
  title?: string;
  url?: string;
}

interface ServerToolRunningProps {
  status: "running";
  name: string;
  input: unknown;
}

interface ServerToolDoneProps {
  status: "done";
  name: string;
  input: unknown;
  resultType: string;
  data: unknown;
}

type ServerToolExecutionProps = ServerToolRunningProps | ServerToolDoneProps;

export function ServerToolExecution(props: ServerToolExecutionProps) {
  const theme = useTheme();
  const { label, detail } = getHeader(props.name, props.input);

  if (props.status === "running") {
    return (
      <Box marginTop={1}>
        <Spinner label={detail ? `${label}(${detail})` : label} />
      </Box>
    );
  }

  const results = getSearchResults(props.resultType, props.data);

  // Compact display — no results to show
  if (!results || results.length === 0) {
    return (
      <Box marginTop={1} flexShrink={1}>
        <Text>
          <Text color={theme.primary}>{"⏺ "}</Text>
          <Text bold color={theme.toolName}>
            {label}
          </Text>
          {detail && (
            <Text color={theme.text}>
              {"("}
              {detail}
              {")"}
            </Text>
          )}
          <Text color={theme.textDim}> no results</Text>
        </Text>
      </Box>
    );
  }

  const display = results.slice(0, MAX_RESULT_LINES);
  const hiddenCount = results.length - display.length;

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Header */}
      <Box>
        <Text>
          <Text color={theme.primary}>{"⏺ "}</Text>
          <Text bold color={theme.toolName}>
            {label}
          </Text>
          {detail && (
            <Text color={theme.text}>
              {"("}
              {detail}
              {")"}
            </Text>
          )}
          <Text color={theme.textDim}>
            {" "}
            {results.length} result{results.length !== 1 ? "s" : ""}
          </Text>
        </Text>
      </Box>
      {/* Body with ⎿ connector */}
      <Box flexDirection="column" paddingLeft={2}>
        {display.map((r, i) => (
          <Box key={i}>
            <Text color={theme.textDim}>{i === 0 ? "⎿  " : "   "}</Text>
            <Text>
              <Text color={theme.text}>{truncate(r.title ?? "", 60)}</Text>
              {r.url && <Text color={theme.textDim}> ({extractDomain(r.url)})</Text>}
            </Text>
          </Box>
        ))}
        {hiddenCount > 0 && (
          <Box>
            <Text color={theme.textDim}>
              {"   … +"}
              {hiddenCount} more
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function getHeader(name: string, input: unknown): { label: string; detail: string } {
  const inp = (input ?? {}) as Record<string, unknown>;
  if (name === "web_search") {
    const query = String(inp.query ?? "");
    const trunc = query.length > 50 ? query.slice(0, 47) + "…" : query;
    return { label: "Web Search", detail: trunc };
  }
  return { label: name, detail: "" };
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function getSearchResults(resultType: string, data: unknown): WebSearchResult[] | null {
  if (resultType !== "web_search_tool_result") return null;

  const raw = data as Record<string, unknown>;
  const content = raw.content as WebSearchResult[] | undefined;
  if (!Array.isArray(content)) return null;

  return content.filter((item) => item.type === "web_search_result" && item.title);
}
