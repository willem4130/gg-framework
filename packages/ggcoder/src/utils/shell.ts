import path from "node:path";

export function resolveShell(): string {
  return process.env.SHELL ?? "/bin/bash";
}

export function getShellName(shellPath?: string): string {
  return path.basename(shellPath ?? resolveShell());
}
