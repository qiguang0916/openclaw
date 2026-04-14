import { describe, expect, it } from "vitest";
import {
  buildMempalaceMemoryFlushPlan,
  DEFAULT_MEMPALACE_MEMORY_FLUSH_PROMPT,
} from "./flush-plan.js";

describe("buildMempalaceMemoryFlushPlan", () => {
  it("builds a MemPalace tool-driven flush plan by default", () => {
    const plan = buildMempalaceMemoryFlushPlan({
      nowMs: Date.UTC(2026, 3, 11, 16, 0, 0),
    });

    expect(plan).not.toBeNull();
    expect(plan?.prompt).toContain("Pre-compaction memory flush.");
    expect(plan?.prompt).toContain("MemPalace tools only");
    expect(plan?.prompt).toContain("Current time:");
    expect(plan?.systemPrompt).toContain("MemPalace");
    expect(plan?.allowedToolNames).toEqual(
      expect.arrayContaining([
        "read",
        "memory_search",
        "memory_get",
        "mempalace_add_drawer",
        "mempalace_kg_add",
        "mempalace_diary_write",
      ]),
    );
    expect(plan?.relativePath).toBeUndefined();
  });

  it("preserves user overrides while re-appending required MemPalace safety hints", () => {
    const plan = buildMempalaceMemoryFlushPlan({
      cfg: {
        agents: {
          defaults: {
            compaction: {
              memoryFlush: {
                prompt: "Keep only durable facts.",
              },
            },
          },
        },
      },
    });

    expect(plan?.prompt).toContain("Keep only durable facts.");
    expect(plan?.prompt).toContain("MemPalace tools only");
    expect(plan?.prompt).toContain("memory markdown files");
    expect(plan?.prompt).toContain("NO_REPLY");
    expect(DEFAULT_MEMPALACE_MEMORY_FLUSH_PROMPT).toContain("NO_REPLY");
  });
});
