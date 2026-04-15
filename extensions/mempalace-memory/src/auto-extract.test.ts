import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../../test/helpers/plugins/plugin-api.js";
import { resolveMempalaceAutoExtractConfig } from "./auto-extract-config.js";
import { __testing, runMempalaceAutoExtract } from "./auto-extract.js";

const bridgeMocks = vi.hoisted(() => ({
  callMempalaceTool: vi.fn(),
  searchDrawerMemories: vi.fn(),
  writeDrawerDirect: vi.fn(),
  writeFtsEntry: vi.fn(),
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
    readShared: true,
    writeShared: true,
    compatSinglePalaceMode: false,
    server: { command: "python", args: [], env: {}, enabled: true, serverName: "mempalace" },
  },
}));

vi.mock("./bridge.js", () => bridgeMocks);
vi.mock("./config.js", () => ({
  resolveMempalacePluginConfig: () => configState.resolved,
}));

describe("extractAutoMemoryCandidates", () => {
  it("extracts standing preference and private continuity from the current turn only", () => {
    const autoExtract = resolveMempalaceAutoExtractConfig({} as never);

    const candidates = __testing.extractAutoMemoryCandidates({
      messages: [
        { role: "user", content: "之前的背景不要再提了。" },
        { role: "assistant", content: "收到。" },
        {
          role: "user",
          content: "从现在开始请用中文回复，尽量简洁。下次继续优化记忆系统。",
        },
        { role: "assistant", content: "好的。" },
      ],
      autoExtract,
    });

    expect(
      candidates.map((candidate) => [candidate.category, candidate.scope, candidate.summary]),
    ).toEqual(
      expect.arrayContaining([
        ["standing_preference", "shared", "从现在开始请用中文回复，尽量简洁。"],
        ["project_continuity", "private", "下次继续优化记忆系统。"],
      ]),
    );
  });

  it("skips question-shaped text unless it is an explicit remember instruction", () => {
    const autoExtract = resolveMempalaceAutoExtractConfig({} as never);

    const candidates = __testing.extractAutoMemoryCandidates({
      messages: [
        {
          role: "user",
          content: "你觉得以后要不要用中文回复？记住这个偏好：以后默认先给结论，再给细节。",
        },
        { role: "assistant", content: "好的。" },
      ],
      autoExtract,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      category: "standing_preference",
      summary: "以后默认先给结论，再给细节。",
    });
  });

  describe("balanced mode", () => {
    const balancedConfig = resolveMempalaceAutoExtractConfig({
      plugins: {
        entries: { "mempalace-memory": { config: { autoExtract: { mode: "balanced" } } } },
      },
    } as never);

    it("captures implicit brevity complaint as standing preference", () => {
      const candidates = __testing.extractAutoMemoryCandidates({
        messages: [
          { role: "user", content: "你的回复太长了，能不能精简一点。" },
          { role: "assistant", content: "好的，我会注意简洁。" },
        ],
        autoExtract: balancedConfig,
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        category: "standing_preference",
        summary: "prefer concise replies",
      });
    });

    it("captures implicit detail complaint as standing preference", () => {
      const candidates = __testing.extractAutoMemoryCandidates({
        messages: [
          { role: "user", content: "这个解释太简单了，能展开说吗。" },
          { role: "assistant", content: "好的，我来详细说明。" },
        ],
        autoExtract: balancedConfig,
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        category: "standing_preference",
        summary: "prefer detailed replies",
      });
    });

    it("captures soft constraint without persistence marker", () => {
      // "不要在回复里加入猜测" has CONSTRAINT_RE ("不要") but no PREFERENCE_RE or PERSISTENCE_RE
      const candidates = __testing.extractAutoMemoryCandidates({
        messages: [
          { role: "user", content: "不要在回复里加入猜测，只给确定的信息就好。" },
          { role: "assistant", content: "收到。" },
        ],
        autoExtract: balancedConfig,
      });

      const constraint = candidates.find((c) => c.category === "standing_constraint");
      expect(constraint).toBeDefined();
      expect(constraint?.priority).toBeGreaterThanOrEqual(60);
    });

    it("boosts priority when assistant confirms", () => {
      const withoutConfirm = __testing.extractAutoMemoryCandidates({
        messages: [
          { role: "user", content: "你的回复太长了，能不能精简一点。" },
          { role: "assistant", content: "我尽量。" },
        ],
        autoExtract: balancedConfig,
      });
      const withConfirm = __testing.extractAutoMemoryCandidates({
        messages: [
          { role: "user", content: "你的回复太长了，能不能精简一点。" },
          { role: "assistant", content: "收到，我会记住保持简洁。" },
        ],
        autoExtract: balancedConfig,
      });

      expect(withConfirm[0]?.priority).toBeGreaterThan(withoutConfirm[0]?.priority ?? 0);
    });

    it("does NOT capture implicit complaints in conservative mode", () => {
      const conservativeConfig = resolveMempalaceAutoExtractConfig({} as never);

      const candidates = __testing.extractAutoMemoryCandidates({
        messages: [
          { role: "user", content: "你的回复太长了，能不能精简一点。" },
          { role: "assistant", content: "好的。" },
        ],
        autoExtract: conservativeConfig,
      });

      expect(candidates).toHaveLength(0);
    });

    it("does NOT capture soft constraints in conservative mode", () => {
      const conservativeConfig = resolveMempalaceAutoExtractConfig({} as never);

      const candidates = __testing.extractAutoMemoryCandidates({
        messages: [
          { role: "user", content: "不要在回复里加入猜测，只给确定的信息就好。" },
          { role: "assistant", content: "收到。" },
        ],
        autoExtract: conservativeConfig,
      });

      expect(candidates).toHaveLength(0);
    });
  });
});

describe("runMempalaceAutoExtract", () => {
  beforeEach(() => {
    bridgeMocks.callMempalaceTool.mockReset();
    bridgeMocks.searchDrawerMemories.mockReset();
    bridgeMocks.writeDrawerDirect.mockReset();
    bridgeMocks.writeFtsEntry.mockReset();
    bridgeMocks.searchDrawerMemories.mockResolvedValue([]);
    bridgeMocks.writeDrawerDirect.mockResolvedValue({ success: true, drawer_id: "drawer_1" });
    bridgeMocks.writeFtsEntry.mockResolvedValue(undefined);
    bridgeMocks.callMempalaceTool.mockResolvedValue({ success: true });
    configState.resolved = {
      enabled: true,
      timeoutMs: 10_000,
      continuityCueBudget: 2,
      sharedPalacePath: "/tmp/shared-palace",
      sharedKnowledgeGraphPath: "/tmp/shared-kg.sqlite3",
      privatePalacePath: "/tmp/private-palace",
      privateKnowledgeGraphPath: "/tmp/private-kg.sqlite3",
      readShared: true,
      writeShared: true,
      compatSinglePalaceMode: false,
      server: { command: "python", args: [], env: {}, enabled: true, serverName: "mempalace" },
    };
  });

  it("writes shared user memory and private continuity to different palaces", async () => {
    const api = createTestPluginApi({
      config: {
        plugins: {
          slots: { memory: "mempalace-memory" },
          entries: { "mempalace-memory": { enabled: true } },
        },
      } as never,
    });

    const results = await runMempalaceAutoExtract({
      api,
      event: {
        success: true,
        messages: [
          {
            role: "user",
            content: "从现在开始请用中文回复，尽量简洁。下次继续优化记忆系统。",
          },
          { role: "assistant", content: "好的。" },
        ],
      },
      ctx: {
        agentId: "jarvis",
        sessionId: "session-auto-memory",
        channelId: "telegram",
        trigger: "user",
      },
    });

    const written = results.filter((result) => result.status === "written");
    expect(written).toHaveLength(2);
    // standing_preference → drawer write on shared palace
    expect(bridgeMocks.writeDrawerDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        palacePath: "/tmp/shared-palace",
        wing: "Jarvis User Preferences",
      }),
    );
    // project_continuity → diary write on private palace
    expect(bridgeMocks.callMempalaceTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "mempalace_diary_write",
        palacePath: "/tmp/private-palace",
      }),
    );
    // FTS index written for the drawer entry
    await vi.waitFor(() => expect(bridgeMocks.writeFtsEntry).toHaveBeenCalledTimes(1));
  });

  it("suppresses near-duplicate candidates before writing", async () => {
    bridgeMocks.searchDrawerMemories.mockResolvedValue([
      {
        similarity: 0.97,
        wing: "Jarvis User Preferences",
        room: "User Profile",
        text: "从现在开始请用中文回复，尽量简洁。",
      },
    ]);

    const api = createTestPluginApi({
      config: {
        plugins: {
          slots: { memory: "mempalace-memory" },
          entries: { "mempalace-memory": { enabled: true } },
        },
      } as never,
    });

    const results = await runMempalaceAutoExtract({
      api,
      event: {
        success: true,
        messages: [
          {
            role: "user",
            content: "从现在开始请用中文回复，尽量简洁。",
          },
          { role: "assistant", content: "好的。" },
        ],
      },
      ctx: {
        agentId: "jarvis",
        sessionId: "session-auto-memory",
        trigger: "user",
      },
    });

    expect(results).toEqual([
      expect.objectContaining({
        status: "duplicate",
        category: "standing_preference",
        scope: "shared",
        summary: "从现在开始请用中文回复，尽量简洁。",
      }),
    ]);
    expect(bridgeMocks.writeDrawerDirect).not.toHaveBeenCalled();
  });

  it("falls back to private storage when shared writes are unavailable", async () => {
    configState.resolved = {
      ...configState.resolved,
      writeShared: false,
    };

    const api = createTestPluginApi({
      config: {
        plugins: {
          slots: { memory: "mempalace-memory" },
          entries: { "mempalace-memory": { enabled: true } },
        },
      } as never,
    });

    const results = await runMempalaceAutoExtract({
      api,
      event: {
        success: true,
        messages: [
          {
            role: "user",
            content: "从现在开始请用中文回复，尽量简洁。",
          },
          { role: "assistant", content: "好的。" },
        ],
      },
      ctx: {
        agentId: "jarvis",
        sessionId: "session-auto-memory",
        trigger: "user",
      },
    });

    expect(results).toEqual([
      expect.objectContaining({
        status: "written",
        category: "standing_preference",
        scope: "private",
        summary: "从现在开始请用中文回复，尽量简洁。",
        storage: "drawer",
      }),
    ]);
    expect(bridgeMocks.writeDrawerDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        palacePath: "/tmp/private-palace",
        wing: "OpenClaw Continuity",
      }),
    );
  });

  it("routes project_continuity to diary write via callMempalaceTool", async () => {
    const api = createTestPluginApi({
      config: {
        plugins: {
          slots: { memory: "mempalace-memory" },
          entries: { "mempalace-memory": { enabled: true } },
        },
      } as never,
    });

    const results = await runMempalaceAutoExtract({
      api,
      event: {
        success: true,
        messages: [
          { role: "user", content: "下次继续优化这个记忆模块。" },
          { role: "assistant", content: "好的，记下来了。" },
        ],
      },
      ctx: { agentId: "jarvis", sessionId: "session-diary", trigger: "user" },
    });

    expect(results).toEqual([
      expect.objectContaining({
        status: "written",
        category: "project_continuity",
        storage: "diary",
      }),
    ]);
    expect(bridgeMocks.callMempalaceTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "mempalace_diary_write" }),
    );
    expect(bridgeMocks.writeDrawerDirect).not.toHaveBeenCalled();
  });

  it("falls back to drawer when diary write fails", async () => {
    bridgeMocks.callMempalaceTool.mockResolvedValue({ success: false, error: "diary unavailable" });

    const api = createTestPluginApi({
      config: {
        plugins: {
          slots: { memory: "mempalace-memory" },
          entries: { "mempalace-memory": { enabled: true } },
        },
      } as never,
    });

    const results = await runMempalaceAutoExtract({
      api,
      event: {
        success: true,
        messages: [
          { role: "user", content: "下次继续优化这个记忆模块。" },
          { role: "assistant", content: "好的。" },
        ],
      },
      ctx: { agentId: "jarvis", sessionId: "session-diary-fallback", trigger: "user" },
    });

    expect(results).toEqual([
      expect.objectContaining({
        status: "written",
        category: "project_continuity",
        storage: "drawer",
      }),
    ]);
    expect(bridgeMocks.writeDrawerDirect).toHaveBeenCalled();
  });

  it("filters candidates below minConfidence", async () => {
    const api = createTestPluginApi({
      config: {
        plugins: {
          slots: { memory: "mempalace-memory" },
          entries: {
            "mempalace-memory": {
              enabled: true,
              config: { autoExtract: { minConfidence: 80 } },
            },
          },
        },
      } as never,
    });

    // project_continuity without explicit remember has priority 60 — below 80
    const results = await runMempalaceAutoExtract({
      api,
      event: {
        success: true,
        messages: [
          { role: "user", content: "下次继续这个任务。" },
          { role: "assistant", content: "好的。" },
        ],
      },
      ctx: { agentId: "jarvis", trigger: "user" },
    });

    expect(results).toHaveLength(0);
    expect(bridgeMocks.writeDrawerDirect).not.toHaveBeenCalled();
    expect(bridgeMocks.callMempalaceTool).not.toHaveBeenCalled();
  });
});
