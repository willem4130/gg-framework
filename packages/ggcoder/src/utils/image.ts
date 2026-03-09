import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);

const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

export interface ImageAttachment {
  fileName: string;
  filePath: string;
  mediaType: string;
  data: string; // base64
}

/** Check if a file path points to an image based on extension. */
export function isImagePath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
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
  // Resolve home dir
  if (resolved.startsWith("~/")) {
    resolved = path.join(process.env.HOME ?? "/", resolved.slice(2));
  } else if (!path.isAbsolute(resolved)) {
    resolved = path.join(cwd, resolved);
  }
  return resolved;
}

/**
 * Extract image file paths from input text by checking if tokens resolve
 * to existing image files on disk. Returns verified paths and the remaining text.
 */
export async function extractImagePaths(
  text: string,
  cwd: string,
): Promise<{ imagePaths: string[]; cleanText: string }> {
  const imagePaths: string[] = [];
  const cleanParts: string[] = [];

  // Try the entire input as a single path first
  const wholePath = resolvePath(text, cwd);
  if (isImagePath(wholePath) && (await fileExists(wholePath))) {
    return { imagePaths: [wholePath], cleanText: "" };
  }

  // Split on whitespace and check each token
  const tokens = text.split(/\s+/);
  for (const token of tokens) {
    if (!token) continue;
    const resolved = resolvePath(token, cwd);
    if (isImagePath(resolved) && (await fileExists(resolved))) {
      imagePaths.push(resolved);
    } else {
      cleanParts.push(token);
    }
  }

  return { imagePaths, cleanText: cleanParts.join(" ") };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/** Read an image file and return base64 data with media type. */
export async function readImageFile(filePath: string): Promise<ImageAttachment> {
  const ext = path.extname(filePath).toLowerCase();
  const mediaType = MEDIA_TYPES[ext] ?? "image/png";
  const buffer = await fs.readFile(filePath);
  const data = buffer.toString("base64");
  return {
    fileName: path.basename(filePath),
    filePath,
    mediaType,
    data,
  };
}

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
          const buffer = await fs.readFile(tmpPath);
          await fs.unlink(tmpPath).catch(() => {});
          resolve({
            fileName: `clipboard.${ext}`,
            filePath: tmpPath,
            mediaType,
            data: buffer.toString("base64"),
          });
        } catch {
          resolve(null);
        }
      });
    });
  });
}
