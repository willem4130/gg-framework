import { spawn, spawnSync } from "node:child_process";
import { wireChildAbort } from "../child-abort.js";

/**
 * Thin ffmpeg/ffprobe wrappers. The agent never invokes ffmpeg directly —
 * tools call these functions, which gives us one place to audit args and
 * cancel running processes.
 */

export interface FfmpegResult {
  code: number;
  stdout: string;
  stderr: string;
}

const VERSION_PROBE_TIMEOUT_MS = 1_000;

export function checkFfmpeg(): boolean {
  const r = spawnSync("ffmpeg", ["-version"], {
    encoding: "utf8",
    timeout: VERSION_PROBE_TIMEOUT_MS,
  });
  return r.status === 0;
}

export function checkFfprobe(): boolean {
  const r = spawnSync("ffprobe", ["-version"], {
    encoding: "utf8",
    timeout: VERSION_PROBE_TIMEOUT_MS,
  });
  return r.status === 0;
}

export function runFfmpeg(
  args: string[],
  opts: { signal?: AbortSignal } = {},
): Promise<FfmpegResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-y", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    // Robust abort: SIGTERM → SIGKILL after 1.5s. ffmpeg respects SIGTERM
    // quickly on its read loop; the SIGKILL backstop covers wedge cases.
    // We resolve with a non-zero code on abort instead of rejecting because
    // ffmpeg callers check `r.code !== 0` and surface a tailored error.
    const cleanup = wireChildAbort(opts.signal, child);
    child.on("error", (e) => {
      cleanup();
      reject(e);
    });
    child.on("close", (code) => {
      cleanup();
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export interface MediaProbe {
  durationSec: number;
  width?: number;
  height?: number;
  frameRate?: number;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  audioSampleRate?: number;
}

export function probeMedia(filePath: string): MediaProbe | null {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return null;

  try {
    const data = JSON.parse(r.stdout) as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        r_frame_rate?: string;
        channels?: number;
        sample_rate?: string;
      }>;
    };

    const v = data.streams?.find((s) => s.codec_type === "video");
    const a = data.streams?.find((s) => s.codec_type === "audio");

    let frameRate: number | undefined;
    if (v?.r_frame_rate) {
      const [num, den] = v.r_frame_rate.split("/").map(Number);
      if (num && den) frameRate = num / den;
    }

    return {
      durationSec: parseFloat(data.format?.duration ?? "0"),
      width: v?.width,
      height: v?.height,
      frameRate,
      videoCodec: v?.codec_name,
      audioCodec: a?.codec_name,
      audioChannels: a?.channels,
      audioSampleRate: a?.sample_rate ? parseInt(a.sample_rate, 10) : undefined,
    };
  } catch {
    return null;
  }
}
