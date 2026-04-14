import { beforeEach, describe, expect, it, vi } from "vitest";
import { MempalaceMemoryManager } from "./manager.js";

const bridgeMocks = vi.hoisted(() => ({
  searchDrawerMemories: vi.fn(),
  searchKnowledgeGraph: vi.fn(() => []),
  buildSyntheticPath: vi.fn(
    (params: { scope: string; kind: string; wing?: string; room?: string }) =>
      `mempalace/${params.scope}/${params.kind}/${params.wing ?? "kg"}/${params.room ?? "fact"}.md`,
  ),
  getMempalaceStatus: vi.fn(),
  parseSyntheticPath: vi.fn(),
  readDrawerBySyntheticPath: vi.fn(),
  readKnowledgeGraphFact: vi.fn(),
}));

vi.mock("./bridge.js", () => bridgeMocks);
vi.mock("./config.js", () => ({
  resolveMempalacePluginConfig: () => ({
    enabled: true,
    timeoutMs: 10_000,
    continuityCueBudget: 2,
    sharedPalacePath: undefined,
    sharedKnowledgeGraphPath: undefined,
    privatePalacePath: "/tmp/private-palace",
    privateKnowledgeGraphPath: "/tmp/private-palace/knowledge_graph.sqlite3",
    readShared: false,
    writeShared: false,
    compatSinglePalaceMode: false,
    server: { command: "python", args: [], env: {}, enabled: true, serverName: "mempalace" },
  }),
}));

describe("MempalaceMemoryManager.search", () => {
  beforeEach(() => {
    bridgeMocks.searchDrawerMemories.mockReset();
    bridgeMocks.searchKnowledgeGraph.mockReset();
    bridgeMocks.searchKnowledgeGraph.mockReturnValue([]);
    bridgeMocks.buildSyntheticPath.mockClear();
  });

  it("retries drawer recall with Feishu/Lark query aliases and preserves the best score", async () => {
    bridgeMocks.searchDrawerMemories.mockImplementation(
      async ({ query }: { query: string }): Promise<Array<Record<string, unknown>>> => {
        if (query.includes("飞书")) {
          return [
            {
              text: "飞书渠道配置与 OpenClaw 工作流桥接",
              wing: "OpenClaw Memory",
              room: "Feishu",
              similarity: 0.72,
            },
          ];
        }
        return [
          {
            text: "OpenClaw workflow note",
            wing: "OpenClaw Memory",
            room: "Feishu",
            similarity: 0.21,
          },
        ];
      },
    );

    const manager = new MempalaceMemoryManager({} as never, "main");
    const results = await manager.search("feishu lark channel", {
      maxResults: 3,
      minScore: 0.15,
    });

    expect(
      bridgeMocks.searchDrawerMemories.mock.calls.some(
        ([call]) => typeof call?.query === "string" && call.query.includes("飞书"),
      ),
    ).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      score: 0.72,
      snippet: "飞书渠道配置与 OpenClaw 工作流桥接",
    });
  });
});
