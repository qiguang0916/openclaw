import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  buildVitestRunPlans,
  registerProcessCleanupHandlers,
  resolveChangedTargetArgs,
} from "../../scripts/test-projects.test-support.mjs";

describe("scripts/test-projects changed-target routing", () => {
  it("maps changed source files into scoped lane targets", () => {
    expect(
      resolveChangedTargetArgs(["--changed", "origin/main"], process.cwd(), () => [
        "src/shared/string-normalization.ts",
        "src/utils/provider-utils.ts",
      ]),
    ).toEqual(["src/shared/string-normalization.ts", "src/utils/provider-utils.ts"]);
  });

  it("keeps the broad changed run for Vitest wiring edits", () => {
    expect(
      resolveChangedTargetArgs(["--changed", "origin/main"], process.cwd(), () => [
        "vitest.shared.config.ts",
        "src/utils/provider-utils.ts",
      ]),
    ).toBeNull();
  });

  it("ignores changed files that cannot map to test lanes", () => {
    expect(
      resolveChangedTargetArgs(["--changed", "origin/main"], process.cwd(), () => [
        "docs/help/testing.md",
      ]),
    ).toBeNull();
  });

  it("narrows default-lane changed source files to include globs", () => {
    const plans = buildVitestRunPlans(["--changed", "origin/main"], process.cwd(), () => [
      "packages/sdk/src/index.ts",
    ]);

    expect(plans).toEqual([
      {
        config: "vitest.unit.config.ts",
        forwardedArgs: [],
        includePatterns: ["packages/sdk/src/**/*.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("routes changed utils and shared files to their light scoped lanes", () => {
    const plans = buildVitestRunPlans(["--changed", "origin/main"], process.cwd(), () => [
      "src/shared/string-normalization.ts",
      "src/utils/provider-utils.ts",
    ]);

    expect(plans).toEqual([
      {
        config: "vitest.shared-core.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/shared/**/*.test.ts"],
        watchMode: false,
      },
      {
        config: "vitest.utils.config.ts",
        forwardedArgs: [],
        includePatterns: ["src/utils/**/*.test.ts"],
        watchMode: false,
      },
    ]);
  });

  it("releases the heavy-check lock and exits on SIGINT", () => {
    const proc = new EventEmitter();
    const release = vi.fn();
    const exit = vi.fn();
    proc.exit = exit;

    const unregister = registerProcessCleanupHandlers({ process: proc, release, exit });
    proc.emit("SIGINT");

    expect(release).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(130);
    unregister();
  });

  it("releases the heavy-check lock on normal process exit", () => {
    const proc = new EventEmitter();
    const release = vi.fn();
    const exit = vi.fn();
    proc.exit = exit;

    const unregister = registerProcessCleanupHandlers({ process: proc, release, exit });
    proc.emit("exit");

    expect(release).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    unregister();
  });
});
