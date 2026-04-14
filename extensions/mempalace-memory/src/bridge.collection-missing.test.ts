import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("./config.js", () => ({
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
    server: { command: "python3", args: [], env: {}, enabled: true, serverName: "mempalace" },
  }),
}));

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: {
    write: (chunk: string) => void;
    end: () => void;
  };
};

function createMockChild(params: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    write: vi.fn(),
    end: () => {
      if (params.stdout) {
        child.stdout.emit("data", params.stdout);
      }
      if (params.stderr) {
        child.stderr.emit("data", params.stderr);
      }
      child.emit("close", params.exitCode ?? 0);
    },
  };
  return child;
}

describe("mempalace bridge missing collection handling", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("treats a missing drawers collection as an empty status snapshot", async () => {
    spawnMock.mockReturnValue(
      createMockChild({
        stdout: JSON.stringify({ total_drawers: 0, wings: {}, rooms: {} }),
      }),
    );

    const { getMempalaceStatus } = await import("./bridge.js");

    await expect(
      getMempalaceStatus({
        cfg: {} as never,
        agentId: "jarvis",
        palacePath: "/tmp/mempalace",
      }),
    ).resolves.toEqual({
      total_drawers: 0,
      wings: {},
      rooms: {},
    });

    const script = spawnMock.mock.calls[0]?.[1]?.[1];
    expect(typeof script).toBe("string");
    expect(script).toContain("Collection [mempalace_drawers] does not exist");
  });

  it("treats a missing drawers collection as no search hits", async () => {
    spawnMock.mockReturnValue(
      createMockChild({
        stdout: JSON.stringify({ results: [] }),
      }),
    );

    const { searchDrawerMemories } = await import("./bridge.js");

    await expect(
      searchDrawerMemories({
        cfg: {} as never,
        agentId: "jarvis",
        palacePath: "/tmp/mempalace",
        query: "where did I store the spec",
        maxResults: 5,
      }),
    ).resolves.toEqual([]);

    const script = spawnMock.mock.calls[0]?.[1]?.[1];
    expect(typeof script).toBe("string");
    expect(script).toContain("Collection [mempalace_drawers] does not exist");
  });
});
