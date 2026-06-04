import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type SharpNamespace from "sharp";

const execFileAsync = promisify(execFile);

/**
 * Lazy `sharp` resolver — sharp is a hefty native module (libvips). Loading
 * it at module init pulls it into every consumer's bundle, which forces
 * downstream packages that don't actually need image manipulation (gg-boss)
 * to either ship it or break their bundlers. By gating the require behind
 * a function called only by the image-handling helpers, we let unused code
 * paths skip the import entirely — which lets gg-boss tsup-bundle cleanly
 * without `sharp` in its dependency tree.
 *
 * Cached after first call so repeated image operations don't re-hit the
 * dynamic import resolver.
 */
type SharpFn = typeof SharpNamespace;
let sharpFn: SharpFn | null = null;
async function loadSharp(): Promise<SharpFn> {
  if (sharpFn) return sharpFn;
  // Sharp publishes as CJS where `module.exports = sharpFunction`. Under
  // ESM dynamic import, that lands on `.default` — but some tooling normalises
  // it onto the namespace object directly. Try `.default` first, fall back
  // to the namespace if not present.
  const mod = (await import("sharp")) as unknown as { default?: SharpFn } & SharpFn;
  sharpFn = mod.default ?? mod;
  return sharpFn;
}

/** Anthropic's maximum image size in bytes (5 MB). */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Max width (px) for inline terminal-graphics previews so scrollback stays small. */
const PREVIEW_MAX_WIDTH = 480;
/** Anthropic's hard per-dimension cap for many-image requests. Exceeding this
 *  in either dimension causes a 400 even if the byte size is fine. */
const MAX_IMAGE_DIMENSION = 2000;

export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
export const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv"]);
const TEXT_EXTENSIONS = new Set([".md", ".txt"]);
const ATTACHABLE_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...TEXT_EXTENSIONS,
]);

/** Max video size loaded into base64 at attach time (50 MB). Video is routed by
 *  file path, so the bytes are only kept as a fallback for path-less clipboard
 *  clips; larger clips keep `data` empty and rely on the path. Per-model upload
 *  caps live in the model registry (`maxVideoBytes`) and drive compression. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

// ── Video compression (fit oversized clips under a per-model cap) ─────────

/** Compression target — 90 MB leaves headroom under the 100 MB upload cap for
 *  container overhead and bitrate overshoot. */
const COMPRESS_TARGET_BYTES = 90 * 1024 * 1024;
const COMPRESS_MAX_WIDTH = 1280; // cap long edge; preserves aspect (height auto)
const COMPRESS_FPS = 5; // plenty for content understanding; shrinks size hard
const COMPRESS_AUDIO_KBPS = 64; // keep speech intelligible
const COMPRESS_MIN_VIDEO_KBPS = 100; // floor so very long clips stay decodable

export type VideoCompressionResult =
  | { ok: true; path: string; originalBytes: number; compressedBytes: number }
  | { ok: false; reason: string };

function isMissingBinary(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

/**
 * Transcode an oversized video down to fit under {@link COMPRESS_TARGET_BYTES}
 * using ffmpeg: downscale to {@link COMPRESS_MAX_WIDTH}px wide, drop to
 * {@link COMPRESS_FPS} fps, and target a bitrate computed from the clip's
 * duration. Video understanding samples frames, so aggressive downsampling
 * keeps the content analyzable while shrinking multi-GB clips to <100 MB.
 *
 * Writes to a temp file and returns its path; the caller owns deleting it.
 * Best-effort: returns `{ ok: false, reason }` if ffmpeg/ffprobe are missing,
 * the probe fails, or the result still exceeds the target.
 */
export async function compressVideoToFit(
  inputPath: string,
  targetBytes: number = COMPRESS_TARGET_BYTES,
  signal?: AbortSignal,
): Promise<VideoCompressionResult> {
  // Probe duration to compute a size-targeted bitrate.
  let durationSec: number;
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", inputPath],
      { signal },
    );
    durationSec = Number.parseFloat(stdout.trim());
  } catch (err) {
    return {
      ok: false,
      reason: isMissingBinary(err)
        ? "ffmpeg/ffprobe is not installed"
        : `could not probe video: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { ok: false, reason: "could not determine video duration" };
  }

  // total kbps budget = target bits / duration, with 90% safety margin; the
  // audio track gets a fixed slice, the rest goes to video (floored).
  const totalKbps = Math.floor(((targetBytes * 8) / durationSec / 1000) * 0.9);
  const videoKbps = Math.max(COMPRESS_MIN_VIDEO_KBPS, totalKbps - COMPRESS_AUDIO_KBPS);
  const outPath = path.join(os.tmpdir(), `ggcoder-compressed-${Date.now()}.mp4`);

  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-nostats",
        "-loglevel",
        "error",
        "-i",
        inputPath,
        "-vf",
        `scale='min(${COMPRESS_MAX_WIDTH},iw)':-2,fps=${COMPRESS_FPS}`,
        "-c:v",
        "libx264",
        "-b:v",
        `${videoKbps}k`,
        "-maxrate",
        `${Math.floor(videoKbps * 1.5)}k`,
        "-bufsize",
        `${videoKbps}k`,
        "-preset",
        "veryfast",
        "-c:a",
        "aac",
        "-b:a",
        `${COMPRESS_AUDIO_KBPS}k`,
        outPath,
      ],
      { signal, maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (err) {
    await fs.unlink(outPath).catch(() => {});
    return {
      ok: false,
      reason: isMissingBinary(err)
        ? "ffmpeg is not installed"
        : `ffmpeg compression failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let compressedBytes: number;
  let originalBytes: number;
  try {
    compressedBytes = (await fs.stat(outPath)).size;
    originalBytes = (await fs.stat(inputPath)).size;
  } catch {
    await fs.unlink(outPath).catch(() => {});
    return { ok: false, reason: "compression produced no usable output" };
  }
  if (compressedBytes > targetBytes) {
    await fs.unlink(outPath).catch(() => {});
    return {
      ok: false,
      reason: `compressed video is still ${(compressedBytes / (1024 * 1024)).toFixed(0)} MB`,
    };
  }
  return { ok: true, path: outPath, originalBytes, compressedBytes };
}

export const IMAGE_MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

export const VIDEO_MEDIA_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
};

// Backwards-compat alias for internal use below
const MEDIA_TYPES = IMAGE_MEDIA_TYPES;

export interface ImageAttachment {
  kind: "image" | "video" | "text";
  fileName: string;
  filePath: string;
  mediaType: string;
  data: string; // base64 for images/video, raw text for text files
}

/** Check if a file path points to an image based on extension. */
export function isImagePath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/** Check if a file path points to a video based on extension. */
export function isVideoPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

/** Check if a file path points to an attachable file (image or text). */
export function isAttachablePath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ATTACHABLE_EXTENSIONS.has(ext);
}

function resolvePath(filePath: string, cwd: string): string {
  let resolved = filePath.trim();
  // Strip surrounding quotes
  if (
    (resolved.startsWith("'") && resolved.endsWith("'")) ||
    (resolved.startsWith('"') && resolved.endsWith('"'))
  ) {
    resolved = resolved.slice(1, -1);
  }
  // Strip file:// prefix
  if (resolved.startsWith("file://")) {
    resolved = resolved.slice(7);
  }
  // Unescape backslash-escaped characters (e.g. "\ " → " ")
  resolved = resolved.replace(/\\(.)/g, "$1");
  // Resolve home dir
  if (resolved.startsWith("~/")) {
    resolved = path.join(process.env.HOME ?? "/", resolved.slice(2));
  } else if (!path.isAbsolute(resolved)) {
    resolved = path.join(cwd, resolved);
  }
  return resolved;
}

/**
 * Check if a token looks like an intentional file path rather than a bare filename
 * mentioned in conversation. Bare names like "claude.md" should not be auto-attached;
 * only explicit paths like "./claude.md", "/tmp/file.md", "~/notes.md", etc.
 */
function looksLikePath(token: string): boolean {
  const stripped = token.replace(/^['"]|['"]$/g, "");
  return (
    stripped.includes("/") ||
    stripped.includes("\\") ||
    stripped.startsWith("~") ||
    stripped.startsWith("file://")
  );
}

/**
 * Extract attachable file paths from input text by checking if tokens resolve
 * to existing files on disk. Returns verified paths and the remaining text.
 *
 * Only tokens that look like explicit paths (contain `/`, `~`, `\`, or `file://`)
 * are considered. Bare filenames like "readme.md" are left as text.
 */
export async function extractImagePaths(
  text: string,
  cwd: string,
): Promise<{ imagePaths: string[]; cleanText: string }> {
  const imagePaths: string[] = [];
  const cleanParts: string[] = [];

  // Try the entire input as a single path first (only if it looks like a path)
  if (looksLikePath(text)) {
    const wholePath = resolvePath(text, cwd);
    if (isAttachablePath(wholePath) && (await fileExists(wholePath))) {
      return { imagePaths: [wholePath], cleanText: "" };
    }
  }

  // Split on unescaped whitespace (respect backslash-escaped spaces like "file\ name.png")
  const tokens = text.match(/(?:[^\s\\]|\\.)+/g) ?? [];
  for (const token of tokens) {
    if (!token) continue;
    if (looksLikePath(token)) {
      const resolved = resolvePath(token, cwd);
      if (isAttachablePath(resolved) && (await fileExists(resolved))) {
        imagePaths.push(resolved);
        continue;
      }
    }
    cleanParts.push(token);
  }

  return { imagePaths, cleanText: cleanParts.join(" ") };
}

/** Alias of {@link extractImagePaths} that also picks up video paths (video
 *  extensions are part of ATTACHABLE_EXTENSIONS). Name reflects the widened scope. */
export const extractMediaPaths = extractImagePaths;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/** Map sharp's detected format string to an Anthropic-compatible media type. */
const SHARP_FORMAT_TO_MEDIA: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/**
 * Downscale an image buffer so it fits within both MAX_IMAGE_DIMENSION per side
 * (Anthropic's hard pixel cap for many-image requests) and MAX_IMAGE_BYTES.
 * Preserves format (PNG→PNG, JPEG→JPEG, etc.) and aspect ratio.
 */
export async function shrinkToFit(
  buffer: Buffer,
  mediaType: string,
): Promise<{ buffer: Buffer; mediaType: string }> {
  const sharp = await loadSharp();
  const meta = await sharp(buffer).metadata();
  const origW = meta.width ?? 4096;
  const origH = meta.height ?? 4096;
  const exceedsDim = origW > MAX_IMAGE_DIMENSION || origH > MAX_IMAGE_DIMENSION;

  // Trust the buffer over the caller-supplied mediaType: if a file was named
  // foo.png but is actually a JPEG, sharp tells the truth and Anthropic
  // rejects mismatched media types with a 400.
  const detected = meta.format ? SHARP_FORMAT_TO_MEDIA[meta.format] : undefined;
  if (detected && detected !== mediaType) {
    mediaType = detected;
  }

  // Short-circuit: within both limits — return as-is.
  if (!exceedsDim && buffer.length <= MAX_IMAGE_BYTES) {
    return { buffer, mediaType };
  }

  // Determine output format from mediaType
  const formatMap: Record<string, keyof SharpNamespace.FormatEnum> = {
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "png", // convert BMP to PNG (sharp doesn't output BMP)
  };
  let outFormat = formatMap[mediaType] ?? "png";
  let outMediaType = mediaType === "image/bmp" ? "image/png" : mediaType;

  // Compute the initial target dimensions: fit within MAX_IMAGE_DIMENSION,
  // preserving aspect ratio. Sharp's fit: "inside" does the same math but we
  // want explicit width/height so we can shrink them further in the byte loop.
  const scale = exceedsDim ? Math.min(MAX_IMAGE_DIMENSION / origW, MAX_IMAGE_DIMENSION / origH) : 1;
  let width = Math.max(1, Math.round(origW * scale));
  let height = Math.max(1, Math.round(origH * scale));

  // Encode at the dimension-capped size first — often this is already under
  // MAX_IMAGE_BYTES and we're done.
  {
    const first = await sharp(buffer)
      .resize(width, height, { fit: "inside", withoutEnlargement: true })
      .toFormat(outFormat)
      .toBuffer();
    if (first.length <= MAX_IMAGE_BYTES) {
      return { buffer: first, mediaType: outMediaType };
    }
  }

  // Still too large — progressively shrink by 25% per step.
  for (let attempt = 0; attempt < 10; attempt++) {
    width = Math.max(1, Math.round(width * 0.75));
    height = Math.max(1, Math.round(height * 0.75));
    if (width < 1 || height < 1) break;

    const result = await sharp(buffer)
      .resize(width, height, { fit: "inside", withoutEnlargement: true })
      .toFormat(outFormat)
      .toBuffer();

    if (result.length <= MAX_IMAGE_BYTES) {
      return { buffer: result, mediaType: outMediaType };
    }

    // If PNG is still too big after 3 attempts, switch to JPEG for better compression
    if (attempt === 2 && outFormat === "png") {
      outFormat = "jpeg";
      outMediaType = "image/jpeg";
    }
  }

  // Last resort: aggressive JPEG compression at small size
  const result = await sharp(buffer)
    .resize(Math.round(width * 0.5), Math.round(height * 0.5), {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 60 })
    .toBuffer();
  return { buffer: result, mediaType: "image/jpeg" };
}

/**
 * Downscale an image buffer for an inline terminal preview, capping its width
 * at PREVIEW_MAX_WIDTH so previews stay small in scrollback. The full-resolution
 * copy is kept separately for the model. Preserves format and aspect ratio.
 *
 * On any sharp failure the original buffer is returned unchanged — a preview is
 * cosmetic and must never break the turn.
 */
export async function downscaleForPreview(buffer: Buffer): Promise<Buffer> {
  try {
    const sharp = await loadSharp();
    const meta = await sharp(buffer).metadata();
    const width = meta.width ?? 0;
    if (width > 0 && width <= PREVIEW_MAX_WIDTH) return buffer;
    return await sharp(buffer)
      .resize(PREVIEW_MAX_WIDTH, undefined, { fit: "inside", withoutEnlargement: true })
      .toBuffer();
  } catch {
    return buffer;
  }
}

/**
 * Read a file and return an attachment (base64 for images, raw text for text files).
 *
 * Image decode / shrink failures degrade to a text placeholder instead of throwing,
 * so a corrupt or unsupported image doesn't crash the turn. The caller sees a
 * `kind: "text"` attachment the model can read as `<file>…</file>` context.
 */
export async function readImageFile(filePath: string): Promise<ImageAttachment> {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  if (VIDEO_EXTENSIONS.has(ext)) {
    try {
      const mediaType = VIDEO_MEDIA_TYPES[ext] ?? "video/mp4";
      const stat = await fs.stat(filePath);
      // Always classify as `video` so it routes through the video path (and the
      // UI shows it as a video, not a generic file). Providers that deliver
      // video via an upload/read-tool reference it by `filePath` at any size.
      // Only providers that inline base64 need the bytes in-memory, and only up
      // to MAX_VIDEO_BYTES — so for larger clips we keep `data` empty and let
      // the path-based routes handle it.
      const data =
        stat.size <= MAX_VIDEO_BYTES ? (await fs.readFile(filePath)).toString("base64") : "";
      return { kind: "video", fileName, filePath, mediaType, data };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        kind: "text",
        fileName,
        filePath,
        mediaType: "text/plain",
        data: `[video ${fileName} could not be loaded: ${reason}]`,
      };
    }
  }

  if (TEXT_EXTENSIONS.has(ext)) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return { kind: "text", fileName, filePath, mediaType: "text/plain", data: content };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        kind: "text",
        fileName,
        filePath,
        mediaType: "text/plain",
        data: `[file ${fileName} could not be read: ${reason}]`,
      };
    }
  }

  try {
    const mediaType = MEDIA_TYPES[ext] ?? "image/png";
    const rawBuffer = await fs.readFile(filePath);
    const { buffer, mediaType: finalMediaType } = await shrinkToFit(rawBuffer, mediaType);
    return {
      kind: "image",
      fileName,
      filePath,
      mediaType: finalMediaType,
      data: buffer.toString("base64"),
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      kind: "text",
      fileName,
      filePath,
      mediaType: "text/plain",
      data: `[image ${fileName} could not be loaded: ${reason}]`,
    };
  }
}

/** Alias of {@link readImageFile} that also handles video files. Name reflects
 *  the widened scope. */
export const readMediaFile = readImageFile;

/**
 * Try to read image data from the system clipboard (macOS only).
 * Returns null if no image is on the clipboard.
 */
export function getClipboardImage(): Promise<ImageAttachment | null> {
  if (process.platform !== "darwin") return Promise.resolve(null);

  return new Promise((resolve) => {
    // Check if clipboard has image data
    execFile("osascript", ["-e", "clipboard info"], (err, stdout) => {
      if (err || (!stdout.includes("PNGf") && !stdout.includes("TIFF"))) {
        resolve(null);
        return;
      }

      // Determine format — prefer PNG
      const isPng = stdout.includes("PNGf");
      const clipClass = isPng ? "PNGf" : "TIFF";
      const ext = isPng ? "png" : "tiff";
      const mediaType = isPng ? "image/png" : "image/tiff";

      // Write clipboard image to temp file, then read as base64
      const tmpPath = `/tmp/ggcoder-clipboard-${Date.now()}.${ext}`;
      const writeScript = [
        `set imgData to the clipboard as «class ${clipClass}»`,
        `set filePath to POSIX file "${tmpPath}"`,
        `set fileRef to open for access filePath with write permission`,
        `write imgData to fileRef`,
        `close access fileRef`,
      ].join("\n");

      execFile("osascript", ["-e", writeScript], async (writeErr) => {
        if (writeErr) {
          resolve(null);
          return;
        }
        try {
          const rawBuffer = await fs.readFile(tmpPath);
          await fs.unlink(tmpPath).catch(() => {});
          const { buffer: finalBuffer, mediaType: finalMediaType } = await shrinkToFit(
            rawBuffer,
            mediaType,
          );
          resolve({
            kind: "image",
            fileName: `clipboard.${ext}`,
            filePath: tmpPath,
            mediaType: finalMediaType,
            data: finalBuffer.toString("base64"),
          });
        } catch {
          resolve(null);
        }
      });
    });
  });
}
