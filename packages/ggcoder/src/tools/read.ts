import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import { resolvePath, rejectSymlink } from "./path-utils.js";
import { truncateHead } from "./truncate.js";
import { writeOverflow } from "./overflow.js";
import { localOperations, type ToolOperations } from "./operations.js";
import { recordRead, type ReadTracker } from "./read-tracker.js";
import {
  IMAGE_EXTENSIONS,
  IMAGE_MEDIA_TYPES,
  VIDEO_EXTENSIONS,
  VIDEO_MEDIA_TYPES,
  compressVideoToFit,
  downscaleForPreview,
  shrinkToFit,
} from "../utils/image.js";

export const BINARY_EXTENSIONS = new Set([
  ".ico",
  ".svg",
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mov",
  ".mkv",
  ".flac",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".7z",
  ".rar",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".dat",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".pyc",
  ".class",
  ".o",
  ".obj",
  ".asar",
  ".node",
  ".wasm",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".snap",
  ".pack",
  ".idx",
]);

const ReadParams = z.object({
  file_path: z.string().describe("The file path to read"),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Line number to start reading from (1-based)"),
  limit: z.number().int().min(1).optional().describe("Maximum number of lines to read"),
});

export function createReadTool(
  cwd: string,
  readFiles?: ReadTracker,
  ops: ToolOperations = localOperations,
  onFileRead?: (filePath: string) => void | Promise<void>,
  /** Max video payload (bytes) the active model accepts, or `undefined` for
   *  models without video support. When set, video files are returned as a
   *  native `video` content part (compressed to fit this cap); when undefined
   *  they fall through to the generic binary-file notice. */
  videoByteLimit?: number,
): AgentTool<typeof ReadParams> {
  const returnVideoNatively = videoByteLimit !== undefined;
  return {
    name: "read",
    description:
      "Read a file's contents. Returns numbered lines (cat -n style). " +
      "Output is truncated to 2000 lines or 50KB (whichever is hit first). " +
      "If truncated, use offset/limit to read remaining sections. " +
      "Reads images natively. " +
      (returnVideoNatively
        ? "Reads video files natively too — you CAN watch and analyze a video by " +
          "calling read on its path (.mp4/.mov/.webm/.mkv/.avi); large clips are " +
          "auto-compressed for you. When a user attaches a video, read it; never " +
          "claim you cannot watch video. "
        : "") +
      "Other binary files return a notice instead of content.",
    parameters: ReadParams,
    async execute({ file_path, offset, limit }, context) {
      const resolved = resolvePath(cwd, file_path);
      await rejectSymlink(resolved);
      const ext = path.extname(resolved).toLowerCase();

      // Image: read as binary, shrink to fit provider limits, return as
      // structured content so the model can actually see the pixels.
      if (IMAGE_EXTENSIONS.has(ext)) {
        try {
          const rawBuffer = await fs.readFile(resolved);
          const mediaType = IMAGE_MEDIA_TYPES[ext] ?? "image/png";
          const { buffer, mediaType: finalMediaType } = await shrinkToFit(rawBuffer, mediaType);
          const resizedNote =
            buffer.length < rawBuffer.length
              ? ` (resized from ${rawBuffer.length} to ${buffer.length} bytes)`
              : "";
          // Smaller copy for the inline terminal preview (kitty/iTerm2). Kept
          // separate from the full-res copy the model sees. Cosmetic — a
          // preview failure must never break the read.
          const previewBuffer = await downscaleForPreview(buffer);
          return {
            content: [
              {
                type: "text",
                text: `Read image file ${resolved} [${finalMediaType}]${resizedNote}`,
              },
              { type: "image", mediaType: finalMediaType, data: buffer.toString("base64") },
            ],
            details: {
              imagePreviews: [
                {
                  base64: previewBuffer.toString("base64"),
                  mediaType: finalMediaType,
                  path: resolved,
                },
              ],
            },
          };
        } catch (err: unknown) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ENOENT") return `File not found: ${resolved}`;
          if (code === "EACCES") return `Permission denied: ${resolved}`;
          const reason = err instanceof Error ? err.message : String(err);
          return `Could not read image ${resolved}: ${reason}`;
        }
      }

      // Video: when the active model can watch video natively, return the clip
      // as a `video` content part. Each provider's transport delivers it (Kimi
      // uploads + references; Gemini inlineData; MiniMax base64). Otherwise fall
      // through to the binary notice. The byte cap is per-model (videoByteLimit).
      if (returnVideoNatively && videoByteLimit !== undefined && VIDEO_EXTENSIONS.has(ext)) {
        let compressedPath: string | undefined;
        try {
          // Clips over the model's cap can't be sent directly (and reading multi-GB
          // into base64 would OOM). Auto-compress down to fit: downscale + drop
          // fps/bitrate, which keeps the video analyzable. If ffmpeg is missing or
          // it's still too large, surface a clear message steering to ffmpeg.
          const limitMb = Math.round(videoByteLimit / (1024 * 1024));
          const stat = await ops.stat(resolved);
          let videoPath = resolved;
          let note = "";
          if (stat.size > videoByteLimit) {
            const result = await compressVideoToFit(resolved, videoByteLimit, context?.signal);
            if (!result.ok) {
              const mb = (stat.size / (1024 * 1024)).toFixed(1);
              return (
                `Video ${resolved} is ${mb} MB, over the ${limitMb} MB ` +
                `limit for native analysis, and auto-compression failed (${result.reason}). ` +
                `Use ffmpeg to downscale it (lower resolution/fps) under that size, then read the result.`
              );
            }
            compressedPath = result.path;
            videoPath = result.path;
            note =
              ` (auto-compressed from ${(result.originalBytes / (1024 * 1024)).toFixed(0)} MB to ` +
              `${(result.compressedBytes / (1024 * 1024)).toFixed(0)} MB for analysis)`;
          }
          const rawBuffer = await fs.readFile(videoPath);
          const mediaType = VIDEO_MEDIA_TYPES[ext] ?? "video/mp4";
          return {
            content: [
              { type: "text", text: `Read video file ${resolved} [${mediaType}]${note}` },
              { type: "video", mediaType, data: rawBuffer.toString("base64") },
            ],
          };
        } catch (err: unknown) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ENOENT") return `File not found: ${resolved}`;
          if (code === "EACCES") return `Permission denied: ${resolved}`;
          const reason = err instanceof Error ? err.message : String(err);
          return `Could not read video ${resolved}: ${reason}`;
        } finally {
          // The compressed copy is now in base64 in the result; drop the temp file.
          if (compressedPath) await fs.unlink(compressedPath).catch(() => {});
        }
      }

      if (BINARY_EXTENSIONS.has(ext)) {
        const stat = await ops.stat(resolved);
        return `Binary file: ${resolved} (${ext}, ${stat.size} bytes)`;
      }

      let raw: string;
      try {
        raw = await ops.readFile(resolved);
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return `File not found: ${resolved}`;
        if (code === "EACCES") return `Permission denied: ${resolved}`;
        if (code === "EISDIR") return `Is a directory, not a file: ${resolved}`;
        throw err;
      }
      const stat = await ops.stat(resolved);
      recordRead(readFiles, resolved, raw, stat.mtimeMs);
      await onFileRead?.(resolved);
      let lines = raw.split("\n");

      // Apply offset/limit
      const startLine = offset ? offset - 1 : 0;
      const endLine = limit ? startLine + limit : lines.length;
      lines = lines.slice(startLine, endLine);

      const content = lines.join("\n");
      const result = truncateHead(content);

      // Prepend line numbers (cat -n style)
      const actualStart = startLine + 1;
      const numbered = result.content
        .split("\n")
        .map((line, i) => {
          const lineNum = String(actualStart + i).padStart(6, " ");
          return `${lineNum}\t${line}`;
        })
        .join("\n");

      if (result.truncated) {
        const nextOffset = (offset ?? 1) + result.keptLines;
        const overflowPath = await writeOverflow(content, "read").catch(() => null);
        const overflowNotice = overflowPath ? ` Full output saved to ${overflowPath}.` : "";
        return (
          `${numbered}\n` +
          `[Truncated: showing lines ${offset ?? 1}-${(offset ?? 1) + result.keptLines - 1} of ${result.totalLines}.${overflowNotice} ` +
          `Use offset=${nextOffset} to read more.]`
        );
      }
      return numbered;
    },
  };
}
