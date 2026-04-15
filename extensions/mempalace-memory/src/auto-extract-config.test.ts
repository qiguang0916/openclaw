import { describe, expect, it } from "vitest";
import { resolveMempalaceAutoExtractConfig } from "./auto-extract-config.js";

describe("resolveMempalaceAutoExtractConfig", () => {
  it("defaults to conservative auto extraction", () => {
    const resolved = resolveMempalaceAutoExtractConfig({} as never);

    expect(resolved).toEqual({
      enabled: true,
      mode: "conservative",
      maxWritesPerTurn: 2,
      maxSourceChars: 1500,
      maxCandidateChars: 280,
      dedupeSimilarity: 0.92,
      writeSharedUserMemory: true,
      writePrivateContinuity: true,
      cooldownTurns: 0,
      minConfidence: 0,
      allowKgWrite: false,
      kgWriteMinConfidence: 95,
      userIdentity: "User",
    });
  });

  it("supports disabling auto extraction explicitly", () => {
    const resolved = resolveMempalaceAutoExtractConfig({
      plugins: {
        entries: {
          "mempalace-memory": {
            config: {
              autoExtract: {
                enabled: false,
                mode: "balanced",
              },
            },
          },
        },
      },
    } as never);

    expect(resolved.enabled).toBe(false);
    expect(resolved.mode).toBe("balanced");
  });

  it("clamps cooldownTurns and minConfidence to valid ranges", () => {
    const resolved = resolveMempalaceAutoExtractConfig({
      plugins: {
        entries: {
          "mempalace-memory": {
            config: {
              autoExtract: {
                cooldownTurns: 99,
                minConfidence: 150,
                kgWriteMinConfidence: 10,
              },
            },
          },
        },
      },
    } as never);

    expect(resolved.cooldownTurns).toBe(20);
    expect(resolved.minConfidence).toBe(100);
    expect(resolved.kgWriteMinConfidence).toBe(50);
  });

  it("enables allowKgWrite only when explicitly set to true", () => {
    const off = resolveMempalaceAutoExtractConfig({} as never);
    const on = resolveMempalaceAutoExtractConfig({
      plugins: {
        entries: {
          "mempalace-memory": { config: { autoExtract: { allowKgWrite: true } } },
        },
      },
    } as never);

    expect(off.allowKgWrite).toBe(false);
    expect(on.allowKgWrite).toBe(true);
  });

  it("reads explicit userIdentity from config", () => {
    const resolved = resolveMempalaceAutoExtractConfig({
      plugins: {
        entries: {
          "mempalace-memory": { config: { autoExtract: { userIdentity: "Alice" } } },
        },
      },
    } as never);
    expect(resolved.userIdentity).toBe("Alice");
  });

  it("defaults userIdentity to 'User' when missing or blank", () => {
    expect(resolveMempalaceAutoExtractConfig({} as never).userIdentity).toBe("User");
    const blank = resolveMempalaceAutoExtractConfig({
      plugins: {
        entries: { "mempalace-memory": { config: { autoExtract: { userIdentity: "   " } } } },
      },
    } as never);
    expect(blank.userIdentity).toBe("User");
  });

  it("treats mode=off as disabled and clamps numeric values", () => {
    const resolved = resolveMempalaceAutoExtractConfig({
      plugins: {
        entries: {
          "mempalace-memory": {
            config: {
              autoExtract: {
                mode: "off",
                maxWritesPerTurn: 99,
                maxSourceChars: 20,
                maxCandidateChars: 10_000,
                dedupeSimilarity: 2,
              },
            },
          },
        },
      },
    } as never);

    expect(resolved.enabled).toBe(false);
    expect(resolved.maxWritesPerTurn).toBe(5);
    expect(resolved.maxSourceChars).toBe(200);
    expect(resolved.maxCandidateChars).toBe(2000);
    expect(resolved.dedupeSimilarity).toBe(0.999);
  });
});
