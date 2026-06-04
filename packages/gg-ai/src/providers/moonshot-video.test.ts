import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";
import { uploadMoonshotVideos } from "./moonshot-video.js";
import type { Message } from "../types.js";

function fakeClient(ids: string[]): { client: OpenAI; create: ReturnType<typeof vi.fn> } {
  let i = 0;
  const create = vi.fn().mockImplementation(async () => ({ id: ids[i++] }));
  const client = { files: { create } } as unknown as OpenAI;
  return { client, create };
}

describe("uploadMoonshotVideos", () => {
  it("uploads each video part and caches the returned fileId in place", async () => {
    const { client, create } = fakeClient(["file_a"]);
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "watch this" },
          { type: "video", mediaType: "video/mp4", data: Buffer.from("clip").toString("base64") },
        ],
      },
    ];

    await uploadMoonshotVideos(client, messages);

    expect(create).toHaveBeenCalledTimes(1);
    const videoPart = (messages[0].content as Array<{ type: string; fileId?: string }>)[1];
    expect(videoPart.fileId).toBe("file_a");
  });

  it("skips parts that already have a fileId (no re-upload across turns)", async () => {
    const { client, create } = fakeClient(["file_b"]);
    const messages: Message[] = [
      {
        role: "user",
        content: [{ type: "video", mediaType: "video/mp4", data: "abc", fileId: "existing" }],
      },
    ];

    await uploadMoonshotVideos(client, messages);

    expect(create).not.toHaveBeenCalled();
  });

  it("ignores string-content and non-video parts", async () => {
    const { client, create } = fakeClient([]);
    const messages: Message[] = [
      { role: "user", content: "plain text" },
      { role: "user", content: [{ type: "text", text: "no media" }] },
    ];

    await uploadMoonshotVideos(client, messages);

    expect(create).not.toHaveBeenCalled();
  });

  it("uploads with purpose 'video'", async () => {
    const { client, create } = fakeClient(["file_c"]);
    const messages: Message[] = [
      {
        role: "user",
        content: [{ type: "video", mediaType: "video/mp4", data: "ZGF0YQ==" }],
      },
    ];

    await uploadMoonshotVideos(client, messages);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ purpose: "video" }), undefined);
  });
});
