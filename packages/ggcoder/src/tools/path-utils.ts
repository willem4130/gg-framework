import path from "node:path";
import os from "node:os";

export function resolvePath(cwd: string, filePath: string): string {
  if (filePath.startsWith("~")) {
    filePath = path.join(os.homedir(), filePath.slice(1));
  }
  return path.resolve(cwd, filePath);
}
