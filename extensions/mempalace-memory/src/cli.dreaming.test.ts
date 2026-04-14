import { beforeEach, describe, expect, it, vi } from "vitest";
import { cliDreamingTesting } from "./cli-dreaming.js";

const dreamingMock = vi.hoisted(() => ({
  runNow: vi.fn(
    async (..._args: unknown[]): Promise<unknown> => ({
      agentId: "openclaw-optimizer",
      workspaceDir: "/tmp/openclaw-optimizer-workspace",
      aggregateCount: 2,
      diary: {
        topic: "dreaming-light",
      },
      drawer: {
        wing: "OpenClaw Dreaming",
        room: "openclaw-optimizer",
        drawerId: "drawer_123",
      },
      kgFacts: [
        {
          subject: "openclaw-optimizer",
          predicate: "dreaming focus",
          object: "Jarvis preferences",
          validFrom: "2026-04-11",
        },
      ],
    }),
  ),
  resolveConfig: vi.fn((..._args: unknown[]) => ({
    enabled: true,
    cron: "0 3 * * *",
    timezone: "America/Los_Angeles",
    lookbackDays: 7,
    limit: 6,
    kgThemes: 3,
  })),
}));

const managerMock = vi.hoisted(() => ({
  get: vi.fn(
    async (..._args: unknown[]): Promise<unknown> => ({
      manager: {
        search: vi.fn(async () => [
          {
            path: "mempalace/private/kg/v1/test.md",
            startLine: 1,
            endLine: 3,
            score: 0.9,
            snippet: "Jarvis -> prefers -> low-token recall",
            source: "memory",
          },
        ]),
        close: vi.fn(async () => undefined),
      },
    }),
  ),
}));

const recallMock = vi.hoisted(() => ({
  emit: vi.fn(),
}));

const runtimeMock = vi.hoisted(() => ({
  readMemoryHostEvents: vi.fn(async () => []),
  resolveAgentWorkspaceDir: vi.fn(() => "/tmp/openclaw-optimizer-workspace"),
}));

vi.mock("openclaw/plugin-sdk/memory-core-host-runtime-cli", () => ({
  isRich: () => false,
  theme: {
    heading: (value: string) => value,
    muted: (value: string) => value,
    success: (value: string) => value,
    warn: (value: string) => value,
    info: (value: string) => value,
  },
}));

vi.mock("openclaw/plugin-sdk/memory-core-host-runtime-core", () => ({
  loadConfig: () => ({}),
}));

vi.mock("./cli-dreaming.runtime.js", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runMempalaceDreamingNow: (...args: any[]) => dreamingMock.runNow.apply(undefined, args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getActiveMemorySearchManager: (...args: any[]) => managerMock.get.apply(undefined, args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitCliRecallEvent: (...args: any[]) => recallMock.emit.apply(undefined, args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readMemoryHostEvents: (...args: any[]) =>
    Reflect.apply(runtimeMock.readMemoryHostEvents, undefined, args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolveAgentWorkspaceDir: (...args: any[]) =>
    Reflect.apply(runtimeMock.resolveAgentWorkspaceDir, undefined, args),
}));

describe("mempalace-memory CLI dreaming helpers", () => {
  beforeEach(() => {
    dreamingMock.runNow.mockReset();
    dreamingMock.resolveConfig.mockReset();
    managerMock.get.mockReset();
    recallMock.emit.mockReset();
    dreamingMock.runNow.mockResolvedValue({
      agentId: "openclaw-optimizer",
      workspaceDir: "/tmp/openclaw-optimizer-workspace",
      aggregateCount: 2,
      diary: {
        topic: "dreaming-light",
      },
      drawer: {
        wing: "OpenClaw Dreaming",
        room: "openclaw-optimizer",
        drawerId: "drawer_123",
      },
      kgFacts: [
        {
          subject: "openclaw-optimizer",
          predicate: "dreaming focus",
          object: "Jarvis preferences",
          validFrom: "2026-04-11",
        },
      ],
    });
    managerMock.get.mockResolvedValue({
      manager: {
        search: vi.fn(async () => [
          {
            path: "mempalace/private/kg/v1/test.md",
            startLine: 1,
            endLine: 3,
            score: 0.9,
            snippet: "Jarvis -> prefers -> low-token recall",
            source: "memory",
          },
        ]),
        close: vi.fn(async () => undefined),
      },
    });
    dreamingMock.resolveConfig.mockReturnValue({
      enabled: true,
      cron: "0 3 * * *",
      timezone: "America/Los_Angeles",
      lookbackDays: 7,
      limit: 6,
      kgThemes: 3,
    });
    runtimeMock.readMemoryHostEvents.mockReset();
    runtimeMock.readMemoryHostEvents.mockResolvedValue([]);
    runtimeMock.resolveAgentWorkspaceDir.mockReset();
    runtimeMock.resolveAgentWorkspaceDir.mockReturnValue("/tmp/openclaw-optimizer-workspace");
  });

  it("formats status using the resolved dreaming config", async () => {
    const output = cliDreamingTesting.formatDreamingStatusLines({
      agentId: "openclaw-optimizer",
      cfg: {} as never,
    });

    expect(output.join("\n")).toContain("Dreaming (openclaw-optimizer)");
    expect(output.join("\n")).toContain("Enabled:");
    expect(output.join("\n")).toContain("0 3 * * *");
    expect(output.join("\n")).toContain("kgThemes");
  });

  it("runs dreaming now and returns a compact success payload", async () => {
    const result = await cliDreamingTesting.runDreamingNowForCli({
      cfg: {} as never,
      agentId: "openclaw-optimizer",
    });

    expect(dreamingMock.runNow).toHaveBeenCalledWith({
      cfg: {} as never,
      agentId: "openclaw-optimizer",
    });
    expect(result).toEqual({
      agentId: "openclaw-optimizer",
      workspaceDir: "/tmp/openclaw-optimizer-workspace",
      aggregateCount: 2,
      diary: {
        topic: "dreaming-light",
      },
      drawer: {
        wing: "OpenClaw Dreaming",
        room: "openclaw-optimizer",
        drawerId: "drawer_123",
      },
      kgFacts: [
        {
          subject: "openclaw-optimizer",
          predicate: "dreaming focus",
          object: "Jarvis preferences",
          validFrom: "2026-04-11",
        },
      ],
    });
  });

  it("verifies dreaming after optionally seeding recall from a CLI search", async () => {
    const result = await cliDreamingTesting.runDreamingVerifyForCli({
      cfg: {} as never,
      agentId: "openclaw-optimizer",
      query: "Jarvis preferences",
      maxResults: 5,
    });

    expect(managerMock.get).toHaveBeenCalledTimes(1);
    expect(recallMock.emit).toHaveBeenCalledWith({
      cfg: {} as never,
      agentId: "openclaw-optimizer",
      query: "Jarvis preferences",
      results: [
        expect.objectContaining({
          path: "mempalace/private/kg/v1/test.md",
        }),
      ],
    });
    expect(result).toMatchObject({
      agentId: "openclaw-optimizer",
      query: "Jarvis preferences",
      run: {
        agentId: "openclaw-optimizer",
      },
    });
  });
});
