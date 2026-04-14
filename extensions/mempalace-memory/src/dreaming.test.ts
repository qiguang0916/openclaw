import { describe, expect, it } from "vitest";
import { resolveMempalaceDreamingConfig } from "./dreaming-config.js";
import { dreamingTesting as __testing } from "./dreaming-helpers.js";

describe("resolveMempalaceDreamingConfig", () => {
  it("uses sane defaults", () => {
    expect(resolveMempalaceDreamingConfig({})).toEqual({
      enabled: true,
      cron: "0 3 * * *",
      timezone: undefined,
      lookbackDays: 7,
      limit: 6,
      kgThemes: 3,
    });
  });

  it("reads explicit plugin config values", () => {
    expect(
      resolveMempalaceDreamingConfig({
        plugins: {
          entries: {
            "mempalace-memory": {
              config: {
                dreaming: {
                  enabled: false,
                  cron: "15 4 * * *",
                  timezone: "America/Los_Angeles",
                  lookbackDays: 3,
                  limit: 4,
                  kgThemes: 2,
                },
              },
            },
          },
        },
      }),
    ).toEqual({
      enabled: false,
      cron: "15 4 * * *",
      timezone: "America/Los_Angeles",
      lookbackDays: 3,
      limit: 4,
      kgThemes: 2,
    });
  });
});

describe("collectRecentRecallSignals", () => {
  it("aggregates recent recall events by query and keeps the top path", () => {
    const nowMs = Date.parse("2026-04-11T12:00:00.000Z");
    const signals = __testing.collectRecentRecallSignals({
      nowMs,
      lookbackDays: 7,
      limit: 3,
      events: [
        {
          type: "memory.recall.recorded",
          timestamp: "2026-04-11T11:00:00.000Z",
          query: "Jarvis preferences",
          resultCount: 1,
          results: [{ path: "mempalace/private/kg/v1/a", startLine: 1, endLine: 2, score: 0.9 }],
        },
        {
          type: "memory.recall.recorded",
          timestamp: "2026-04-10T11:00:00.000Z",
          query: "Jarvis preferences",
          resultCount: 1,
          results: [{ path: "mempalace/private/kg/v1/b", startLine: 1, endLine: 2, score: 0.8 }],
        },
        {
          type: "memory.recall.recorded",
          timestamp: "2026-04-09T11:00:00.000Z",
          query: "OpenClaw roadmap",
          resultCount: 1,
          results: [
            { path: "mempalace/private/drawer/v1/c", startLine: 1, endLine: 4, score: 0.7 },
          ],
        },
      ],
    });

    expect(signals).toEqual([
      {
        query: "Jarvis preferences",
        hits: 2,
        topPath: "mempalace/private/kg/v1/a",
      },
      {
        query: "OpenClaw roadmap",
        hits: 1,
        topPath: "mempalace/private/drawer/v1/c",
      },
    ]);
  });
});

describe("managed dreaming cron helpers", () => {
  it("builds the expected managed dreaming cron payload", () => {
    const job = __testing.buildManagedDreamingCronJob({
      enabled: true,
      cron: "0 3 * * *",
      timezone: "UTC",
      lookbackDays: 7,
      limit: 6,
      kgThemes: 3,
    });

    expect(job).toEqual({
      name: "MemPalace Dreaming",
      description: expect.stringContaining("[managed-by=mempalace-memory.dreaming]"),
      enabled: true,
      schedule: {
        kind: "cron",
        expr: "0 3 * * *",
        tz: "UTC",
      },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: {
        kind: "systemEvent",
        text: "__openclaw_mempalace_dreaming__",
      },
    });
  });
});

describe("resolveDreamingRunTarget", () => {
  it("resolves the current session agent and workspace when mempalace-memory is active", () => {
    const target = __testing.resolveDreamingRunTarget({
      cfg: {
        plugins: {
          slots: {
            memory: "mempalace-memory",
          },
          entries: {
            "mempalace-memory": {
              enabled: true,
            },
          },
        },
        agents: {
          defaults: {
            workspace: "/tmp/default-workspace",
          },
          list: [
            {
              id: "openclaw-optimizer",
              workspace: "/tmp/openclaw-optimizer-workspace",
              default: true,
            },
          ],
        },
      },
      sessionKey: "agent:openclaw-optimizer:test",
    });

    expect(target).toEqual({
      ok: true,
      agentId: "openclaw-optimizer",
      workspaceDir: "/tmp/openclaw-optimizer-workspace",
    });
  });

  it("returns unavailable when mempalace-memory is not the active slot", () => {
    const target = __testing.resolveDreamingRunTarget({
      cfg: {
        plugins: {
          slots: {
            memory: "memory-core",
          },
        },
      },
      sessionKey: "agent:main:test",
    });

    expect(target).toEqual({
      ok: false,
      reason: "Dreaming run unavailable because mempalace-memory is not the active memory slot.",
    });
  });
});

describe("phase-specific dreaming artifacts", () => {
  const aggregates = [
    { query: "Jarvis preferences", hits: 3, topPath: "mempalace/private/kg/v1/a" },
    { query: "OpenClaw roadmap", hits: 2, topPath: "mempalace/private/drawer/v1/b" },
  ];
  const snippets = [
    "Jarvis -> prefers -> low-token recall",
    "OpenClaw roadmap shifted toward MemPalace unification",
  ];

  it("builds a light dreaming diary entry focused on recall patterns", () => {
    const entry = __testing.buildLightDreamingDiaryEntry({
      agentId: "openclaw-optimizer",
      nowMs: Date.parse("2026-04-11T12:00:00.000Z"),
      aggregates,
      snippets,
    });

    expect(entry).toContain("SESSION:2026-04-11");
    expect(entry).toContain("light.focus:");
    expect(entry).toContain("Jarvis preferences(3x)");
    expect(entry).toContain("agent:openclaw-optimizer");
  });

  it("builds a rem dreaming drawer content focused on associations and motifs", () => {
    const content = __testing.buildRemDreamingDrawerContent({
      agentId: "openclaw-optimizer",
      nowMs: Date.parse("2026-04-11T12:00:00.000Z"),
      aggregates,
      snippets,
    });

    expect(content).toContain("# MemPalace Dreaming REM");
    expect(content).toContain("Recurring associations:");
    expect(content).toContain("- Jarvis preferences (3x)");
    expect(content).toContain("Representative recalled memories:");
  });

  it("builds deep dreaming KG facts from the strongest themes", () => {
    const facts = __testing.buildDeepDreamingKgFacts({
      agentId: "openclaw-optimizer",
      nowMs: Date.parse("2026-04-11T12:00:00.000Z"),
      aggregates,
      kgThemes: 1,
    });

    expect(facts).toEqual([
      {
        subject: "openclaw-optimizer",
        predicate: "dreaming focus",
        object: "Jarvis preferences",
        validFrom: "2026-04-11",
      },
    ]);
  });
});

describe("dream completion events", () => {
  it("builds light/rem/deep completion events for MemPalace outputs", () => {
    const events = __testing.buildDreamCompletionEvents({
      agentId: "openclaw-optimizer",
      timestamp: "2026-04-12T01:23:45.000Z",
      diaryTopic: "dreaming-light",
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
          validFrom: "2026-04-12",
        },
      ],
      aggregateCount: 2,
    });

    expect(events).toEqual([
      {
        type: "memory.dream.completed",
        timestamp: "2026-04-12T01:23:45.000Z",
        phase: "light",
        reportPath: "mempalace://diary/openclaw-optimizer/dreaming-light",
        lineCount: 2,
        storageMode: "both",
      },
      {
        type: "memory.dream.completed",
        timestamp: "2026-04-12T01:23:45.000Z",
        phase: "rem",
        reportPath: "mempalace://drawer/drawer_123",
        lineCount: 2,
        storageMode: "both",
      },
      {
        type: "memory.dream.completed",
        timestamp: "2026-04-12T01:23:45.000Z",
        phase: "deep",
        reportPath: "mempalace://kg/openclaw-optimizer/1",
        lineCount: 1,
        storageMode: "both",
      },
    ]);
  });
});
