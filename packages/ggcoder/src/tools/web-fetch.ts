import { z } from "zod";
import type { AgentTool } from "@kenkaiiii/gg-agent";

export function createWebFetchTool(): AgentTool<typeof parameters> {
  return {
    name: "web_fetch",
    description:
      "Fetch and read content from a URL. Returns the text content of the page with HTML tags stripped. Useful for reading articles, documentation, or any web page.",
    parameters,
    async execute(args) {
      const maxLength = args.max_length ?? 10000;

      try {
        const response = await fetch(args.url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; GGCoder/1.0)",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          return `Error: HTTP ${response.status} ${response.statusText}`;
        }

        const contentType = response.headers.get("content-type") ?? "";
        const text = await response.text();

        let content: string;
        if (contentType.includes("html")) {
          content = text
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
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
