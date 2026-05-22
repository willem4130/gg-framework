import { z } from "zod";
import type { AgentTool } from "@kenkaiiii/gg-agent";

/**
 * Block requests to private/internal network addresses to prevent SSRF.
 * Checks the hostname against known private IP ranges and reserved domains.
 */
export function isBlockedUrl(urlString: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return true; // Malformed URLs are blocked
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block non-HTTP(S) schemes
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return true;
  }

  // Block localhost and loopback
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }

  // Block 0.0.0.0
  if (hostname === "0.0.0.0") {
    return true;
  }

  // Block private IPv4 ranges: 10.x.x.x, 172.16-31.x.x, 192.168.x.x
  if (/^10\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;

  // Block link-local (169.254.x.x — includes AWS metadata endpoint)
  if (/^169\.254\./.test(hostname)) return true;

  // Block IPv6 private/link-local
  if (hostname.startsWith("[fe80:") || hostname.startsWith("[fd") || hostname.startsWith("[fc")) {
    return true;
  }

  // Block cloud metadata endpoints
  if (hostname === "metadata.google.internal") return true;

  return false;
}

const BOILERPLATE_SELECTOR_PATTERNS = [
  "script",
  "style",
  "noscript",
  "svg",
  "canvas",
  "iframe",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "nav",
  "footer",
  "header",
  "aside",
  "dialog",
  "cookie",
  "consent",
  "banner",
  "modal",
  "popup",
  "newsletter",
  "subscribe",
  "social",
  "share",
  "sidebar",
  "advert",
  "ads",
  "ad-",
  "-ad",
  "sponsor",
  "promo",
  "tracking",
  "analytics",
];

const BOILERPLATE_LINE_PATTERNS = [
  /^(advertisement|sponsored|promoted|ad)\b/i,
  /^skip to (main content|content|search|navigation)$/i,
  /^open (main )?menu$/i,
  /\b(cookie|privacy) (settings|preferences|policy)\b/i,
  /\b(accept|reject|manage) (all )?(cookies|preferences)\b/i,
  /\bsubscribe (to|for)\b/i,
  /\bsign up for (our )?(newsletter|emails?)\b/i,
  /^share (this|on)\b/i,
];

function removeElementsByTag(html: string, tagName: string): string {
  return html.replace(new RegExp(`<${tagName}\\b[\\s\\S]*?<\\/${tagName}>`, "gi"), " ");
}

function removeBoilerplateElements(html: string): string {
  let cleaned = html;

  for (const pattern of BOILERPLATE_SELECTOR_PATTERNS) {
    cleaned = cleaned.replace(
      new RegExp(
        `<([a-z][a-z0-9]*)\\b[^>]*(?:id|class|role|aria-label|data-testid|data-test|data-component)=["'][^"']*${pattern}[^"']*["'][^>]*>[\\s\\S]*?<\\/\\1>`,
        "gi",
      ),
      " ",
    );
  }

  for (const tagName of [
    "script",
    "style",
    "noscript",
    "svg",
    "canvas",
    "iframe",
    "form",
    "nav",
    "footer",
    "header",
    "aside",
  ]) {
    cleaned = removeElementsByTag(cleaned, tagName);
  }

  return cleaned;
}

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

export function htmlToCleanText(html: string): string {
  const withUsefulBreaks = removeBoilerplateElements(html)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|section|article|main|h[1-6]|li|tr|blockquote)\s*>/gi, "\n");

  return decodeHTMLEntities(withUsefulBreaks.replace(/<[^>]+>/g, " "))
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line && !BOILERPLATE_LINE_PATTERNS.some((pattern) => pattern.test(line)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function createWebFetchTool(): AgentTool<typeof parameters> {
  return {
    name: "web_fetch",
    description:
      "Fetch and read content from a URL. Returns the text content of the page with HTML tags stripped. Useful for reading articles, documentation, or any web page.",
    parameters,
    async execute(args) {
      const maxLength = args.max_length ?? 10000;

      if (isBlockedUrl(args.url)) {
        return "Error: URL blocked — requests to private/internal network addresses are not allowed.";
      }

      try {
        const response = await fetch(args.url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; GGCoder/1.0)",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          redirect: "manual",
          signal: AbortSignal.timeout(30000),
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) return `Error: HTTP ${response.status} redirect without Location header`;
          const redirectUrl = new URL(location, args.url).toString();
          if (isBlockedUrl(redirectUrl)) {
            return "Error: Redirect blocked — target URL is private/internal or unsupported.";
          }
          return `Error: Redirects are not followed automatically. Safe redirect target: ${redirectUrl}`;
        }

        if (!response.ok) {
          return `Error: HTTP ${response.status} ${response.statusText}`;
        }

        const contentType = response.headers.get("content-type") ?? "";
        const text = await response.text();

        let content: string;
        if (contentType.includes("html")) {
          content = htmlToCleanText(text);
        } else {
          content = text;
        }

        if (content.length > maxLength) {
          content = content.slice(0, maxLength) + "\n\n[Content truncated]";
        }

        return content;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return `Error fetching ${args.url}: ${msg}`;
      }
    },
  };
}

const parameters = z.object({
  url: z.string().describe("The URL to fetch"),
  max_length: z.number().optional().describe("Maximum characters to return (default: 10000)"),
});
