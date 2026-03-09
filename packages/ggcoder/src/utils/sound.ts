import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const notificationPath = resolve(__dirname, "../../assets/end-notification.mp3");

export function playNotificationSound(): void {
  execFile("afplay", [notificationPath], () => {
    // fire-and-forget — ignore errors (e.g. afplay not found on non-macOS)
  });
}
