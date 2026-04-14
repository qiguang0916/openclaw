import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  acquireLocalHeavyCheckLockSync,
  applyLocalOxlintPolicy,
  applyLocalTsgoPolicy,
  resolveLocalHeavyCheckLocksDirs,
} from "../../scripts/lib/local-heavy-check-runtime.mjs";
import { createScriptTestHarness } from "./test-helpers.js";

const { createTempDir } = createScriptTestHarness();
const GIB = 1024 ** 3;
const CONSTRAINED_HOST = {
  totalMemoryBytes: 16 * GIB,
  logicalCpuCount: 8,
};
const ROOMY_HOST = {
  totalMemoryBytes: 128 * GIB,
  logicalCpuCount: 16,
};

function makeEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    ...process.env,
    OPENCLAW_LOCAL_CHECK: "1",
    ...overrides,
  };
}

describe("local-heavy-check-runtime", () => {
  it("tightens local tsgo runs on constrained hosts", () => {
    const { args, env } = applyLocalTsgoPolicy([], makeEnv(), CONSTRAINED_HOST);

    expect(args).toEqual(["--singleThreaded", "--checkers", "1"]);
    expect(env.GOGC).toBe("30");
    expect(env.GOMEMLIMIT).toBe("3GiB");
  });

  it("keeps explicit tsgo flags and Go env overrides intact when throttled", () => {
    const { args, env } = applyLocalTsgoPolicy(
      ["--checkers", "4", "--singleThreaded", "--pprofDir", "/tmp/existing"],
      makeEnv({
        GOGC: "80",
        GOMEMLIMIT: "5GiB",
        OPENCLAW_TSGO_PPROF_DIR: "/tmp/profile",
      }),
      CONSTRAINED_HOST,
    );

    expect(args).toEqual(["--checkers", "4", "--singleThreaded", "--pprofDir", "/tmp/existing"]);
    expect(env.GOGC).toBe("80");
    expect(env.GOMEMLIMIT).toBe("5GiB");
  });

  it("keeps local tsgo at full speed on roomy hosts in auto mode", () => {
    const { args, env } = applyLocalTsgoPolicy([], makeEnv(), ROOMY_HOST);

    expect(args).toEqual([]);
    expect(env.GOGC).toBeUndefined();
    expect(env.GOMEMLIMIT).toBeUndefined();
  });

  it("allows forcing the throttled tsgo policy on roomy hosts", () => {
    const { args, env } = applyLocalTsgoPolicy(
      [],
      makeEnv({
        OPENCLAW_LOCAL_CHECK_MODE: "throttled",
      }),
      ROOMY_HOST,
    );

    expect(args).toEqual(["--singleThreaded", "--checkers", "1"]);
    expect(env.GOGC).toBe("30");
    expect(env.GOMEMLIMIT).toBe("3GiB");
  });

  it("serializes local oxlint runs onto one thread on constrained hosts", () => {
    const { args } = applyLocalOxlintPolicy([], makeEnv(), CONSTRAINED_HOST);

    expect(args).toEqual(["--type-aware", "--tsconfig", "tsconfig.oxlint.json", "--threads=1"]);
  });

  it("keeps local oxlint parallel on roomy hosts in auto mode", () => {
    const { args } = applyLocalOxlintPolicy([], makeEnv(), ROOMY_HOST);

    expect(args).toEqual(["--type-aware", "--tsconfig", "tsconfig.oxlint.json"]);
  });

  it("reclaims stale local heavy-check locks from dead pids", () => {
    const cwd = createTempDir("openclaw-local-heavy-check-");
    const commonDir = path.join(cwd, ".git");
    const lockDir = path.join(commonDir, "openclaw-local-checks", "heavy-check.lock");
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(
      path.join(lockDir, "owner.json"),
      `${JSON.stringify({
        pid: 999_999_999,
        tool: "tsgo",
        cwd,
      })}\n`,
      "utf8",
    );

    const release = acquireLocalHeavyCheckLockSync({
      cwd,
      env: makeEnv(),
      toolName: "oxlint",
    });

    const owner = JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8"));
    expect(owner.pid).toBe(process.pid);
    expect(owner.tool).toBe("oxlint");

    release();
    expect(fs.existsSync(lockDir)).toBe(false);
  });

  it("falls back to a temp lock directory when the git common dir is not writable", () => {
    const cwd = createTempDir("openclaw-local-heavy-check-");
    const [primaryLocksDir, fallbackLocksDir] = resolveLocalHeavyCheckLocksDirs(cwd, makeEnv());
    const originalMkdirSync = fs.mkdirSync.bind(fs);
    const mkdirSync = vi.spyOn(fs, "mkdirSync");

    mkdirSync.mockImplementation(((targetPath: fs.PathLike, options?: fs.MakeDirectoryOptions) => {
      if (path.resolve(String(targetPath)) === path.resolve(primaryLocksDir)) {
        const err = new Error("permission denied") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }
      return originalMkdirSync(targetPath, options);
    }) as typeof fs.mkdirSync);

    const release = acquireLocalHeavyCheckLockSync({
      cwd,
      env: makeEnv(),
      toolName: "test",
    });

    const fallbackLockDir = path.join(fallbackLocksDir, "heavy-check.lock");
    const owner = JSON.parse(fs.readFileSync(path.join(fallbackLockDir, "owner.json"), "utf8"));
    expect(owner.pid).toBe(process.pid);
    expect(owner.tool).toBe("test");
    expect(fallbackLocksDir.startsWith(path.join(os.tmpdir(), "openclaw-local-checks"))).toBe(true);

    release();
    expect(fs.existsSync(fallbackLockDir)).toBe(false);
  });

  it("falls back to a temp lock directory when creating the lock dir is denied", () => {
    const cwd = createTempDir("openclaw-local-heavy-check-");
    const [primaryLocksDir, fallbackLocksDir] = resolveLocalHeavyCheckLocksDirs(cwd, makeEnv());
    fs.mkdirSync(primaryLocksDir, { recursive: true });
    fs.chmodSync(primaryLocksDir, 0o500);

    const release = acquireLocalHeavyCheckLockSync({
      cwd,
      env: makeEnv(),
      toolName: "test",
    });

    const fallbackLockDir = path.join(fallbackLocksDir, "heavy-check.lock");
    const owner = JSON.parse(fs.readFileSync(path.join(fallbackLockDir, "owner.json"), "utf8"));
    expect(owner.pid).toBe(process.pid);
    expect(owner.tool).toBe("test");

    release();
    fs.chmodSync(primaryLocksDir, 0o700);
    expect(fs.existsSync(fallbackLockDir)).toBe(false);
  });
});
