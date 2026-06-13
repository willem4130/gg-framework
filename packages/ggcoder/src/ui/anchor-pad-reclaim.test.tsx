// Reproduction of the "large white space right before the final response".
//
// While the agent runs, the patched ink's bottom anchor converts every frame
// SHRINK into pad debt — blank lines emitted above the frame so the footer
// never moves up. That is correct mid-run: the next scrollback insert
// overwrites the pads (cursor-up consume). But when the RUN ENDS right after
// a shrink (live tool panel collapse, intermediate rows removed without a
// compensating insert), the leftover pads have nothing left to consume them:
// the anchor deactivates 500ms later and the blank block stays on screen,
// sitting exactly between the flushed transcript and the live final response.
//
// This test drives the real patched ink through that sequence and asserts the
// anchor deactivation reclaims the leftover pads (no blank gap above the
// frame, footer still bottom-pinned).
import React from "react";
import { Box, render, Text } from "ink";
import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";
import { ScreenRecorder, makeRecordingStdout } from "./testing/screen-recorder.js";

const COLUMNS = 60;
const ROWS = 24;

const FOOTER = "SIM_FOOTER_BOTTOM";
const FRAME_TOP = "SIM_FRAME_TOP";

function Frame({ liveRows }: { liveRows: number }) {
  return (
    <Box flexDirection="column" width={COLUMNS}>
      <Text>{FRAME_TOP}</Text>
      {Array.from({ length: liveRows }, (_, i) => (
        <Text key={i}>SIM_LIVE_{i + 1}</Text>
      ))}
      <Text>SIM_INPUT</Text>
      <Text>{FOOTER}</Text>
    </Box>
  );
}

interface PatchedInstance {
  insertBeforeFrame?: (data: string) => void;
  setFrameAnchorActive?: (active: boolean) => void;
  setFrameShrinkBackfill?: (fn: (needRows: number) => string | undefined) => void;
  rerender: (node: React.ReactElement) => void;
  unmount: () => void;
}

async function tick(ms = 60): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe("anchor pad reclaim on run end", () => {
  it("leaves no blank gap above the frame after the anchor deactivates", async () => {
    const recorder = new ScreenRecorder({ columns: COLUMNS, rows: ROWS });
    const stdout = makeRecordingStdout(recorder);

    const transcriptRows = Array.from({ length: ROWS }, (_, i) => `SIM_HISTORY_${i + 1}`);

    const mounted = render(<Frame liveRows={2} />, {
      stdout,
      patchConsole: false,
      maxFps: 1000,
      // Mirror renderApp's INK_OPTIONS — the pad/anchor machinery is opt-in.
      anchorFrameToBottom: true,
      clipFrameToTerminalHeight: true,
    } as Parameters<typeof render>[1]) as unknown as PatchedInstance;

    // Skip cleanly when running against unpatched ink (the APIs are fork-only).
    if (!mounted.setFrameAnchorActive || !mounted.insertBeforeFrame) {
      mounted.unmount();
      return;
    }
    // Mirrors renderApp's buildShrinkBackfill: last N transcript rows.
    mounted.setFrameShrinkBackfill?.((needRows: number) => {
      const lines = transcriptRows.slice(-needRows);
      while (lines.length < needRows) lines.unshift("");
      return `${lines.join("\n")}\n`;
    });
    await tick();

    // Turn starts: anchor on, transcript rows flushed to scrollback, live
    // frame grows tall (streamed text + tool rows).
    mounted.setFrameAnchorActive(true);
    mounted.insertBeforeFrame(`${transcriptRows.join("\n")}\n`);
    mounted.rerender(<Frame liveRows={12} />);
    await tick();

    // Finalization shrink: intermediate live rows vanish with NO compensating
    // scrollback insert. The anchor converts the shrink into pad debt — a
    // blank block above the frame (correct mid-run: footer must not move).
    mounted.rerender(<Frame liveRows={2} />);
    await tick();

    // Run ends: App's 500ms timer deactivates the anchor. The leftover pads
    // must be reclaimed here — nothing else will ever consume them at idle.
    mounted.setFrameAnchorActive(false);
    await tick(150);

    const lines = recorder.viewportLines().map((line) => stripAnsi(line));
    const frameTopIdx = lines.findIndex((line) => line.includes(FRAME_TOP));
    const footerIdx = lines.findIndex((line) => line.includes(FOOTER));
    expect(frameTopIdx, "live frame visible").toBeGreaterThanOrEqual(0);
    expect(footerIdx, "footer visible").toBeGreaterThan(frameTopIdx);

    // Nothing below the footer (footer not stranded above blanks).
    const lastNonBlank = lines.reduce((acc, line, i) => (line.trim().length > 0 ? i : acc), -1);
    expect(lastNonBlank, "nothing below the footer").toBe(footerIdx);

    // THE BUG: no blank block above the frame. Every row between the last
    // transcript row above the frame and the frame top must be non-blank.
    const blanksAboveFrame = lines.slice(0, frameTopIdx).filter((line) => line.trim() === "");
    expect(blanksAboveFrame.length, "no blank gap above the live frame").toBe(0);

    mounted.unmount();
  });

  it("reclaims the leftover pads MID-RUN via an off→on pulse (no blank gap during a quiet stretch)", async () => {
    const recorder = new ScreenRecorder({ columns: COLUMNS, rows: ROWS });
    const stdout = makeRecordingStdout(recorder);

    const transcriptRows = Array.from({ length: ROWS }, (_, i) => `SIM_HISTORY_${i + 1}`);

    const mounted = render(<Frame liveRows={2} />, {
      stdout,
      patchConsole: false,
      maxFps: 1000,
      anchorFrameToBottom: true,
      clipFrameToTerminalHeight: true,
    } as Parameters<typeof render>[1]) as unknown as PatchedInstance;

    if (!mounted.setFrameAnchorActive || !mounted.insertBeforeFrame) {
      mounted.unmount();
      return;
    }
    mounted.setFrameShrinkBackfill?.((needRows: number) => {
      const lines = transcriptRows.slice(-needRows);
      while (lines.length < needRows) lines.unshift("");
      return `${lines.join("\n")}\n`;
    });
    await tick();

    // Turn starts: anchor on, transcript flushed, frame grows tall.
    mounted.setFrameAnchorActive(true);
    mounted.insertBeforeFrame(`${transcriptRows.join("\n")}\n`);
    mounted.rerender(<Frame liveRows={12} />);
    await tick();

    // Tool batch finished, frame shrinks with NO compensating insert: pad debt
    // forms (correct mid-run). Then the agent goes quiet (long thinking phase)
    // — nothing grows the frame to consume the pads, so the blank gap lingers.
    mounted.rerender(<Frame liveRows={2} />);
    await tick();

    // App's mid-run debounce fires while the run is STILL active: an off→on
    // pulse. The off transition reclaims the pad debt (gap closes, footer stays
    // pinned); the on transition immediately restores pad protection.
    mounted.setFrameAnchorActive(false);
    mounted.setFrameAnchorActive(true);
    await tick(150);

    const lines = recorder.viewportLines().map((line) => stripAnsi(line));
    const frameTopIdx = lines.findIndex((line) => line.includes(FRAME_TOP));
    const footerIdx = lines.findIndex((line) => line.includes(FOOTER));
    expect(frameTopIdx, "live frame visible").toBeGreaterThanOrEqual(0);
    expect(footerIdx, "footer visible").toBeGreaterThan(frameTopIdx);

    const lastNonBlank = lines.reduce((acc, line, i) => (line.trim().length > 0 ? i : acc), -1);
    expect(lastNonBlank, "nothing below the footer").toBe(footerIdx);

    const blanksAboveFrame = lines.slice(0, frameTopIdx).filter((line) => line.trim() === "");
    expect(blanksAboveFrame.length, "no blank gap above the live frame after mid-run pulse").toBe(
      0,
    );

    // The pulse left the anchor ACTIVE: a further shrink must still pad so the
    // footer does not move UP, proving protection was restored, not disabled.
    mounted.rerender(<Frame liveRows={1} />);
    await tick();
    const afterLines = recorder.viewportLines().map((line) => stripAnsi(line));
    const afterFooterIdx = afterLines.findIndex((line) => line.includes(FOOTER));
    expect(afterFooterIdx, "footer still visible after a post-pulse shrink").toBeGreaterThan(0);
    expect(
      afterFooterIdx,
      "footer did not rise after a post-pulse shrink (anchor still active)",
    ).toBeGreaterThanOrEqual(footerIdx);
    const afterLastNonBlank = afterLines.reduce(
      (acc, line, i) => (line.trim().length > 0 ? i : acc),
      -1,
    );
    expect(afterLastNonBlank, "nothing below the footer after a post-pulse shrink").toBe(
      afterFooterIdx,
    );

    mounted.unmount();
  });
});
