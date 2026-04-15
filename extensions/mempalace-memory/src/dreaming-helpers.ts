import type { OpenClawConfig } from "openclaw/plugin-sdk/memory-core";
import type { MemoryHostEvent } from "openclaw/plugin-sdk/memory-host-events";
import {
  MEMPALACE_DREAMING_DEFAULTS,
  resolveMempalaceDreamingConfig,
  type MempalaceDreamingConfig,
} from "./dreaming-config.js";

type ManagedCronJobCreate = {
  name: string;
  description: string;
  enabled: boolean;
  schedule: { kind: "cron"; expr: string; tz?: string };
  sessionTarget: "main";
  wakeMode: "next-heartbeat";
  payload: { kind: "systemEvent"; text: string };
};

type DreamingRecallAggregate = {
  query: string;
  hits: number;
  topPath?: string;
};

type DreamingRunTarget =
  | { ok: true; agentId: string; workspaceDir: string }
  | { ok: false; reason: string };

export const MANAGED_DREAMING_CRON_NAME = "MemPalace Dreaming";
export const MANAGED_DREAMING_CRON_TAG = "[managed-by=mempalace-memory.dreaming]";
export const DREAMING_SYSTEM_EVENT_TEXT = "__openclaw_mempalace_dreaming__";
export const { DEFAULT_DREAMING_CRON } = MEMPALACE_DREAMING_DEFAULTS;

function normalizeMempalaceSafeName(value: string, fallback: string): string {
  const trimmed = value.trim();
  const replaced = trimmed
    .replaceAll("_", " ")
    .replace(/[^a-zA-Z0-9 .'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const candidate = replaced || fallback;
  const withoutLeading = candidate.replace(/^[^a-zA-Z0-9]+/g, "").trim();
  const finalValue = withoutLeading || fallback;
  return finalValue.slice(0, 128);
}

function humanizeAgentId(agentId: string): string {
  return normalizeMempalaceSafeName(agentId, "OpenClaw Agent");
}

function resolveAgentIdFromSessionKey(sessionKey?: string): string | undefined {
  const trimmed = sessionKey?.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = trimmed.match(/^agent:([^:]+):/);
  return match?.[1]?.trim();
}

function resolveDefaultAgentId(cfg: OpenClawConfig): string {
  const listed = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  const preferred = listed.find(
    (entry) =>
      entry && typeof entry === "object" && entry.default === true && typeof entry.id === "string",
  );
  if (preferred?.id?.trim()) {
    return preferred.id.trim();
  }
  const first = listed.find(
    (entry) =>
      entry && typeof entry === "object" && typeof entry.id === "string" && entry.id.trim(),
  );
  if (first?.id?.trim()) {
    return first.id.trim();
  }
  return "main";
}

function resolveAgentWorkspaceDir(cfg: OpenClawConfig, agentId: string): string | undefined {
  const listed = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  const match = listed.find(
    (entry) => entry && typeof entry === "object" && entry.id?.trim?.() === agentId,
  );
  const workspace =
    typeof match?.workspace === "string"
      ? match.workspace
      : typeof cfg.agents?.defaults?.workspace === "string"
        ? cfg.agents.defaults.workspace
        : undefined;
  const trimmed = workspace?.trim();
  return trimmed || undefined;
}

function resolveManagedDreamingDescription(config: MempalaceDreamingConfig): string {
  return `${MANAGED_DREAMING_CRON_TAG} Run MemPalace-native dreaming (cron=${config.cron}, lookbackDays=${config.lookbackDays}, limit=${config.limit}, kgThemes=${config.kgThemes}).`;
}

export function buildManagedDreamingCronJob(config: MempalaceDreamingConfig): ManagedCronJobCreate {
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

export function collectRecentRecallSignals(params: {
  events: Awaited<ReturnType<() => Promise<MemoryHostEvent[]>>>;
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

export function buildLightDreamingDiaryEntry(params: {
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

export function buildRemDreamingDrawerContent(params: {
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

export function buildDeepDreamingKgFacts(params: {
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

export function buildDreamCompletionEvents(params: {
  agentId: string;
  timestamp: string;
  diaryTopic: string;
  contentHashes?: { light?: string; rem?: string; deep?: string };
  drawer: { wing: string; room: string; drawerId?: string };
  kgFacts: Array<{ subject: string; predicate: string; object: string; validFrom: string }>;
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

export function resolveDreamingRunTarget(params: {
  cfg: OpenClawConfig;
  sessionKey?: string;
}): DreamingRunTarget {
  const activeSlot =
    typeof params.cfg.plugins?.slots?.memory === "string"
      ? params.cfg.plugins.slots.memory.trim()
      : "";
  if (
    activeSlot !== "mempalace-memory" ||
    params.cfg.plugins?.entries?.["mempalace-memory"]?.enabled === false
  ) {
    return {
      ok: false,
      reason: "Dreaming run unavailable because mempalace-memory is not the active memory slot.",
    };
  }
  const agentId =
    resolveAgentIdFromSessionKey(params.sessionKey) || resolveDefaultAgentId(params.cfg);
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, agentId);
  if (!workspaceDir) {
    return {
      ok: false,
      reason: `Dreaming run skipped: no workspace found for ${agentId}.`,
    };
  }
  return {
    ok: true,
    agentId,
    workspaceDir,
  };
}

export type AutoExtractPromotionCandidate = {
  category: string;
  summary: string;
  /** Number of distinct agent_end events in the lookback window that included this entry. */
  hits: number;
  /** Number of distinct agentIds that contributed at least one hit. */
  agentCount: number;
};

const AUTO_EXTRACT_PROMOTABLE_CATEGORIES = new Set([
  "standing_preference",
  "standing_constraint",
  "long_term_goal",
  "explicit_remember",
]);

const AUTO_EXTRACT_PREDICATE_BY_CATEGORY: Record<string, string> = {
  standing_preference: "prefers",
  standing_constraint: "avoids",
  long_term_goal: "has goal",
  explicit_remember: "remembers",
};

type PromotionAccumulator = {
  category: string;
  summary: string;
  hits: number;
  agentIds: Set<string>;
};

export function collectAutoExtractPromotionCandidates(params: {
  events: MemoryHostEvent[];
  nowMs: number;
  lookbackDays: number;
  minHits: number;
}): AutoExtractPromotionCandidate[] {
  const cutoffMs = params.nowMs - params.lookbackDays * 24 * 60 * 60 * 1000;
  const accumulators = new Map<string, PromotionAccumulator>();
  for (const event of params.events) {
    if (event.type !== "memory.auto_extract.written") {
      continue;
    }
    const eventMs = Date.parse(event.timestamp);
    if (!Number.isFinite(eventMs) || eventMs < cutoffMs) {
      continue;
    }
    const eventAgentId = event.agentId?.trim() ?? "";
    for (const entry of event.entries) {
      if (entry.scope !== "shared" || entry.storage === "kg") {
        continue;
      }
      if (!AUTO_EXTRACT_PROMOTABLE_CATEGORIES.has(entry.category)) {
        continue;
      }
      const summary = entry.summary.trim();
      if (!summary) {
        continue;
      }
      const key = `${entry.category}\n${summary}`;
      const current = accumulators.get(key) ?? {
        category: entry.category,
        summary,
        hits: 0,
        agentIds: new Set<string>(),
      };
      current.hits += 1;
      if (eventAgentId) {
        current.agentIds.add(eventAgentId);
      }
      accumulators.set(key, current);
    }
  }
  return [...accumulators.values()]
    .filter((c) => c.hits >= params.minHits)
    .map((c) => ({
      category: c.category,
      summary: c.summary,
      hits: c.hits,
      agentCount: c.agentIds.size,
    }))
    .toSorted((a, b) => {
      if (a.hits !== b.hits) {
        return b.hits - a.hits;
      }
      return a.summary.localeCompare(b.summary);
    });
}

export function buildAutoExtractPromotionKgFacts(params: {
  nowMs: number;
  candidates: AutoExtractPromotionCandidate[];
  /** Identity label for the KG subject. Defaults to "User". */
  userIdentity?: string;
}): Array<{ subject: string; predicate: string; object: string; validFrom: string }> {
  const subject = params.userIdentity?.trim() || "User";
  const validFrom = new Date(params.nowMs).toISOString().slice(0, 10);
  const facts: Array<{ subject: string; predicate: string; object: string; validFrom: string }> =
    [];
  for (const candidate of params.candidates) {
    const predicate = AUTO_EXTRACT_PREDICATE_BY_CATEGORY[candidate.category];
    if (!predicate) {
      continue;
    }
    facts.push({
      subject,
      predicate,
      object: candidate.summary.slice(0, 200),
      validFrom,
    });
  }
  return facts;
}

export const dreamingTesting = {
  buildManagedDreamingCronJob,
  collectRecentRecallSignals,
  buildLightDreamingDiaryEntry,
  buildRemDreamingDrawerContent,
  buildDeepDreamingKgFacts,
  buildDreamCompletionEvents,
  resolveDreamingRunTarget,
  resolveMempalaceDreamingConfig,
  collectAutoExtractPromotionCandidates,
  buildAutoExtractPromotionKgFacts,
  constants: {
    MANAGED_DREAMING_CRON_NAME,
    MANAGED_DREAMING_CRON_TAG,
    DREAMING_SYSTEM_EVENT_TEXT,
    DEFAULT_DREAMING_CRON,
  },
};
