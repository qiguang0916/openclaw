import { createHash } from "node:crypto";
import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk/memory-core";
import { resolveAgentWorkspaceDir } from "openclaw/plugin-sdk/memory-core";
import {
  appendMemoryHostEvent,
  type MemoryHostEvent,
  readMemoryHostEvents,
} from "openclaw/plugin-sdk/memory-host-events";
import {
  humanizeAgentId,
  normalizeMempalaceSafeName,
  saveDreamingDiaryToMempalace,
  saveDreamingDrawerToMempalace,
  shouldUseMempalaceSessionMemory,
  ensureKgFactInMempalace,
} from "../api.js";
import { readDrawerById, readKnowledgeGraphFact } from "./bridge.js";
import { resolveMempalacePluginConfig } from "./config.js";
import {
  MEMPALACE_DREAMING_DEFAULTS,
  resolveMempalaceDreamingConfig,
  type MempalaceDreamingConfig,
} from "./dreaming-config.js";
import {
  dreamingTesting,
  collectAutoExtractPromotionCandidates,
  buildAutoExtractPromotionKgFacts,
  type AutoExtractPromotionCandidate,
} from "./dreaming-helpers.js";
import { getMempalaceMemorySearchManager } from "./manager.js";
export { resolveMempalaceDreamingConfig } from "./dreaming-config.js";

const MANAGED_DREAMING_CRON_NAME = "MemPalace Dreaming";
const MANAGED_DREAMING_CRON_TAG = "[managed-by=mempalace-memory.dreaming]";
const DREAMING_SYSTEM_EVENT_TEXT = "__openclaw_mempalace_dreaming__";
const {
  DEFAULT_DREAMING_CRON: _DEFAULT_DREAMING_CRON,
  DEFAULT_DREAMING_LOOKBACK_DAYS: _DEFAULT_DREAMING_LOOKBACK_DAYS,
  DEFAULT_DREAMING_LIMIT: _DEFAULT_DREAMING_LIMIT,
  DEFAULT_DREAMING_KG_THEMES: _DEFAULT_DREAMING_KG_THEMES,
} = MEMPALACE_DREAMING_DEFAULTS;

type Logger = Pick<OpenClawPluginApi["logger"], "info" | "warn" | "error">;

type CronSchedule = { kind: "cron"; expr: string; tz?: string };
type CronPayload = { kind: "systemEvent"; text: string };
type ManagedCronJobCreate = {
  name: string;
  description: string;
  enabled: boolean;
  schedule: CronSchedule;
  sessionTarget: "main";
  wakeMode: "next-heartbeat";
  payload: CronPayload;
};

type ManagedCronJobPatch = {
  name?: string;
  description?: string;
  enabled?: boolean;
  schedule?: CronSchedule;
  sessionTarget?: "main";
  wakeMode?: "next-heartbeat";
  payload?: CronPayload;
};

type ManagedCronJobLike = {
  id: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  schedule?: { kind?: string; expr?: string; tz?: string };
  sessionTarget?: string;
  wakeMode?: string;
  payload?: { kind?: string; text?: string };
  createdAtMs?: number;
};

type CronServiceLike = {
  list: (opts?: { includeDisabled?: boolean }) => Promise<ManagedCronJobLike[]>;
  add: (input: ManagedCronJobCreate) => Promise<unknown>;
  update: (id: string, patch: ManagedCronJobPatch) => Promise<unknown>;
  remove: (id: string) => Promise<{ removed?: boolean }>;
};

type DreamingRecallAggregate = {
  query: string;
  hits: number;
  topPath?: string;
};

export type MempalaceDreamingRunDetails = {
  agentId: string;
  workspaceDir: string;
  aggregateCount: number;
  diary: {
    topic: string;
  };
  drawer: {
    wing: string;
    room: string;
    drawerId?: string;
  };
  kgFacts: Array<{
    subject: string;
    predicate: string;
    object: string;
    validFrom: string;
  }>;
  verified: {
    drawer: boolean;
    kgFacts: number;
  };
  autoExtractPromotions: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function resolveManagedDreamingDescription(config: MempalaceDreamingConfig): string {
  return `${MANAGED_DREAMING_CRON_TAG} Run MemPalace-native dreaming (cron=${config.cron}, lookbackDays=${config.lookbackDays}, limit=${config.limit}, kgThemes=${config.kgThemes}).`;
}

function buildManagedDreamingCronJob(config: MempalaceDreamingConfig): ManagedCronJobCreate {
  return {
    name: MANAGED_DREAMING_CRON_NAME,
    description: resolveManagedDreamingDescription(config),
    enabled: true,
    schedule: {
      kind: "cron",
      expr: config.cron,
      ...(config.timezone ? { tz: config.timezone } : {}),
    },
    sessionTarget: "main",
    wakeMode: "next-heartbeat",
    payload: {
      kind: "systemEvent",
      text: DREAMING_SYSTEM_EVENT_TEXT,
    },
  };
}

function isManagedDreamingJob(job: ManagedCronJobLike): boolean {
  const description = normalizeTrimmedString(job.description);
  if (description?.includes(MANAGED_DREAMING_CRON_TAG)) {
    return true;
  }
  return (
    normalizeTrimmedString(job.name) === MANAGED_DREAMING_CRON_NAME &&
    normalizeTrimmedString(job.payload?.text) === DREAMING_SYSTEM_EVENT_TEXT
  );
}

function buildManagedDreamingPatch(
  job: ManagedCronJobLike,
  desired: ManagedCronJobCreate,
): ManagedCronJobPatch | null {
  const patch: ManagedCronJobPatch = {};
  if (normalizeTrimmedString(job.name) !== desired.name) {
    patch.name = desired.name;
  }
  if (normalizeTrimmedString(job.description) !== desired.description) {
    patch.description = desired.description;
  }
  if (job.enabled !== true) {
    patch.enabled = true;
  }
  const scheduleKind = normalizeTrimmedString(job.schedule?.kind)?.toLowerCase();
  const scheduleExpr = normalizeTrimmedString(job.schedule?.expr);
  const scheduleTz = normalizeTrimmedString(job.schedule?.tz);
  if (
    scheduleKind !== "cron" ||
    scheduleExpr !== desired.schedule.expr ||
    scheduleTz !== desired.schedule.tz
  ) {
    patch.schedule = desired.schedule;
  }
  if (normalizeTrimmedString(job.sessionTarget)?.toLowerCase() !== "main") {
    patch.sessionTarget = "main";
  }
  if (normalizeTrimmedString(job.wakeMode)?.toLowerCase() !== "next-heartbeat") {
    patch.wakeMode = "next-heartbeat";
  }
  const payloadKind = normalizeTrimmedString(job.payload?.kind)?.toLowerCase();
  const payloadText = normalizeTrimmedString(job.payload?.text);
  if (payloadKind !== "systemevent" || payloadText !== desired.payload.text) {
    patch.payload = desired.payload;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function sortManagedJobs(managed: ManagedCronJobLike[]): ManagedCronJobLike[] {
  return managed.toSorted((a, b) => {
    const aCreated =
      typeof a.createdAtMs === "number" && Number.isFinite(a.createdAtMs)
        ? a.createdAtMs
        : Number.MAX_SAFE_INTEGER;
    const bCreated =
      typeof b.createdAtMs === "number" && Number.isFinite(b.createdAtMs)
        ? b.createdAtMs
        : Number.MAX_SAFE_INTEGER;
    if (aCreated !== bCreated) {
      return aCreated - bCreated;
    }
    return a.id.localeCompare(b.id);
  });
}

function resolveCronServiceFromStartupEvent(event: unknown): CronServiceLike | null {
  const payload = asRecord(event);
  if (!payload || payload.type !== "gateway" || payload.action !== "startup") {
    return null;
  }
  const context = asRecord(payload.context);
  const deps = asRecord(context?.deps);
  const cronCandidate = context?.cron ?? deps?.cron;
  if (!cronCandidate || typeof cronCandidate !== "object") {
    return null;
  }
  const cron = cronCandidate as Partial<CronServiceLike>;
  if (
    typeof cron.list !== "function" ||
    typeof cron.add !== "function" ||
    typeof cron.update !== "function" ||
    typeof cron.remove !== "function"
  ) {
    return null;
  }
  return cron as CronServiceLike;
}

async function reconcileDreamingCronJob(params: {
  cron: CronServiceLike | null;
  config: MempalaceDreamingConfig;
  logger: Logger;
}): Promise<void> {
  const cron = params.cron;
  if (!cron) {
    return;
  }
  const jobs = await cron.list({ includeDisabled: true });
  const managed = sortManagedJobs(jobs.filter((job) => isManagedDreamingJob(job)));
  if (!params.config.enabled) {
    for (const job of managed) {
      await cron.remove(job.id).catch((err) => {
        params.logger.warn(
          `mempalace-memory: failed to remove managed dreaming cron job ${job.id}: ${formatErrorMessage(err)}`,
        );
      });
    }
    return;
  }
  const desired = buildManagedDreamingCronJob(params.config);
  const [primary, ...duplicates] = managed;
  if (!primary) {
    await cron.add(desired);
    params.logger.info("mempalace-memory: created managed dreaming cron job.");
    return;
  }
  const patch = buildManagedDreamingPatch(primary, desired);
  if (patch) {
    await cron.update(primary.id, patch);
    params.logger.info("mempalace-memory: updated managed dreaming cron job.");
  }
  for (const duplicate of duplicates) {
    await cron.remove(duplicate.id).catch((err) => {
      params.logger.warn(
        `mempalace-memory: failed to prune duplicate managed dreaming cron job ${duplicate.id}: ${formatErrorMessage(err)}`,
      );
    });
  }
}

function collectRecentRecallSignals(params: {
  events: Awaited<ReturnType<typeof readMemoryHostEvents>>;
  nowMs: number;
  lookbackDays: number;
  limit: number;
}): DreamingRecallAggregate[] {
  const cutoffMs = params.nowMs - params.lookbackDays * 24 * 60 * 60 * 1000;
  const aggregates = new Map<string, DreamingRecallAggregate>();
  for (const event of params.events) {
    if (event.type !== "memory.recall.recorded") {
      continue;
    }
    const eventMs = Date.parse(event.timestamp);
    if (!Number.isFinite(eventMs) || eventMs < cutoffMs) {
      continue;
    }
    const query = event.query.trim();
    if (!query) {
      continue;
    }
    const current = aggregates.get(query) ?? { query, hits: 0 };
    current.hits += 1;
    const firstPath = event.results[0]?.path;
    if (!current.topPath && typeof firstPath === "string" && firstPath.trim()) {
      current.topPath = firstPath.trim();
    }
    aggregates.set(query, current);
  }
  return [...aggregates.values()]
    .toSorted((a, b) => {
      if (a.hits !== b.hits) {
        return b.hits - a.hits;
      }
      return a.query.localeCompare(b.query);
    })
    .slice(0, Math.max(1, params.limit));
}

function buildLightDreamingDiaryEntry(params: {
  agentId: string;
  nowMs: number;
  aggregates: DreamingRecallAggregate[];
  snippets: string[];
}): string {
  const day = new Date(params.nowMs).toISOString().slice(0, 10);
  const queryBlock = params.aggregates
    .map((entry) => `${normalizeMempalaceSafeName(entry.query, "memory")}(${entry.hits}x)`)
    .join("+");
  const snippetBlock = params.snippets
    .slice(0, 3)
    .map((snippet) => snippet.replace(/\s+/g, " ").trim().slice(0, 80))
    .filter(Boolean)
    .join(" || ");
  return `SESSION:${day}|light.focus:${queryBlock || "none"}|recall.snippets:${snippetBlock || "none"}|agent:${normalizeMempalaceSafeName(params.agentId, "agent")}|★★★`;
}

function buildRemDreamingDrawerContent(params: {
  agentId: string;
  nowMs: number;
  aggregates: DreamingRecallAggregate[];
  snippets: string[];
}): string {
  const lines = [
    `# MemPalace Dreaming REM (${new Date(params.nowMs).toISOString()})`,
    "",
    `Agent: ${params.agentId}`,
    "",
    "Recurring associations:",
    ...params.aggregates.map((entry) => `- ${entry.query} (${entry.hits}x)`),
    "",
    "Representative recalled memories:",
    ...params.snippets.map((snippet) => `- ${snippet}`),
    "",
  ];
  return lines.join("\n");
}

function buildDeepDreamingKgFacts(params: {
  agentId: string;
  nowMs: number;
  aggregates: DreamingRecallAggregate[];
  kgThemes: number;
}): Array<{
  subject: string;
  predicate: string;
  object: string;
  validFrom: string;
}> {
  const validFrom = new Date(params.nowMs).toISOString().slice(0, 10);
  return params.aggregates.slice(0, Math.max(1, params.kgThemes)).map((aggregate) => ({
    subject: humanizeAgentId(params.agentId),
    predicate: "dreaming focus",
    object: aggregate.query,
    validFrom,
  }));
}

function buildDreamCompletionEvents(params: {
  agentId: string;
  timestamp: string;
  diaryTopic: string;
  contentHashes?: {
    light?: string;
    rem?: string;
    deep?: string;
  };
  drawer: {
    wing: string;
    room: string;
    drawerId?: string;
  };
  kgFacts: Array<{
    subject: string;
    predicate: string;
    object: string;
    validFrom: string;
  }>;
  aggregateCount: number;
}) {
  return [
    {
      type: "memory.dream.completed" as const,
      timestamp: params.timestamp,
      phase: "light" as const,
      reportPath: `mempalace://diary/${params.agentId}/${params.diaryTopic}`,
      lineCount: params.aggregateCount,
      storageMode: "both" as const,
      ...(params.contentHashes?.light ? { contentHash: params.contentHashes.light } : {}),
    },
    {
      type: "memory.dream.completed" as const,
      timestamp: params.timestamp,
      phase: "rem" as const,
      reportPath: params.drawer.drawerId
        ? `mempalace://drawer/${params.drawer.drawerId}`
        : `mempalace://drawer/${params.drawer.wing}/${params.drawer.room}`,
      lineCount: params.aggregateCount,
      storageMode: "both" as const,
      ...(params.contentHashes?.rem ? { contentHash: params.contentHashes.rem } : {}),
    },
    {
      type: "memory.dream.completed" as const,
      timestamp: params.timestamp,
      phase: "deep" as const,
      reportPath: `mempalace://kg/${params.agentId}/${params.kgFacts.length}`,
      lineCount: params.kgFacts.length,
      storageMode: "both" as const,
      ...(params.contentHashes?.deep ? { contentHash: params.contentHashes.deep } : {}),
    },
  ];
}

function digestContent(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function hasRecentDreamArtifact(params: {
  events: MemoryHostEvent[];
  phase: "light" | "rem" | "deep";
  contentHash: string;
  nowMs: number;
  lookbackMs?: number;
}): boolean {
  const cutoffMs = params.nowMs - (params.lookbackMs ?? 6 * 60 * 60 * 1000);
  return params.events.some((event) => {
    if (event.type !== "memory.dream.completed" || event.phase !== params.phase) {
      return false;
    }
    const eventMs = Date.parse(event.timestamp);
    if (!Number.isFinite(eventMs) || eventMs < cutoffMs) {
      return false;
    }
    return event.contentHash === params.contentHash;
  });
}

async function writeAutoExtractPromotionFacts(params: {
  cfg: OpenClawConfig;
  agentId: string;
  nowMs: number;
  candidates: AutoExtractPromotionCandidate[];
  logger: Logger;
}): Promise<number> {
  const resolved = resolveMempalacePluginConfig(params.cfg, params.agentId);
  if (!resolved.enabled || !resolved.server) {
    return 0;
  }
  const kgFacts = buildAutoExtractPromotionKgFacts({
    nowMs: params.nowMs,
    candidates: params.candidates,
  });
  let written = 0;
  const dateStamp = new Date(params.nowMs).toISOString().slice(0, 10);
  for (const fact of kgFacts) {
    try {
      ensureKgFactInMempalace({
        cfg: params.cfg,
        agentId: params.agentId,
        subject: fact.subject,
        predicate: fact.predicate,
        object: fact.object,
        validFrom: fact.validFrom,
        sourceFile: `auto-extract-promotion://${dateStamp}`,
      });
      written += 1;
    } catch (err) {
      params.logger.warn(
        `mempalace-memory: auto-extract promotion KG write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return written;
}

async function runMempalaceDreaming(params: {
  cfg: OpenClawConfig;
  agentId: string;
  workspaceDir: string;
  logger: Logger;
  config: MempalaceDreamingConfig;
}): Promise<MempalaceDreamingRunDetails | null> {
  const nowMs = Date.now();
  const events = await readMemoryHostEvents({
    workspaceDir: params.workspaceDir,
    limit: 400,
  });
  const aggregates = collectRecentRecallSignals({
    events,
    nowMs,
    lookbackDays: params.config.lookbackDays,
    limit: params.config.limit,
  });

  // Collect auto-extract promotion candidates regardless of recall signal availability.
  const promotionCandidates = params.config.autoExtractPromotion.enabled
    ? collectAutoExtractPromotionCandidates({
        events,
        nowMs,
        lookbackDays: params.config.lookbackDays,
        minHits: params.config.autoExtractPromotion.minHits,
      })
    : [];

  if (aggregates.length === 0 && promotionCandidates.length === 0) {
    params.logger.info(
      "mempalace-memory: dreaming skipped because no recent recall signals or promotion candidates were found.",
    );
    return null;
  }

  // Promotion-only path: run lightweight KG promotion without full dreaming passes.
  if (aggregates.length === 0 && promotionCandidates.length > 0) {
    const promoted = await writeAutoExtractPromotionFacts({
      cfg: params.cfg,
      agentId: params.agentId,
      nowMs,
      candidates: promotionCandidates,
      logger: params.logger,
    });
    if (promoted > 0) {
      params.logger.info(
        `mempalace-memory: auto-extract promotion promoted ${promoted} fact(s) to KG (no recall signals this cycle).`,
      );
    }
    return {
      agentId: params.agentId,
      workspaceDir: params.workspaceDir,
      aggregateCount: 0,
      diary: { topic: "dreaming-light" },
      drawer: { wing: "OpenClaw Dreaming", room: humanizeAgentId(params.agentId) },
      kgFacts: [],
      verified: { drawer: false, kgFacts: 0 },
      autoExtractPromotions: promoted,
    };
  }
  const { manager, error } = await getMempalaceMemorySearchManager({
    cfg: params.cfg,
    agentId: params.agentId,
  });
  if (!manager) {
    throw new Error(error ?? "MemPalace manager unavailable for dreaming.");
  }
  try {
    const snippets: string[] = [];
    for (const aggregate of aggregates) {
      if (!aggregate.topPath) {
        continue;
      }
      try {
        const result = await manager.readFile({ relPath: aggregate.topPath });
        const snippet = result.text.replace(/\s+/g, " ").trim();
        if (snippet) {
          snippets.push(snippet.slice(0, 240));
        }
      } catch {
        // Best-effort only.
      }
    }
    const dedupedSnippets = [...new Set(snippets)].slice(0, params.config.limit);
    const diaryTopic = "dreaming-light";
    const timestamp = new Date(nowMs).toISOString();
    const diaryEntry = buildLightDreamingDiaryEntry({
      agentId: params.agentId,
      nowMs,
      aggregates,
      snippets: dedupedSnippets,
    });
    const drawerContent = buildRemDreamingDrawerContent({
      agentId: params.agentId,
      nowMs,
      aggregates,
      snippets: dedupedSnippets,
    });
    const deepFacts = buildDeepDreamingKgFacts({
      agentId: params.agentId,
      nowMs,
      aggregates,
      kgThemes: params.config.kgThemes,
    });
    const contentHashes = {
      light: digestContent(diaryEntry),
      rem: digestContent(drawerContent),
      deep: digestContent(JSON.stringify(deepFacts)),
    };
    const duplicateDiary = hasRecentDreamArtifact({
      events,
      phase: "light",
      contentHash: contentHashes.light,
      nowMs,
    });
    const duplicateDrawer = hasRecentDreamArtifact({
      events,
      phase: "rem",
      contentHash: contentHashes.rem,
      nowMs,
    });
    const duplicateDeep = hasRecentDreamArtifact({
      events,
      phase: "deep",
      contentHash: contentHashes.deep,
      nowMs,
    });

    if (!duplicateDiary) {
      await saveDreamingDiaryToMempalace({
        cfg: params.cfg,
        agentId: params.agentId,
        entry: diaryEntry,
        topic: diaryTopic,
      });
    }
    const drawer = duplicateDrawer
      ? {
          wing: "OpenClaw Dreaming",
          room: humanizeAgentId(params.agentId),
          drawerId: undefined,
        }
      : await saveDreamingDrawerToMempalace({
          cfg: params.cfg,
          agentId: params.agentId,
          content: drawerContent,
          wing: "OpenClaw Dreaming",
          room: humanizeAgentId(params.agentId),
          sourceFile: `dreaming-rem://${new Date(nowMs).toISOString().slice(0, 10)}`,
        });
    if (!duplicateDeep) {
      for (const fact of deepFacts) {
        ensureKgFactInMempalace({
          cfg: params.cfg,
          agentId: params.agentId,
          subject: fact.subject,
          predicate: fact.predicate,
          object: fact.object,
          validFrom: fact.validFrom,
          sourceFile: `dreaming-deep://${fact.validFrom}`,
        });
      }
    }
    const completionEvents = buildDreamCompletionEvents({
      agentId: params.agentId,
      timestamp,
      diaryTopic,
      contentHashes,
      drawer,
      kgFacts: deepFacts,
      aggregateCount: aggregates.length,
    });
    for (const event of completionEvents.filter((event) => {
      if (!event.contentHash) {
        return true;
      }
      return !hasRecentDreamArtifact({
        events,
        phase: event.phase,
        contentHash: event.contentHash,
        nowMs,
      });
    })) {
      await appendMemoryHostEvent(params.workspaceDir, event);
    }
    const resolved = resolveMempalacePluginConfig(params.cfg, params.agentId);
    const verifiedDrawer = drawer.drawerId
      ? Boolean(
          await readDrawerById({
            cfg: params.cfg,
            agentId: params.agentId,
            palacePath: resolved.privatePalacePath,
            drawerId: drawer.drawerId,
          }),
        )
      : false;
    const verifiedKgFacts = deepFacts.filter((fact) =>
      Boolean(
        readKnowledgeGraphFact({
          dbPath: resolved.privateKnowledgeGraphPath,
          subject: fact.subject,
          predicate: fact.predicate.toLowerCase().replaceAll(" ", "_"),
          object: fact.object,
          validFrom: fact.validFrom,
        }),
      ),
    ).length;
    // Auto-extract promotion: promote repeated user facts to KG alongside recall-driven deep facts.
    const autoExtractPromotions =
      promotionCandidates.length > 0
        ? await writeAutoExtractPromotionFacts({
            cfg: params.cfg,
            agentId: params.agentId,
            nowMs,
            candidates: promotionCandidates,
            logger: params.logger,
          })
        : 0;
    const promotionSuffix =
      autoExtractPromotions > 0 ? `, promoted ${autoExtractPromotions} auto-extract fact(s)` : "";
    params.logger.info(
      `mempalace-memory: dreaming processed light diary + rem drawer + deep KG signals (${aggregates.length} focus item(s), wing=${drawer.wing}, room=${drawer.room}${promotionSuffix}).`,
    );
    return {
      agentId: params.agentId,
      workspaceDir: params.workspaceDir,
      aggregateCount: aggregates.length,
      diary: {
        topic: diaryTopic,
      },
      drawer,
      kgFacts: deepFacts,
      verified: {
        drawer: verifiedDrawer,
        kgFacts: verifiedKgFacts,
      },
      autoExtractPromotions,
    };
  } finally {
    await manager.close?.().catch(() => undefined);
  }
}

export async function runMempalaceDreamingNow(params: {
  cfg: OpenClawConfig;
  agentId: string;
}): Promise<MempalaceDreamingRunDetails> {
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, params.agentId);
  if (!workspaceDir) {
    throw new Error(`No workspace found for ${params.agentId}.`);
  }
  const nowMs = Date.now();
  const events = await readMemoryHostEvents({
    workspaceDir,
    limit: 400,
  });
  const config = {
    ...resolveMempalaceDreamingConfig(params.cfg),
    enabled: true,
  };
  const aggregates = collectRecentRecallSignals({
    events,
    nowMs,
    lookbackDays: config.lookbackDays,
    limit: config.limit,
  });
  const result = await runMempalaceDreaming({
    cfg: params.cfg,
    agentId: params.agentId,
    workspaceDir,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    config,
  });
  if (result) {
    return result;
  }
  return {
    agentId: params.agentId,
    workspaceDir,
    aggregateCount: aggregates.length,
    diary: {
      topic: "dreaming-light",
    },
    drawer: {
      wing: "OpenClaw Dreaming",
      room: humanizeAgentId(params.agentId),
    },
    kgFacts: [],
    verified: {
      drawer: false,
      kgFacts: 0,
    },
    autoExtractPromotions: 0,
  };
}

export function registerMempalaceDreaming(api: OpenClawPluginApi): void {
  api.registerHook(
    "gateway:startup",
    async (event: unknown) => {
      try {
        if (!shouldUseMempalaceSessionMemory(api.config)) {
          return;
        }
        const config = resolveMempalaceDreamingConfig(api.config);
        const cron = resolveCronServiceFromStartupEvent(event);
        if (!cron && config.enabled) {
          api.logger.warn(
            "mempalace-memory: managed dreaming cron could not be reconciled (cron service unavailable).",
          );
        }
        await reconcileDreamingCronJob({ cron, config, logger: api.logger });
      } catch (err) {
        api.logger.error(
          `mempalace-memory: dreaming startup reconciliation failed: ${formatErrorMessage(err)}`,
        );
      }
    },
    { name: "mempalace-memory-dreaming-cron" },
  );

  api.on("before_agent_reply", async (event, ctx) => {
    if (!shouldUseMempalaceSessionMemory(api.config)) {
      return undefined;
    }
    const config = resolveMempalaceDreamingConfig(api.config);
    if (!config.enabled) {
      return undefined;
    }
    if (ctx.trigger !== "heartbeat" || event.cleanedBody.trim() !== DREAMING_SYSTEM_EVENT_TEXT) {
      return undefined;
    }
    if (!ctx.workspaceDir || !ctx.agentId) {
      api.logger.warn(
        "mempalace-memory: dreaming skipped because workspaceDir/agentId are missing.",
      );
      return { handled: true, reason: "mempalace-memory: dreaming missing runtime context" };
    }
    try {
      await runMempalaceDreaming({
        cfg: api.config,
        agentId: ctx.agentId,
        workspaceDir: ctx.workspaceDir,
        logger: api.logger,
        config,
      });
      return { handled: true, reason: "mempalace-memory: dreaming processed" };
    } catch (err) {
      api.logger.error(`mempalace-memory: dreaming failed: ${formatErrorMessage(err)}`);
      return { handled: true, reason: "mempalace-memory: dreaming failed" };
    }
  });
}

export const __testing = {
  ...dreamingTesting,
  buildManagedDreamingPatch,
  hasRecentDreamArtifact,
  isManagedDreamingJob,
  resolveCronServiceFromStartupEvent,
  reconcileDreamingCronJob,
};
