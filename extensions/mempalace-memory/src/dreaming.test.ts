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
      autoExtractPromotion: { enabled: true, minHits: 2 },
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
      autoExtractPromotion: { enabled: true, minHits: 2 },
    });
  });

  it("reads explicit autoExtractPromotion config", () => {
    expect(
      resolveMempalaceDreamingConfig({
        plugins: {
          entries: {
            "mempalace-memory": {
              config: {
                dreaming: {
                  autoExtractPromotion: { enabled: false, minHits: 5 },
                },
              },
            },
          },
        },
      }),
    ).toMatchObject({
      autoExtractPromotion: { enabled: false, minHits: 5 },
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
      autoExtractPromotion: { enabled: true, minHits: 2 },
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

describe("collectAutoExtractPromotionCandidates", () => {
  const NOW = Date.parse("2026-04-15T12:00:00.000Z");

  function makeExtractEvent(
    timestamp: string,
    entries: Array<{
      category: string;
      scope: "shared" | "private";
      summary: string;
      storage: "drawer" | "diary" | "kg";
    }>,
  ) {
    return {
      type: "memory.auto_extract.written" as const,
      timestamp,
      agentId: "jarvis",
      written: entries.length,
      duplicates: 0,
      skipped: 0,
      entries,
    };
  }

  it("returns empty when there are no auto_extract events", () => {
    expect(
      __testing.collectAutoExtractPromotionCandidates({
        events: [],
        nowMs: NOW,
        lookbackDays: 7,
        minHits: 2,
      }),
    ).toEqual([]);
  });

  it("returns empty when hits are below minHits threshold", () => {
    expect(
      __testing.collectAutoExtractPromotionCandidates({
        events: [
          makeExtractEvent("2026-04-14T10:00:00.000Z", [
            {
              category: "standing_preference",
              scope: "shared",
              summary: "prefer concise replies",
              storage: "drawer",
            },
          ]),
        ],
        nowMs: NOW,
        lookbackDays: 7,
        minHits: 2,
      }),
    ).toEqual([]);
  });

  it("returns candidates when hits meet the threshold", () => {
    expect(
      __testing.collectAutoExtractPromotionCandidates({
        events: [
          makeExtractEvent("2026-04-14T10:00:00.000Z", [
            {
              category: "standing_preference",
              scope: "shared",
              summary: "prefer concise replies",
              storage: "drawer",
            },
          ]),
          makeExtractEvent("2026-04-13T10:00:00.000Z", [
            {
              category: "standing_preference",
              scope: "shared",
              summary: "prefer concise replies",
              storage: "drawer",
            },
          ]),
        ],
        nowMs: NOW,
        lookbackDays: 7,
        minHits: 2,
      }),
    ).toEqual([
      {
        category: "standing_preference",
        summary: "prefer concise replies",
        hits: 2,
        agentCount: 1,
      },
    ]);
  });

  it("excludes private-scope entries", () => {
    expect(
      __testing.collectAutoExtractPromotionCandidates({
        events: [
          makeExtractEvent("2026-04-14T10:00:00.000Z", [
            {
              category: "standing_preference",
              scope: "private",
              summary: "private note",
              storage: "drawer",
            },
          ]),
          makeExtractEvent("2026-04-13T10:00:00.000Z", [
            {
              category: "standing_preference",
              scope: "private",
              summary: "private note",
              storage: "drawer",
            },
          ]),
        ],
        nowMs: NOW,
        lookbackDays: 7,
        minHits: 2,
      }),
    ).toEqual([]);
  });

  it("excludes entries already stored in KG", () => {
    expect(
      __testing.collectAutoExtractPromotionCandidates({
        events: [
          makeExtractEvent("2026-04-14T10:00:00.000Z", [
            {
              category: "standing_preference",
              scope: "shared",
              summary: "prefers dark mode",
              storage: "kg",
            },
          ]),
          makeExtractEvent("2026-04-13T10:00:00.000Z", [
            {
              category: "standing_preference",
              scope: "shared",
              summary: "prefers dark mode",
              storage: "kg",
            },
          ]),
        ],
        nowMs: NOW,
        lookbackDays: 7,
        minHits: 2,
      }),
    ).toEqual([]);
  });

  it("excludes events outside the lookback window", () => {
    expect(
      __testing.collectAutoExtractPromotionCandidates({
        events: [
          makeExtractEvent("2026-04-07T10:00:00.000Z", [
            {
              category: "standing_preference",
              scope: "shared",
              summary: "prefer concise replies",
              storage: "drawer",
            },
          ]),
          makeExtractEvent("2026-04-06T10:00:00.000Z", [
            {
              category: "standing_preference",
              scope: "shared",
              summary: "prefer concise replies",
              storage: "drawer",
            },
          ]),
        ],
        nowMs: NOW,
        lookbackDays: 7,
        minHits: 2,
      }),
    ).toEqual([]);
  });

  it("excludes non-promotable category project_continuity", () => {
    expect(
      __testing.collectAutoExtractPromotionCandidates({
        events: [
          makeExtractEvent("2026-04-14T10:00:00.000Z", [
            {
              category: "project_continuity",
              scope: "shared",
              summary: "continue refactor later",
              storage: "diary",
            },
          ]),
          makeExtractEvent("2026-04-13T10:00:00.000Z", [
            {
              category: "project_continuity",
              scope: "shared",
              summary: "continue refactor later",
              storage: "diary",
            },
          ]),
        ],
        nowMs: NOW,
        lookbackDays: 7,
        minHits: 2,
      }),
    ).toEqual([]);
  });

  it("sorts results by hit count descending", () => {
    const result = __testing.collectAutoExtractPromotionCandidates({
      events: [
        makeExtractEvent("2026-04-14T10:00:00.000Z", [
          {
            category: "standing_constraint",
            scope: "shared",
            summary: "no emojis",
            storage: "drawer",
          },
          {
            category: "standing_preference",
            scope: "shared",
            summary: "prefer concise replies",
            storage: "drawer",
          },
        ]),
        makeExtractEvent("2026-04-13T10:00:00.000Z", [
          {
            category: "standing_constraint",
            scope: "shared",
            summary: "no emojis",
            storage: "drawer",
          },
          {
            category: "standing_preference",
            scope: "shared",
            summary: "prefer concise replies",
            storage: "drawer",
          },
        ]),
        makeExtractEvent("2026-04-12T10:00:00.000Z", [
          {
            category: "standing_constraint",
            scope: "shared",
            summary: "no emojis",
            storage: "drawer",
          },
        ]),
      ],
      nowMs: NOW,
      lookbackDays: 7,
      minHits: 2,
    });
    expect(result[0]).toMatchObject({ summary: "no emojis", hits: 3 });
    expect(result[1]).toMatchObject({ summary: "prefer concise replies", hits: 2 });
  });
});

describe("buildAutoExtractPromotionKgFacts", () => {
  const NOW = Date.parse("2026-04-15T12:00:00.000Z");

  it("maps standing_preference to predicate 'prefers'", () => {
    expect(
      __testing.buildAutoExtractPromotionKgFacts({
        nowMs: NOW,
        candidates: [
          {
            category: "standing_preference",
            summary: "prefer concise replies",
            hits: 3,
            agentCount: 1,
          },
        ],
      }),
    ).toEqual([
      {
        subject: "User",
        predicate: "prefers",
        object: "prefer concise replies",
        validFrom: "2026-04-15",
      },
    ]);
  });

  it("maps standing_constraint to predicate 'avoids'", () => {
    expect(
      __testing.buildAutoExtractPromotionKgFacts({
        nowMs: NOW,
        candidates: [
          { category: "standing_constraint", summary: "no emojis", hits: 2, agentCount: 1 },
        ],
      })[0].predicate,
    ).toBe("avoids");
  });

  it("maps long_term_goal to predicate 'has goal'", () => {
    expect(
      __testing.buildAutoExtractPromotionKgFacts({
        nowMs: NOW,
        candidates: [
          { category: "long_term_goal", summary: "launch in 2026", hits: 2, agentCount: 1 },
        ],
      })[0].predicate,
    ).toBe("has goal");
  });

  it("maps explicit_remember to predicate 'remembers'", () => {
    expect(
      __testing.buildAutoExtractPromotionKgFacts({
        nowMs: NOW,
        candidates: [
          { category: "explicit_remember", summary: "birthday April 15", hits: 2, agentCount: 1 },
        ],
      })[0].predicate,
    ).toBe("remembers");
  });

  it("excludes unknown categories", () => {
    expect(
      __testing.buildAutoExtractPromotionKgFacts({
        nowMs: NOW,
        candidates: [
          { category: "unknown_category", summary: "something", hits: 3, agentCount: 1 },
        ],
      }),
    ).toEqual([]);
  });

  it("truncates summary to 200 chars", () => {
    const facts = __testing.buildAutoExtractPromotionKgFacts({
      nowMs: NOW,
      candidates: [
        { category: "standing_preference", summary: "a".repeat(250), hits: 2, agentCount: 1 },
      ],
    });
    expect(facts[0].object.length).toBe(200);
  });

  it("uses 'User' as subject by default", () => {
    const facts = __testing.buildAutoExtractPromotionKgFacts({
      nowMs: NOW,
      candidates: [
        { category: "standing_preference", summary: "pref A", hits: 2, agentCount: 1 },
        { category: "long_term_goal", summary: "goal B", hits: 3, agentCount: 1 },
      ],
    });
    expect(facts.every((f) => f.subject === "User")).toBe(true);
  });

  it("uses explicit userIdentity as subject when provided", () => {
    const facts = __testing.buildAutoExtractPromotionKgFacts({
      nowMs: NOW,
      userIdentity: "Alice",
      candidates: [{ category: "standing_preference", summary: "pref A", hits: 2, agentCount: 1 }],
    });
    expect(facts[0].subject).toBe("Alice");
  });
});
