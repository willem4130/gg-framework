import { describe, expect, it, vi } from "vitest";
import type { ProviderError } from "../errors.js";
import { streamAnthropic } from "./anthropic.js";

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status: number | undefined;
    error: unknown;
    requestID: string | null | undefined;
    type: string | null;

    constructor(
      status: number | undefined,
      error: unknown,
      message: string,
      requestID?: string | null,
      type?: string | null,
    ) {
      super(message);
      this.status = status;
      this.error = error;
      this.requestID = requestID;
      this.type = type ?? null;
    }
  }

  class AnthropicMock {
    static APIError = APIError;
    static nextError: Error | null = null;
    messages = {
      stream: () => {
        const error = AnthropicMock.nextError;
        if (!error) throw new Error("test did not configure AnthropicMock.nextError");
        return (async function* () {
          yield* [];
          throw error;
        })();
      },
    };
  }

  return { default: AnthropicMock };
});

describe("streamAnthropic error normalization", () => {
  it("extracts streamed api_error details and request ID", async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const AnthropicMock = Anthropic as unknown as {
      APIError: new (
        status: number | undefined,
        error: unknown,
        message: string,
        requestID?: string | null,
        type?: string | null,
      ) => Error;
      nextError: Error | null;
    };
    AnthropicMock.nextError = new AnthropicMock.APIError(
      undefined,
      {
        type: "error",
        error: {
          details: null,
          type: "api_error",
          message: "Internal server error",
        },
        request_id: "req_011Cb6hYLp9bbMmkqdo2yTWL",
      },
      '{"type":"error","error":{"details":null,"type":"api_error","message":"Internal server error"},"request_id":"req_011Cb6hYLp9bbMmkqdo2yTWL"}',
      null,
      "api_error",
    );

    const result = streamAnthropic({
      provider: "anthropic",
      model: "claude-test",
      messages: [{ role: "user", content: "hi" }],
      apiKey: "sk-ant-test",
    });

    await expect(result.response).rejects.toMatchObject({
      provider: "anthropic",
      message: "api_error: Internal server error",
      requestId: "req_011Cb6hYLp9bbMmkqdo2yTWL",
    } satisfies Partial<ProviderError>);
  });
});
