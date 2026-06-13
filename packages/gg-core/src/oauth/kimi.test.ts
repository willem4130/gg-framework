import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshKimiToken } from "./kimi.js";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("refreshKimiToken", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses the rotated refresh token when the server returns one", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        access_token: "new-access",
        refresh_token: "rotated-refresh",
        expires_in: 3_600,
      }),
    ) as unknown as typeof fetch;

    const creds = await refreshKimiToken("old-refresh");
    expect(creds.accessToken).toBe("new-access");
    expect(creds.refreshToken).toBe("rotated-refresh");
    expect(creds.expiresAt).toBeGreaterThan(Date.now());
  });

  it("preserves the existing refresh token when the server omits it", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ access_token: "new-access", expires_in: 3_600 }),
    ) as unknown as typeof fetch;

    const creds = await refreshKimiToken("old-refresh");
    expect(creds.accessToken).toBe("new-access");
    // No rotation → keep using the caller's refresh token so the credential is
    // never stranded (which would force a silent fall back to the API key).
    expect(creds.refreshToken).toBe("old-refresh");
  });

  it("surfaces a 401 in a shape AuthStorage recognizes as a dead refresh token", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: "invalid_grant" }, 401),
    ) as unknown as typeof fetch;

    await expect(refreshKimiToken("dead-refresh")).rejects.toThrow(/\(401\)/);
  });
});
