// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  deleteMemory,
  isMemoryChangeEvent,
  listMemories,
  subscribe,
  type MemorySnapshot,
  type SidecarEvent,
} from "./agent";
import { MemoryModal } from "./MemoryModal";

let eventHandler: ((event: SidecarEvent) => void) | undefined;

vi.mock("./agent", () => ({
  deleteMemory: vi.fn(),
  listMemories: vi.fn(),
  subscribe: vi.fn((handler: (event: SidecarEvent) => void) => {
    eventHandler = handler;
    return vi.fn();
  }),
  isMemoryChangeEvent: vi.fn((event: SidecarEvent) => event.type === "memory_change"),
}));

const listMemoriesMock = vi.mocked(listMemories);
const deleteMemoryMock = vi.mocked(deleteMemory);
const subscribeMock = vi.mocked(subscribe);
const isMemoryChangeEventMock = vi.mocked(isMemoryChangeEvent);

const populated: MemorySnapshot = {
  softLimit: 60,
  hardLimit: 90,
  memories: [
    {
      id: "memory-1",
      text: "Ken prefers concise, scannable answers.",
      category: "preference",
      importance: 5,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
  ],
};

beforeEach(() => {
  eventHandler = undefined;
  listMemoriesMock.mockResolvedValue(populated);
  deleteMemoryMock.mockResolvedValue({ ...populated, memories: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MemoryModal", () => {
  it("displays memory metadata, current limit, and consolidation threshold", async () => {
    render(<MemoryModal onClose={vi.fn()} />);

    expect(await screen.findByText("Ken prefers concise, scannable answers.")).toBeDefined();
    expect(screen.getByText("1 / 90")).toBeDefined();
    expect(screen.getByText(/consolidated once the list reaches 60/)).toBeDefined();
    expect(screen.getByText("preference")).toBeDefined();
    expect(screen.getByLabelText("Importance 5 of 5")).toBeDefined();
  });

  it("deletes exactly one row and applies the returned snapshot", async () => {
    render(<MemoryModal onClose={vi.fn()} />);
    const button = await screen.findByRole("button", {
      name: "Delete memory: Ken prefers concise, scannable answers.",
    });

    fireEvent.click(button);

    await waitFor(() => expect(deleteMemoryMock).toHaveBeenCalledWith("memory-1"));
    expect(await screen.findByText("No durable memories yet.")).toBeDefined();
    expect(screen.getByText("0 / 90")).toBeDefined();
  });

  it("renders a compact empty state", async () => {
    listMemoriesMock.mockResolvedValue({ ...populated, memories: [] });
    render(<MemoryModal onClose={vi.fn()} />);
    expect(await screen.findByText("No durable memories yet.")).toBeDefined();
  });

  it("renders a load error", async () => {
    listMemoriesMock.mockRejectedValue(new Error("daemon unavailable"));
    render(<MemoryModal onClose={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn’t load memories: daemon unavailable",
    );
  });

  it("refreshes live when the agent broadcasts memory_change", async () => {
    const refreshed = {
      ...populated,
      memories: [
        ...populated.memories,
        {
          ...populated.memories[0]!,
          id: "memory-2",
          text: "Ken is building durable chat memory.",
          category: "project" as const,
        },
      ],
    };
    listMemoriesMock.mockResolvedValueOnce(populated).mockResolvedValueOnce(refreshed);
    render(<MemoryModal onClose={vi.fn()} />);
    await screen.findByText("1 / 90");

    eventHandler?.({ type: "memory_change", data: { count: 2 } });

    expect(await screen.findByText("Ken is building durable chat memory.")).toBeDefined();
    expect(screen.getByText("2 / 90")).toBeDefined();
    expect(isMemoryChangeEventMock).toHaveBeenCalled();
    expect(subscribeMock).toHaveBeenCalledOnce();
  });
});
