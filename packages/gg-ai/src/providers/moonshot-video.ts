import type OpenAI from "openai";
import type { Message, VideoContent } from "../types.js";
import { providerDiag } from "../utils/diag.js";

/**
 * Moonshot/Kimi video upload.
 *
 * Moonshot's chat API (both `api.moonshot.ai` and the Kimi For Coding endpoint
 * `api.kimi.com/coding`) rejects inline base64 `video_url` data URLs with
 * "invalid part type: video_url". Videos must instead be uploaded to the
 * Moonshot file service (`POST {baseUrl}/files`, `purpose=video`) and
 * referenced in the message as `ms://<file-id>`.
 *
 * This mirrors MoonshotAI/kimi-code's `KimiFiles.uploadVideo`. We upload each
 * video part once and cache the returned id on the content part (`fileId`), so
 * subsequent turns reuse it instead of re-uploading the clip.
 */
export async function uploadMoonshotVideos(
  client: OpenAI,
  messages: Message[],
  signal?: AbortSignal,
): Promise<void> {
  for (const msg of messages) {
    if (typeof msg.content === "string") continue;
    for (const part of msg.content) {
      // Direct video parts in user messages.
      if (part.type === "video") {
        await ensureUploaded(client, part as VideoContent, signal);
        continue;
      }
      // Video parts nested inside tool_result content (the path Kimi's coding
      // endpoint actually accepts: video delivered as a read-tool result).
      if (part.type === "tool_result" && Array.isArray(part.content)) {
        for (const inner of part.content) {
          if (inner.type === "video") {
            await ensureUploaded(client, inner as VideoContent, signal);
          }
        }
      }
    }
  }
}

async function ensureUploaded(
  client: OpenAI,
  video: VideoContent,
  signal?: AbortSignal,
): Promise<void> {
  if (video.fileId) {
    providerDiag("moonshot_video_cached", { fileId: video.fileId });
    return;
  }
  if (!video.data) {
    providerDiag("moonshot_video_skipped_no_data", {});
    return;
  }
  providerDiag("moonshot_video_upload_start", {
    mediaType: video.mediaType,
    bytes: Math.floor((video.data.length * 3) / 4),
  });
  video.fileId = await uploadOne(client, video, signal);
  providerDiag("moonshot_video_upload_done", { fileId: video.fileId });
}

async function uploadOne(
  client: OpenAI,
  video: VideoContent,
  signal?: AbortSignal,
): Promise<string> {
  const bytes = Buffer.from(video.data, "base64");
  const mediaType = video.mediaType || "video/mp4";
  const filename = `upload.${extForMime(mediaType)}`;
  // `Blob`/`File` are Node 20+ globals; the OpenAI SDK's `Uploadable` accepts a
  // File-like object. Cast `purpose` since "video" is a Moonshot-specific value
  // outside the SDK's first-party purpose union.
  const file = new File([new Uint8Array(bytes)], filename, { type: mediaType });
  const uploaded = (await client.files.create(
    { file: file as never, purpose: "video" as never },
    signal ? { signal } : undefined,
  )) as unknown as { id: string };
  return uploaded.id;
}

const MIME_TO_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/mpeg": "mpeg",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
  "video/x-flv": "flv",
  "video/3gpp": "3gp",
};

function extForMime(mediaType: string): string {
  return MIME_TO_EXT[mediaType.toLowerCase()] ?? "mp4";
}
