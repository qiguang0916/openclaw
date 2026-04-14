import type { MemorySearchResult } from "openclaw/plugin-sdk/memory-core-host-runtime-files";
import { beforeEach, describe, expect, it, vi } from "vitest";

const recallMock = vi.hoisted(() => ({
  queue: vi.fn(),
}));

vi.mock("./recall-events.js", () => ({
  queueRecallEvent: (...args: unknown[]) => recallMock.queue.apply(undefined, args),
}));

describe("emitCliRecallEvent", () => {
  beforeEach(() => {
    recallMock.queue.mockReset();
  });

  it("forwards surfaced CLI search results into the recall-event pipeline", async () => {
    const { emitCliRecallEvent } = await import("./cli-recall.js");
    const results: MemorySearchResult[] = [
      {
        path: "mempalace/private/kg/v1/test.md",
        startLine: 1,
        endLine: 3,
        score: 0.9,
        snippet: "Jarvis -> prefers -> low-token recall",
        source: "memory",
      },
    ];

    emitCliRecallEvent({
      cfg: {} as never,
      agentId: "openclaw-optimizer",
      query: "Jarvis preferences",
      results,
    });

    expect(recallMock.queue).toHaveBeenCalledWith({
      cfg: {} as never,
      agentId: "openclaw-optimizer",
      query: "Jarvis preferences",
      results: [
        {
          path: "mempalace/private/kg/v1/test.md",
          startLine: 1,
          endLine: 3,
          score: 0.9,
        },
      ],
    });
  });
});
