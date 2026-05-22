import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebFetchTool, htmlToCleanText } from "./web-fetch.js";

const originalFetch = globalThis.fetch;

function context() {
  return { signal: new AbortController().signal, toolCallId: "test" };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("htmlToCleanText", () => {
  it("removes common ad, cookie, nav, and subscription boilerplate", () => {
    const html = `
      <html>
        <head><style>.ad { display: block; }</style><script>alert("track")</script></head>
        <body>
          <header>Site navigation</header>
          <nav>Products Docs Pricing</nav>
          <div class="cookie-banner">Accept all cookies</div>
          <main>
            <article>
              <h1>Useful documentation</h1>
              <p>This is the content the agent should read.</p>
              <div class="advertisement">Sponsored: buy this now</div>
              <p>Second useful paragraph &amp; details.</p>
            </article>
            <aside class="newsletter-signup">Subscribe to our newsletter</aside>
          </main>
          <footer>Legal links</footer>
        </body>
      </html>
    `;

    const result = htmlToCleanText(html);

    expect(result).toContain("Useful documentation");
    expect(result).toContain("This is the content the agent should read.");
    expect(result).toContain("Second useful paragraph & details.");
    expect(result).not.toContain("Site navigation");
    expect(result).not.toContain("Products Docs Pricing");
    expect(result).not.toContain("Accept all cookies");
    expect(result).not.toContain("Sponsored");
    expect(result).not.toContain("Subscribe to our newsletter");
    expect(result).not.toContain("Legal links");
  });

  it("removes accessibility skip-link boilerplate", () => {
    const result = htmlToCleanText(`
      <a href="#content">Skip to main content</a>
      <a href="#search">Skip to search</a>
      <main><h1>Fetch API</h1><p>Useful page body.</p></main>
    `);

    expect(result).toContain("Fetch API");
    expect(result).toContain("Useful page body.");
    expect(result).not.toContain("Skip to main content");
    expect(result).not.toContain("Skip to search");
  });
});

describe("createWebFetchTool", () => {
  it("returns sanitized HTML content from fetched pages", async () => {
    const html = `
      <html>
        <body>
          <nav>Skip Main navigation</nav>
          <article>
            <h1>API Reference</h1>
            <p>Use this endpoint to create a session.</p>
            <div id="ad-container">Advertisement: cloud hosting sale</div>
          </article>
          <footer>Terms Privacy</footer>
        </body>
      </html>
    `;
    globalThis.fetch = vi.fn(
      async () =>
        new Response(html, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    ) as typeof fetch;

    const result = await createWebFetchTool().execute(
      { url: "https://example.com/docs" },
      context(),
    );

    expect(result).toContain("API Reference");
    expect(result).toContain("Use this endpoint to create a session.");
    expect(result).not.toContain("Skip Main navigation");
    expect(result).not.toContain("Advertisement");
    expect(result).not.toContain("Terms Privacy");
  });

  it("blocks redirects to private/internal URLs without following them", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1:3000/secret" },
        }),
    ) as typeof fetch;

    const result = await createWebFetchTool().execute(
      { url: "https://example.com/redirect" },
      context(),
    );

    expect(result).toContain("Redirect blocked");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://example.com/redirect",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("blocks private/internal URLs before fetching", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await createWebFetchTool().execute(
      { url: "http://127.0.0.1:3000/secret" },
      context(),
    );

    expect(result).toContain("URL blocked");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
