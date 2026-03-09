import { execFile } from "node:child_process";

export function getGitBranch(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd, timeout: 2000 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(stdout.trim() || null);
      },
    );
  });
}
