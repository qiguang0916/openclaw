import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMempalaceAddDrawerTool, createMempalaceKgQueryTool } from "./tools.js";

const bridgeMocks = vi.hoisted(() => ({
  callMempalaceTool: vi.fn(),
}));

const configState = vi.hoisted(() => ({
  resolved: {
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
  },
}));

vi.mock("./bridge.js", () => ({
  callMempalaceTool: bridgeMocks.callMempalaceTool,
}));
vi.mock("./config.js", () => ({
  resolveMempalacePluginConfig: () => configState.resolved,
}));

describe("mempalace-memory native tools", () => {
  beforeEach(() => {
    bridgeMocks.callMempalaceTool.mockReset();
  });

  it("normalizes drawer write params before calling the MemPalace MCP tool", async () => {
    bridgeMocks.callMempalaceTool.mockResolvedValue({
      success: true,
      drawer_id: "drawer_123",
    });
    const tool = createMempalaceAddDrawerTool({
      config: {} as never,
      agentSessionKey: "agent:main",
    });

    const result = await tool?.execute?.("call_add_drawer", {
      wing: "OpenClaw Sessions",
      room: "main",
      content: "Keep this durable.",
      sourceFile: "memory://session/2026-04-13",
      addedBy: "openclaw-tests",
    });

    expect(bridgeMocks.callMempalaceTool).toHaveBeenCalledWith({
      cfg: {} as never,
      agentId: "main",
      toolName: "mempalace_add_drawer",
      palacePath: "/tmp/private-palace",
      arguments: {
        wing: "OpenClaw Sessions",
        room: "main",
        content: "Keep this durable.",
        source_file: "memory://session/2026-04-13",
        added_by: "openclaw-tests",
      },
    });
    expect(result).toMatchObject({
      details: {
        success: true,
        drawer_id: "drawer_123",
      },
    });
  });

  it("maps maxResults to the MCP max_results field for KG queries", async () => {
    bridgeMocks.callMempalaceTool.mockResolvedValue({
      facts: [{ subject: "OpenClaw", predicate: "uses", object: "MemPalace" }],
    });
    const tool = createMempalaceKgQueryTool({
      config: {} as never,
      agentSessionKey: "agent:main",
    });

    const result = await tool?.execute?.("call_kg_query", {
      query: "OpenClaw MemPalace",
      maxResults: 4,
    });

    expect(bridgeMocks.callMempalaceTool).toHaveBeenCalledWith({
      cfg: {} as never,
      agentId: "main",
      toolName: "mempalace_kg_query",
      palacePath: "/tmp/private-palace",
      arguments: {
        query: "OpenClaw MemPalace",
        max_results: 4,
      },
    });
    expect(result).toMatchObject({
      details: {
        facts: [{ subject: "OpenClaw", predicate: "uses", object: "MemPalace" }],
      },
    });
  });
});
