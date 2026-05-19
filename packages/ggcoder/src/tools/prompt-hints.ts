/**
 * One-line prompt hints for each tool. These are shown in the system prompt's
 * Tools section to orient the model. Full parameter docs live on each tool's
 * JSON schema description (sent separately via the tool definition), so these
 * hints stay short and focus on non-obvious usage.
 */
export const TOOL_PROMPT_HINTS: Record<string, string> = {
  read: "Read file contents. Use offset/limit for large files.",
  write: "Create or overwrite files; read existing files first. Prefer edit for changes.",
  edit: "Apply surgical { old_text, new_text } edits from a prior read. Use exact text; retry only failed edits; replace_all for renames.",
  bash: "Run shell commands from project root; use for computation and long/background processes, not direct file rewrites.",
  find: "Find files/dirs by name pattern. Faster than bash find, respects .gitignore.",
  grep: "Regex search across files. Use for usages, definitions, imports.",
  ls: "List directory contents.",
  web_fetch: "Fetch a URL (docs, endpoints, external resources).",
  web_search: "Search the web. Use before web_fetch to find pages.",
  task_output: "Read new output from a background process by id.",
  task_stop: "Stop a background process by id.",
  tasks:
    "Manage the Ctrl+T task pane (add/list/done/remove). Only when the user explicitly asks. Do NOT auto-run.",
  subagent: "Delegate focused, isolated subtasks (research, parallel exploration).",
  skill: "Invoke a named skill for specialized instructions.",
  "mcp__kencode-search__exploreCodeSamples":
    "Explore public code samples for vague goals/examples/best practices. Use once early to discover candidate repos/files and literal anchors; copy 3–5 suggested follow-up searchCode calls before inventing queries. Results are candidates until verified.",
  "mcp__kencode-search__searchCode":
    "Verify public GitHub code by literal text or RE2 regex; NOT semantic. Put code/import/API tokens in `query`; `path` is a literal file-path substring, not a concept. Start broad/peek, then narrow by repo/path. RE2 multi-line needs `(?s)`.",
  enter_plan: "Enter plan mode for read-only research + planning on complex multi-file tasks.",
  exit_plan: "Submit your plan for user review and exit plan mode.",
};

/** Tools always rendered when no explicit tool list is provided. */
export const DEFAULT_TOOL_NAMES: readonly string[] = [
  "read",
  "write",
  "edit",
  "bash",
  "find",
  "grep",
  "ls",
  "web_fetch",
  "task_output",
  "task_stop",
  "tasks",
  "subagent",
  "skill",
  "mcp__kencode-search__exploreCodeSamples",
  "mcp__kencode-search__searchCode",
  "enter_plan",
  "exit_plan",
];
