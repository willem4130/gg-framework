import fs from "node:fs/promises";
import path from "node:path";
import { getAppPaths } from "@kenkaiiii/ggcoder";
import type { Provider, ThinkingLevel } from "@kenkaiiii/gg-ai";

export interface BossSettings {
  bossProvider?: Provider;
  bossModel?: string;
  bossThinkingLevel?: ThinkingLevel;
  workerProvider?: Provider;
  workerModel?: string;
}

function settingsPath(): string {
  return path.join(getAppPaths().agentDir, "boss", "settings.json");
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true, mode: 0o700 });
}

export async function loadSettings(): Promise<BossSettings> {
  try {
    const content = await fs.readFile(settingsPath(), "utf-8");
    const parsed = JSON.parse(content) as BossSettings;
    if (!parsed || typeof parsed !== "object") return {};
    // Legacy "max" → "xhigh" rename for thinking levels.
    if ((parsed.bossThinkingLevel as unknown) === "max") parsed.bossThinkingLevel = "xhigh";
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Atomic write — write to .tmp then rename. Mirrors tasks-store's pattern;
 * model swaps from /model and /worker-model can fire close together when the
 * user is reconfiguring quickly.
 */
let writeChain: Promise<void> = Promise.resolve();

export async function saveSettings(patch: BossSettings): Promise<void> {
  const next = writeChain.then(async () => {
    const current = await loadSettings();
    const merged: BossSettings = { ...current, ...patch };
    await ensureDir();
    const tmp = `${settingsPath()}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(merged, null, 2) + "\n", "utf-8");
    await fs.rename(tmp, settingsPath());
  });
  writeChain = next.catch(() => undefined);
  await next;
}
