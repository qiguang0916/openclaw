import { describe, expect, it, vi } from "vitest";
import {
  loadDreamDiary,
  loadDreamingStatus,
  updateDreamingEnabled,
  type DreamingState,
} from "./dreaming.ts";

function createState(): { state: DreamingState; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn();
  const state: DreamingState = {
    client: {
      request,
    } as unknown as DreamingState["client"],
    connected: true,
    configSnapshot: { hash: "hash-1" },
    applySessionKey: "main",
    dreamingStatusLoading: false,
    dreamingStatusError: null,
    dreamingStatus: null,
    dreamingModeSaving: false,
    dreamDiaryLoading: false,
    dreamDiaryError: null,
    dreamDiaryPath: null,
    dreamDiaryContent: null,
    dreamDiarySource: null,
    lastError: null,
  };
  return { state, request };
}

describe("dreaming controller", () => {
  it("loads and normalizes dreaming status from doctor.memory.status", async () => {
    const { state, request } = createState();
    request.mockResolvedValue({
      dreaming: {
        enabled: true,
        timezone: "America/Los_Angeles",
        verboseLogging: false,
        storageMode: "inline",
        separateReports: false,
        shortTermCount: 8,
        recallSignalCount: 14,
        dailySignalCount: 6,
        totalSignalCount: 20,
        phaseSignalCount: 11,
        lightPhaseHitCount: 7,
        remPhaseHitCount: 4,
        promotedTotal: 21,
        promotedToday: 2,
        phases: {
          light: {
            enabled: true,
            cron: "0 */6 * * *",
            lookbackDays: 2,
            limit: 100,
            managedCronPresent: true,
            nextRunAtMs: 12345,
          },
          deep: {
            enabled: true,
            cron: "0 3 * * *",
            limit: 10,
            minScore: 0.8,
            minRecallCount: 3,
            minUniqueQueries: 3,
            recencyHalfLifeDays: 14,
            maxAgeDays: 30,
            managedCronPresent: true,
            nextRunAtMs: 23456,
          },
          rem: {
            enabled: true,
            cron: "0 5 * * 0",
            lookbackDays: 7,
            limit: 10,
            minPatternStrength: 0.75,
            managedCronPresent: true,
            nextRunAtMs: 34567,
          },
        },
      },
    });

    await loadDreamingStatus(state);

    expect(request).toHaveBeenCalledWith("doctor.memory.status", {});
    expect(state.dreamingStatus).toEqual(
      expect.objectContaining({
        enabled: true,
        shortTermCount: 8,
        totalSignalCount: 20,
        phaseSignalCount: 11,
        promotedToday: 2,
        phases: expect.objectContaining({
          deep: expect.objectContaining({
            minScore: 0.8,
            nextRunAtMs: 23456,
          }),
        }),
      }),
    );
    expect(state.dreamingStatusLoading).toBe(false);
    expect(state.dreamingStatusError).toBeNull();
  });

  it("patches config to update global dreaming enablement", async () => {
    const { state, request } = createState();
    request.mockResolvedValue({ ok: true });

    const ok = await updateDreamingEnabled(state, false);

    expect(ok).toBe(true);
    expect(request).toHaveBeenCalledWith(
      "config.patch",
      expect.objectContaining({
        baseHash: "hash-1",
        sessionKey: "main",
      }),
    );
    expect(state.dreamingModeSaving).toBe(false);
    expect(state.dreamingStatusError).toBeNull();
  });

  it("patches MemPalace dreaming enablement when MemPalace owns the active slot", async () => {
    const { state, request } = createState();
    request.mockResolvedValue({ ok: true });
    state.dreamingStatus = {
      backend: "mempalace-memory",
      enabled: true,
      verboseLogging: false,
      storageMode: "inline",
      separateReports: false,
      shortTermCount: 0,
      recallSignalCount: 0,
      dailySignalCount: 0,
      totalSignalCount: 0,
      phaseSignalCount: 0,
      lightPhaseHitCount: 0,
      remPhaseHitCount: 0,
      promotedTotal: 0,
      promotedToday: 0,
      phases: {
        light: {
          enabled: true,
          cron: "0 */6 * * *",
          lookbackDays: 7,
          limit: 5,
          managedCronPresent: false,
        },
        deep: {
          enabled: true,
          cron: "0 */6 * * *",
          limit: 3,
          minScore: 0,
          minRecallCount: 0,
          minUniqueQueries: 0,
          recencyHalfLifeDays: 7,
          managedCronPresent: false,
        },
        rem: {
          enabled: true,
          cron: "0 */6 * * *",
          lookbackDays: 7,
          limit: 5,
          minPatternStrength: 0,
          managedCronPresent: false,
        },
      },
    };

    const ok = await updateDreamingEnabled(state, false);

    expect(ok).toBe(true);
    expect(request).toHaveBeenCalledWith(
      "config.patch",
      expect.objectContaining({
        raw: JSON.stringify({
          plugins: {
            entries: {
              "mempalace-memory": {
                config: {
                  dreaming: {
                    enabled: false,
                  },
                },
              },
            },
          },
        }),
      }),
    );
  });

  it("fails gracefully when config hash is missing", async () => {
    const { state, request } = createState();
    state.configSnapshot = {};

    const ok = await updateDreamingEnabled(state, true);

    expect(ok).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(state.dreamingStatusError).toContain("Config hash missing");
  });

  it("loads dream diary content", async () => {
    const { state, request } = createState();
    request.mockResolvedValue({
      found: true,
      path: "DREAMS.md",
      content: "## Dream Diary\n- recurring glacier thoughts",
    });

    await loadDreamDiary(state);

    expect(request).toHaveBeenCalledWith("doctor.memory.dreamDiary", {});
    expect(state.dreamDiaryPath).toBe("DREAMS.md");
    expect(state.dreamDiaryContent).toContain("glacier");
    expect(state.dreamDiarySource).toBeNull();
    expect(state.dreamDiaryError).toBeNull();
  });

  it("normalizes MemPalace dreaming payload into the current state model", async () => {
    const { state, request } = createState();
    request.mockResolvedValue({
      dreaming: {
        backend: "mempalace-memory",
        enabled: true,
        timezone: "America/Los_Angeles",
        cron: "0 */6 * * *",
        lookbackDays: 7,
        limit: 5,
        kgThemes: 3,
        recentRecallQueryCount: 4,
        lastRunAt: "2026-04-11T02:00:00.000Z",
        lastRunPhases: ["light", "rem", "deep"],
        lastRunLineCount: 6,
        lastKgFactCount: 2,
        lastVerifiedKgFacts: 2,
        lastKgFacts: [
          {
            subject: "openclaw-optimizer",
            predicate: "dreaming_focus",
            object: "FINAL-USER-VERIFY-20260411",
            validFrom: "2026-04-12",
            sourceFile: "dreaming-deep://2026-04-12",
          },
        ],
        lastDrawer: {
          wing: "OpenClaw Dreaming",
          room: "Main",
          text: "Recurring associations: FINAL-USER-VERIFY-20260411 (2x)",
          sourceFile: "dreaming-rem://2026-04-12",
          verified: true,
        },
        phases: {
          light: {
            enabled: true,
            cron: "0 */6 * * *",
            lookbackDays: 7,
            limit: 5,
            managedCronPresent: false,
          },
          deep: {
            enabled: true,
            cron: "0 */6 * * *",
            limit: 3,
            minScore: 0,
            minRecallCount: 0,
            minUniqueQueries: 0,
            recencyHalfLifeDays: 7,
            managedCronPresent: false,
          },
          rem: {
            enabled: true,
            cron: "0 */6 * * *",
            lookbackDays: 7,
            limit: 5,
            minPatternStrength: 0,
            managedCronPresent: false,
          },
        },
      },
    });

    await loadDreamingStatus(state);

    expect(state.dreamingStatus).toEqual(
      expect.objectContaining({
        backend: "mempalace-memory",
        shortTermCount: 4,
        totalSignalCount: 6,
        phaseSignalCount: 2,
        promotedToday: 2,
        lastRunAt: "2026-04-11T02:00:00.000Z",
        lastVerifiedKgFacts: 2,
        lastKgFacts: [
          expect.objectContaining({
            object: "FINAL-USER-VERIFY-20260411",
            sourceFile: "dreaming-deep://2026-04-12",
          }),
        ],
        lastDrawer: expect.objectContaining({
          wing: "OpenClaw Dreaming",
          text: "Recurring associations: FINAL-USER-VERIFY-20260411 (2x)",
          sourceFile: "dreaming-rem://2026-04-12",
          verified: true,
        }),
      }),
    );
  });

  it("handles missing dream diary without error", async () => {
    const { state, request } = createState();
    request.mockResolvedValue({
      found: false,
      path: "DREAMS.md",
    });

    await loadDreamDiary(state);

    expect(state.dreamDiaryPath).toBe("DREAMS.md");
    expect(state.dreamDiaryContent).toBeNull();
    expect(state.dreamDiarySource).toBeNull();
    expect(state.dreamDiaryError).toBeNull();
  });

  it("records the MemPalace diary source when provided", async () => {
    const { state, request } = createState();
    request.mockResolvedValue({
      found: true,
      path: "mempalace://diary/main/dreaming-light",
      content: "MemPalace dreaming ran for Main.",
      source: "mempalace-events",
    });

    await loadDreamDiary(state);

    expect(state.dreamDiaryPath).toBe("mempalace://diary/main/dreaming-light");
    expect(state.dreamDiarySource).toBe("mempalace-events");
  });

  it("records dream diary request errors", async () => {
    const { state, request } = createState();
    request.mockRejectedValue(new Error("dream diary read failed"));

    await loadDreamDiary(state);

    expect(state.dreamDiaryError).toContain("dream diary read failed");
    expect(state.dreamDiaryLoading).toBe(false);
  });
});
