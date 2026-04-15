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
// Prevent the memory-core-engine-runtime.ts → facade-runtime.ts → jiti chain
// from loading during Vitest thread worker startup. These modules have
// module-level side effects (jiti loader setup, filesystem traversal) that
// can block the Vitest worker thread when run as a standalone test file.
vi.mock("openclaw/plugin-sdk/memory-core", () => ({
  jsonResult: (data: unknown) => ({ details: data }),
  readNumberParam: (params: Record<string, unknown>, key: string) =>
    typeof params[key] === "number" ? params[key] : undefined,
  readStringParam: (
    params: Record<string, unknown>,
    key: string,
    opts?: { required?: boolean },
  ) => {
    const v = params[key];
    if (typeof v === "string") {
      return v;
    }
    if (opts?.required) {
      throw new Error(`Missing required param: ${key}`);
    }
    return undefined;
  },
  resolveAgentWorkspaceDir: () => null,
  resolveSessionAgentId: (params: { sessionKey?: string }) =>
    params.sessionKey?.split(":").at(-1) ?? "default",
  type: {},
}));
// Prevent manager.ts from loading memory-core-host-runtime-files and its
// transitive core imports.
vi.mock("./manager.js", () => ({
  getMempalaceMemorySearchManager: vi.fn(),
}));
vi.mock("./recall-events.js", () => ({
  queueRecallEvent: vi.fn(),
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
