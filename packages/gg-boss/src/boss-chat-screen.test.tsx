import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./boss-chat-screen.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("./orchestrator-app.tsx", import.meta.url), "utf8");

describe("BossChatScreen", () => {
  it("keeps GG Coder chat layout order", () => {
    const layout = source.indexOf("<ChatLayout");
    const banner = source.indexOf("{bannerPane}");
    const history = source.indexOf("{historyPane}");
    const live = source.indexOf("{livePane}");
    const controls = source.indexOf("<ChatControls");
    const stack = source.indexOf("<ChatInputStack");
    const input = source.indexOf("<InputArea");
    const footer = source.indexOf("<BossFooter");
    const workerStatus = source.indexOf("<BossWorkerStatusRow");

    expect(layout).toBeGreaterThanOrEqual(0);
    expect(banner).toBeGreaterThan(layout);
    expect(history).toBeGreaterThan(banner);
    expect(live).toBeGreaterThan(history);
    expect(controls).toBeGreaterThan(live);
    expect(stack).toBeGreaterThan(controls);
    expect(input).toBeGreaterThan(stack);
    expect(footer).toBeGreaterThan(input);
    expect(workerStatus).toBeGreaterThan(footer);
  });

  it("passes boss running state into the shared gg-coder input", () => {
    expect(source).toContain("disabled={isRunning}");
    expect(appSource).toContain('isRunning={state.phase === "working"}');
  });

  it("does not install duplicate chat Ctrl+C handlers alongside InputArea", () => {
    expect(appSource).not.toContain('stdin.on("data"');
    expect(appSource).not.toContain("useStdin");
    expect(appSource).toContain('key.ctrl && input === "c" && overlay');
  });
});
