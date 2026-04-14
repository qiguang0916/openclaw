import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logWarnMock, logDebugMock, logInfoMock } = vi.hoisted(() => ({
  logWarnMock: vi.fn(),
  logDebugMock: vi.fn(),
  logInfoMock: vi.fn(),
}));

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: (signal?: NodeJS.Signals) => void;
  closeWith: (code?: number | null) => void;
};

function createMockChild(params?: { autoClose?: boolean }): MockChild {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as MockChild;
  child.stdout = stdout;
  child.stderr = stderr;
  child.closeWith = (code = 0) => {
    child.emit("close", code);
  };
  child.kill = () => {};
  if (params?.autoClose !== false) {
    queueMicrotask(() => {
      child.emit("close", 0);
    });
  }
  return child;
}

function emitAndClose(
  child: MockChild,
  stream: "stdout" | "stderr",
  data: string,
  code: number = 0,
) {
  queueMicrotask(() => {
    child[stream].emit("data", data);
    child.closeWith(code);
  });
}

vi.mock("openclaw/plugin-sdk/memory-core-host-engine-foundation", async () => {
  const actual = await vi.importActual<
    typeof import("openclaw/plugin-sdk/memory-core-host-engine-foundation")
  >("openclaw/plugin-sdk/memory-core-host-engine-foundation");
  return {
    ...actual,
    createSubsystemLogger: () => {
      const logger = {
        warn: logWarnMock,
        debug: logDebugMock,
        info: logInfoMock,
        child: () => logger,
      };
      return logger;
    },
  };
});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

import { spawn as mockedSpawn } from "node:child_process";
import type { OpenClawConfig } from "openclaw/plugin-sdk/memory-core-host-engine-foundation";
import { resolveMemoryBackendConfig } from "openclaw/plugin-sdk/memory-core-host-engine-storage";
import { QmdMemoryManager } from "./qmd-manager.js";

const spawnMock = mockedSpawn as unknown as Mock;

describe("QmdMemoryManager scheduling", () => {
  let tmpRoot: string;
  let workspaceDir: string;
  let stateDir: string;
  let cfg: OpenClawConfig;
  const agentId = "main";
  const openManagers = new Set<QmdMemoryManager>();

  function trackManager<T extends QmdMemoryManager | null>(manager: T): T {
    if (manager) {
      openManagers.add(manager);
    }
    return manager;
  }

  async function createManager(params?: { cfg?: OpenClawConfig }) {
    const cfgToUse = params?.cfg ?? cfg;
    const resolved = resolveMemoryBackendConfig({ cfg: cfgToUse, agentId });
    const manager = trackManager(
      await QmdMemoryManager.create({
        cfg: cfgToUse,
        agentId,
        resolved,
        mode: "status",
      }),
    );
    if (!manager) {
      throw new Error("manager missing");
    }
    return { manager, resolved };
  }

  beforeEach(async () => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => createMockChild());
    logWarnMock.mockClear();
    logDebugMock.mockClear();
    logInfoMock.mockClear();

    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-qmd-scheduling-"));
    workspaceDir = path.join(tmpRoot, "workspace");
    stateDir = path.join(tmpRoot, "state");
    await fs.mkdir(workspaceDir, { recursive: true });
    process.env.OPENCLAW_STATE_DIR = stateDir;

    cfg = {
      agents: {
        list: [{ id: agentId, default: true, workspace: workspaceDir }],
      },
      memory: {
        backend: "qmd",
        qmd: {
          includeDefaultMemory: false,
          update: { interval: "0s", debounceMs: 60_000, onBoot: false },
          paths: [{ path: workspaceDir, pattern: "**/*.md", name: "workspace" }],
        },
      },
    } as OpenClawConfig;
  });

  afterEach(async () => {
    await Promise.all(
      Array.from(openManagers, async (manager) => {
        await manager.close();
      }),
    );
    openManagers.clear();
    await fs.rm(tmpRoot, { recursive: true, force: true });
    vi.useRealTimers();
    delete process.env.OPENCLAW_STATE_DIR;
  });

  it("schedules periodic embed maintenance when regular update scheduling is disabled", async () => {
    cfg = {
      ...cfg,
      memory: {
        backend: "qmd",
        qmd: {
          includeDefaultMemory: false,
          update: {
            interval: "0s",
            debounceMs: 0,
            onBoot: false,
            embedInterval: "5m",
          },
          paths: [{ path: workspaceDir, pattern: "**/*.md", name: "workspace" }],
        },
      },
    } as OpenClawConfig;

    const { manager } = await createManager();
    expect(
      (
        manager as unknown as {
          shouldScheduleEmbedTimer: () => boolean;
        }
      ).shouldScheduleEmbedTimer(),
    ).toBe(true);
  });

  it("schedules periodic embed maintenance when embed cadence is faster than update cadence", async () => {
    cfg = {
      ...cfg,
      memory: {
        backend: "qmd",
        qmd: {
          includeDefaultMemory: false,
          update: {
            interval: "20m",
            debounceMs: 0,
            onBoot: false,
            embedInterval: "5m",
          },
          paths: [{ path: workspaceDir, pattern: "**/*.md", name: "workspace" }],
        },
      },
    } as OpenClawConfig;

    const { manager } = await createManager();
    expect(
      (
        manager as unknown as {
          shouldScheduleEmbedTimer: () => boolean;
        }
      ).shouldScheduleEmbedTimer(),
    ).toBe(true);
  });

  it("does not schedule periodic embed maintenance when regular updates are already more frequent", async () => {
    cfg = {
      ...cfg,
      memory: {
        backend: "qmd",
        qmd: {
          includeDefaultMemory: false,
          update: {
            interval: "5m",
            debounceMs: 0,
            onBoot: false,
            embedInterval: "20m",
          },
          paths: [{ path: workspaceDir, pattern: "**/*.md", name: "workspace" }],
        },
      },
    } as OpenClawConfig;

    const { manager } = await createManager();
    expect(
      (
        manager as unknown as {
          shouldScheduleEmbedTimer: () => boolean;
        }
      ).shouldScheduleEmbedTimer(),
    ).toBe(false);
  });

  it("returns a stable startup jitter for the same config", async () => {
    cfg = {
      ...cfg,
      memory: {
        backend: "qmd",
        qmd: {
          includeDefaultMemory: false,
          update: {
            interval: "0s",
            debounceMs: 0,
            onBoot: false,
            embedInterval: "5m",
          },
          paths: [{ path: workspaceDir, pattern: "**/*.md", name: "workspace" }],
        },
      },
    } as OpenClawConfig;

    const { manager: firstManager } = await createManager();
    const { manager: secondManager } = await createManager();
    const firstJitter = (
      firstManager as unknown as {
        resolveEmbedStartupJitterMs: () => number;
      }
    ).resolveEmbedStartupJitterMs();
    const secondJitter = (
      secondManager as unknown as {
        resolveEmbedStartupJitterMs: () => number;
      }
    ).resolveEmbedStartupJitterMs();
    expect(firstJitter).toBeGreaterThanOrEqual(0);
    expect(firstJitter).toBeLessThanOrEqual(5 * 60_000);
    expect(secondJitter).toBe(firstJitter);
  });

  it("computes stable startup jitter when custom collections exist", async () => {
    const customRoot = path.join(tmpRoot, "custom");
    await fs.mkdir(customRoot, { recursive: true });
    cfg = {
      ...cfg,
      memory: {
        backend: "qmd",
        qmd: {
          includeDefaultMemory: false,
          update: {
            interval: "0s",
            debounceMs: 0,
            onBoot: false,
            embedInterval: "5m",
          },
          paths: [{ path: customRoot, pattern: "**/*.md", name: "custom" }],
        },
      },
    } as OpenClawConfig;

    const { manager } = await createManager();
    const jitter = (
      manager as unknown as {
        resolveEmbedStartupJitterMs: () => number;
      }
    ).resolveEmbedStartupJitterMs();
    expect(jitter).toBeGreaterThanOrEqual(0);
    expect(jitter).toBeLessThanOrEqual(5 * 60_000);
  });

  it("runs qmd embed in search mode for forced sync", async () => {
    cfg = {
      ...cfg,
      memory: {
        backend: "qmd",
        qmd: {
          includeDefaultMemory: false,
          searchMode: "search",
          update: { interval: "0s", debounceMs: 0, onBoot: false },
          paths: [{ path: workspaceDir, pattern: "**/*.md", name: "workspace" }],
        },
      },
    } as OpenClawConfig;

    const { manager } = await createManager();
    await manager.sync({ reason: "manual", force: true });

    const commandCalls = spawnMock.mock.calls
      .map((call: unknown[]) => call[1] as string[])
      .filter((args: string[]) => args[0] === "update" || args[0] === "embed");
    expect(commandCalls).toEqual([["update"], ["embed"]]);
  });

  it("retries boot update when qmd reports a retryable lock error", async () => {
    vi.useFakeTimers();
    const { manager } = await createManager();
    const busyError = new Error("SQLITE_BUSY: database is locked");
    const runQmdUpdateOnceSpy = vi
      .spyOn(
        manager as unknown as {
          runQmdUpdateOnce: (reason: string) => Promise<void>;
        },
        "runQmdUpdateOnce",
      )
      .mockRejectedValueOnce(busyError)
      .mockResolvedValueOnce(undefined);
    const isRetryableUpdateErrorSpy = vi
      .spyOn(
        manager as unknown as {
          isRetryableUpdateError: (err: unknown) => boolean;
        },
        "isRetryableUpdateError",
      )
      .mockReturnValue(true);

    const retryPromise = (
      manager as unknown as {
        runQmdUpdateWithRetry: (reason: string) => Promise<void>;
      }
    ).runQmdUpdateWithRetry("boot");
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    await expect(retryPromise).resolves.toBeUndefined();

    expect(runQmdUpdateOnceSpy).toHaveBeenCalledTimes(2);
    expect(runQmdUpdateOnceSpy.mock.calls).toEqual([["boot"], ["boot"]]);
    expect(isRetryableUpdateErrorSpy).toHaveBeenCalledWith(busyError);
  });

  it("succeeds on qmd update even when stdout exceeds the output cap", async () => {
    const largeOutput = "x".repeat(300_000);
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "update") {
        const child = createMockChild({ autoClose: false });
        emitAndClose(child, "stdout", largeOutput);
        return child;
      }
      return createMockChild();
    });

    const { manager } = await createManager();
    await expect(manager.sync({ reason: "manual" })).resolves.toBeUndefined();
  });
});
