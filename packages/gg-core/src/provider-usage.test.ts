import { describe, expect, it, vi } from "vitest";
import { fetchSubscriptionUsage } from "./provider-usage.js";
import type { SubscriptionUsageError } from "./provider-usage.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchSubscriptionUsage", () => {
  it("normalizes Anthropic current and weekly windows", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        five_hour: { utilization: 31.5, resets_at: "2030-01-01T05:00:00Z" },
        seven_day: { utilization: 67, resets_at: "2030-01-07T00:00:00Z" },
      }),
    );

    const result = await fetchSubscriptionUsage(
      "anthropic",
      { accessToken: "anthropic-token" },
      { fetchFn, now: () => 1234 },
    );

    expect(result).toEqual({
      provider: "anthropic",
      displayName: "Anthropic",
      windows: [
        {
          kind: "current",
          label: "5-hour",
          usedPercent: 31.5,
          resetsAt: Date.parse("2030-01-01T05:00:00Z"),
        },
        {
          kind: "weekly",
          label: "Weekly",
          usedPercent: 67,
          resetsAt: Date.parse("2030-01-07T00:00:00Z"),
        },
      ],
      fetchedAt: 1234,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.anthropic.com/api/oauth/usage",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer anthropic-token",
          "anthropic-beta": "oauth-2025-04-20",
        }),
      }),
    );
  });

  it("normalizes Codex windows and sends the account id", async () => {
    const now = 2_000_000;
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        rate_limit: {
          primary_window: {
            limit_window_seconds: 18_000,
            used_percent: 22,
            reset_after_seconds: 600,
          },
          secondary_window: {
            limit_window_seconds: 604_800,
            used_percent: 48,
            reset_at: 2_000_000_000,
          },
        },
      }),
    );

    const result = await fetchSubscriptionUsage(
      "openai",
      { accessToken: "openai-token", accountId: "acct-123" },
      { fetchFn, now: () => now },
    );

    expect(result).toEqual({
      provider: "openai",
      displayName: "Codex",
      windows: [
        {
          kind: "current",
          label: "5-hour",
          usedPercent: 22,
          resetsAt: now + 600_000,
        },
        {
          kind: "weekly",
          label: "Weekly",
          usedPercent: 48,
          resetsAt: 2_000_000_000_000,
        },
      ],
      fetchedAt: now,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/wham/usage",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer openai-token",
          "ChatGPT-Account-Id": "acct-123",
        }),
      }),
    );
  });

  it("treats a weekly-only Codex primary window as weekly", async () => {
    const now = 2_000_000;
    const result = await fetchSubscriptionUsage(
      "openai",
      { accessToken: "openai-token" },
      {
        now: () => now,
        fetchFn: async () =>
          jsonResponse({
            rate_limit: {
              primary_window: {
                limit_window_seconds: 604_800,
                used_percent: 11,
                reset_after_seconds: 593_701,
              },
              secondary_window: null,
            },
          }),
      },
    );

    expect(result.windows).toEqual([
      {
        kind: "weekly",
        label: "Weekly",
        usedPercent: 11,
        resetsAt: now + 593_701_000,
      },
    ]);
  });

  it("rejects provider HTTP errors without exposing the response body", async () => {
    await expect(
      fetchSubscriptionUsage(
        "anthropic",
        { accessToken: "expired" },
        { fetchFn: async () => jsonResponse({ secret: "raw-provider-detail" }, 401) },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<SubscriptionUsageError>>({
        message: "Subscription usage request failed with HTTP 401",
        status: 401,
      }),
    );
  });
});
