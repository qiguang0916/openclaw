import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveDreamingDiaryToMempalace } from "./api.js";

const bridgeMocks = vi.hoisted(() => ({
  callMempalaceTool: vi.fn(),
  readDrawerById: vi.fn(),
}));

vi.mock("./src/bridge.js", () => bridgeMocks);
vi.mock("./src/config.js", () => ({
  resolveMempalacePluginConfig: () => ({
    enabled: true,
    timeoutMs: 10_000,
    continuityCueBudget: 2,
    sharedPalacePath: "/tmp/shared-palace",
    sharedKnowledgeGraphPath: "/tmp/shared-kg.sqlite3",
    privatePalacePath: "/tmp/private-palace",
    privateKnowledgeGraphPath: "/tmp/private-kg.sqlite3",
    readShared: false,
    writeShared: false,
    compatSinglePalaceMode: false,
    server: { command: "python", args: [], env: {}, enabled: true, serverName: "mempalace" },
  }),
}));

describe("saveDreamingDiaryToMempalace", () => {
  beforeEach(() => {
    bridgeMocks.callMempalaceTool.mockReset();
    bridgeMocks.callMempalaceTool.mockResolvedValue({
      success: true,
      drawer_id: "drawer_diary_123",
    });
  });

  it("stores the dreaming diary as a provenance-rich drawer instead of an untracked diary entry", async () => {
    const result = await saveDreamingDiaryToMempalace({
      cfg: {} as never,
      agentId: "openclaw-optimizer",
      entry: "SESSION:2026-04-11\nlight.focus: Feishu recall",
      topic: "dreaming-light",
    });

    expect(bridgeMocks.callMempalaceTool).toHaveBeenCalledWith({
      cfg: {} as never,
      agentId: "openclaw-optimizer",
      toolName: "mempalace_add_drawer",
      palacePath: "/tmp/private-palace",
      arguments: {
        wing: "OpenClaw Dream Diary",
        room: "openclaw-optimizer",
        content: "SESSION:2026-04-11\nlight.focus: Feishu recall",
        source_file: "dreaming://diary/dreaming-light",
        added_by: "openclaw-dreaming",
      },
    });
    expect(result).toEqual({
      wing: "OpenClaw Dream Diary",
      room: "openclaw-optimizer",
      drawerId: "drawer_diary_123",
    });
  });
});
