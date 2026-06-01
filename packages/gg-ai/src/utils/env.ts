/**
 * Read the process environment without assuming a Node global exists (gg-ai
 * runs in Node, Deno, browsers, and Workers). Returns `undefined` when no
 * `process.env` is available.
 */
export function getEnvironment(): Record<string, string | undefined> | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
}
