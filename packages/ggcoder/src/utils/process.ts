/**
 * Kill a process and all its children by sending SIGKILL to the process group.
 * Falls back to killing just the process if process group kill fails.
 */
export function killProcessTree(pid: number): void {
  try {
    // Kill the entire process group (negative pid)
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already exited
    }
  }
}
