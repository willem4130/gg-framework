import { highlight, supportsLanguage } from "cli-highlight";
import path from "node:path";

/** Map file extension to cli-highlight language name */
const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  sh: "bash",
  zsh: "bash",
  bash: "bash",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  html: "xml",
  xml: "xml",
  css: "css",
  scss: "scss",
  sql: "sql",
  toml: "ini",
  dockerfile: "dockerfile",
};

/** Get language from a file path's extension */
export function langFromPath(filePath: string): string | undefined {
  const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
  return EXT_TO_LANG[ext];
}

/**
 * Syntax-highlight code. Returns ANSI string.
 * Falls back to raw code if language unknown.
 */
export function highlightCode(code: string, language?: string): string {
  if (!language || !supportsLanguage(language)) return code;
  try {
    return highlight(code, { language, ignoreIllegals: true });
  } catch {
    return code;
  }
}
