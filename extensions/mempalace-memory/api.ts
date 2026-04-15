import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OpenClawConfig } from "openclaw/plugin-sdk/memory-core";
import type { MemoryHostEvent } from "openclaw/plugin-sdk/memory-host-events";
import { readMemoryHostEvents } from "openclaw/plugin-sdk/memory-host-events";
import { callMempalaceTool } from "./src/bridge.js";
import { readDrawerById } from "./src/bridge.js";
import { resolveMempalacePluginConfig } from "./src/config.js";
import { resolveMempalaceDreamingConfig } from "./src/dreaming-config.js";

export function normalizeMempalaceSafeName(value: string, fallback: string): string {
  const trimmed = value.trim();
  const replaced = trimmed
    .replaceAll("_", " ")
    .replace(/[^\p{L}\p{N} .'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const candidate = replaced || fallback;
  const withoutLeading = candidate.replace(/^[^\p{L}\p{N}]+/gu, "").trim();
  const finalValue = withoutLeading || fallback;
  return finalValue.slice(0, 128);
}

export function humanizeAgentId(agentId: string): string {
  return normalizeMempalaceSafeName(agentId, "OpenClaw Agent");
}

function toKgEntityId(name: string): string {
  return name.toLowerCase().replaceAll(" ", "_").replaceAll("'", "");
}

async function callWriteTool(params: {
  cfg: OpenClawConfig;
  agentId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}): Promise<unknown> {
  const resolved = resolveMempalacePluginConfig(params.cfg, params.agentId);
  if (!resolved.enabled || !resolved.server) {
    throw new Error(
      `MemPalace write requested for ${params.toolName}, but mempalace-memory is not enabled.`,
    );
  }
  return await callMempalaceTool({
    cfg: params.cfg,
    agentId: params.agentId,
    toolName: params.toolName,
    palacePath: resolved.privatePalacePath,
    arguments: params.arguments,
  });
}

export function shouldUseMempalaceSessionMemory(cfg?: OpenClawConfig): boolean {
  const activeSlot =
    typeof cfg?.plugins?.slots?.memory === "string" ? cfg.plugins.slots.memory.trim() : "";
  if (activeSlot !== "mempalace-memory") {
    return false;
  }
  return cfg?.plugins?.entries?.["mempalace-memory"]?.enabled !== false;
}

export async function initializeAgentMempalaceSpace(params: {
  cfg: OpenClawConfig;
  agentId: string;
  displayName?: string;
  workspaceDir?: string;
}): Promise<{
  privatePalacePath: string;
  privateKnowledgeGraphPath: string;
  drawerId?: string;
}> {
  if (!shouldUseMempalaceSessionMemory(params.cfg)) {
    throw new Error("mempalace-memory is not the active memory slot.");
  }
  const resolved = resolveMempalacePluginConfig(params.cfg, params.agentId);
  if (!resolved.enabled || !resolved.server) {
    throw new Error("mempalace-memory is not enabled or MCP server is unavailable.");
  }

  await fs.mkdir(resolved.privatePalacePath, { recursive: true });
  await fs.mkdir(path.dirname(resolved.privateKnowledgeGraphPath), { recursive: true });

  const content = [
    "Agent identity seed",
    `agent_id: ${params.agentId}`,
    `display_name: ${params.displayName?.trim() || humanizeAgentId(params.agentId)}`,
    `workspace: ${params.workspaceDir?.trim() || "unknown"}`,
    "policy: use this private memory space as the canonical long-term memory for this agent.",
  ].join("\n");

  const result = (await callWriteTool({
    cfg: params.cfg,
    agentId: params.agentId,
    toolName: "mempalace_add_drawer",
    arguments: {
      wing: normalizeMempalaceSafeName(params.agentId, "agent"),
      room: "identity-seed",
      content,
      source_file: "agent-identity-seed.md",
      added_by: "openclaw-agent-seed",
    },
  })) as { success?: boolean; drawer_id?: string; error?: string };
  if (result.success !== true) {
    throw new Error(result.error ?? "MemPalace agent-space initialization failed.");
  }

  try {
    ensureKgFactInMempalace({
      cfg: params.cfg,
      agentId: params.agentId,
      subject: params.agentId,
      predicate: "role",
      object: "identity-seed",
      validFrom: new Date().toISOString().slice(0, 10),
      sourceFile: "seed://kg/identity",
    });
  } catch {
    // KG seed write is best-effort; do not fail the space initialization.
  }

  return {
    privatePalacePath: resolved.privatePalacePath,
    privateKnowledgeGraphPath: resolved.privateKnowledgeGraphPath,
    drawerId: typeof result.drawer_id === "string" ? result.drawer_id : undefined,
  };
}

export type MempalaceDoctorDreamingPayload = {
  lastKgFacts?: Array<{
    subject: string;
    predicate: string;
    object: string;
    validFrom?: string | null;
    sourceFile?: string | null;
  }>;
  backend: "mempalace-memory";
  enabled: boolean;
  timezone?: string;
  cron: string;
  lookbackDays: number;
  limit: number;
  kgThemes: number;
  recentRecallQueryCount: number;
  lastRunAt?: string;
  lastRunPhases?: string[];
  lastRunLineCount?: number;
  lastKgFactCount: number;
  lastVerifiedKgFacts: number;
  lastDrawer?: {
    wing?: string;
    room?: string;
    drawerId?: string;
    text?: string;
    sourceFile?: string | null;
    verified: boolean;
  };
  phases: {
    light: {
      enabled: boolean;
      cron: string;
      lookbackDays: number;
      limit: number;
      managedCronPresent: boolean;
    };
    deep: {
      enabled: boolean;
      cron: string;
      limit: number;
      minScore: number;
      minRecallCount: number;
      minUniqueQueries: number;
      recencyHalfLifeDays: number;
      managedCronPresent: boolean;
    };
    rem: {
      enabled: boolean;
      cron: string;
      lookbackDays: number;
      limit: number;
      minPatternStrength: number;
      managedCronPresent: boolean;
    };
  };
};

export type MempalaceDoctorDreamDiaryPayload = {
  found: boolean;
  path: string;
  content?: string;
  updatedAtMs?: number;
  source: "mempalace-events" | "none";
};

type DreamingBatch = {
  timestamp: string;
  phases: string[];
  lineCount: number;
  events: Array<Extract<MemoryHostEvent, { type: "memory.dream.completed" }>>;
};

function summarizeLatestDreamingBatch(events: MemoryHostEvent[]): DreamingBatch | null {
  const completed = events.filter(
    (event): event is Extract<MemoryHostEvent, { type: "memory.dream.completed" }> =>
      event.type === "memory.dream.completed",
  );
  const latestTimestamp = completed.at(-1)?.timestamp;
  if (!latestTimestamp) {
    return null;
  }
  const latestBatch = completed.filter((event) => event.timestamp === latestTimestamp);
  return {
    timestamp: latestTimestamp,
    phases: latestBatch.map((event) => event.phase),
    lineCount: latestBatch.reduce((sum, event) => sum + event.lineCount, 0),
    events: latestBatch,
  };
}

function countRecentRecallQueries(params: {
  events: MemoryHostEvent[];
  nowMs: number;
  lookbackDays: number;
}): number {
  const cutoffMs = params.nowMs - params.lookbackDays * 24 * 60 * 60 * 1000;
  const queries = new Set<string>();
  for (const event of params.events) {
    if (event.type !== "memory.recall.recorded") {
      continue;
    }
    const eventMs = Date.parse(event.timestamp);
    if (!Number.isFinite(eventMs) || eventMs < cutoffMs) {
      continue;
    }
    const query = event.query.trim();
    if (query) {
      queries.add(query);
    }
  }
  return queries.size;
}

function extractLatestRecallQueries(params: {
  events: MemoryHostEvent[];
  nowMs: number;
  lookbackDays: number;
  limit: number;
}): string[] {
  const cutoffMs = params.nowMs - params.lookbackDays * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const event of params.events.toReversed()) {
    if (event.type !== "memory.recall.recorded") {
      continue;
    }
    const eventMs = Date.parse(event.timestamp);
    if (!Number.isFinite(eventMs) || eventMs < cutoffMs) {
      continue;
    }
    const query = event.query.trim();
    if (!query || seen.has(query)) {
      continue;
    }
    seen.add(query);
    queries.push(query);
    if (queries.length >= params.limit) {
      break;
    }
  }
  return queries;
}

function parseDrawerReportPath(reportPath: string | undefined): {
  drawerId?: string;
  wing?: string;
  room?: string;
} | null {
  if (!reportPath?.startsWith("mempalace://drawer/")) {
    return null;
  }
  const raw = reportPath.slice("mempalace://drawer/".length);
  const parts = raw
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
  if (parts.length === 1) {
    return { drawerId: parts[0] };
  }
  if (parts.length >= 2) {
    return { wing: parts[0], room: parts[1] };
  }
  return null;
}

function countDreamingKgFacts(params: {
  cfg: OpenClawConfig;
  agentId: string;
  validFrom?: string;
}): number {
  if (!params.validFrom) {
    return 0;
  }
  const resolved = resolveMempalacePluginConfig(params.cfg, params.agentId);
  const agentName = humanizeAgentId(params.agentId);
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(resolved.privateKnowledgeGraphPath, { readOnly: true });
    db.exec("PRAGMA busy_timeout = 1000");
    const row = db
      .prepare(
        `SELECT COUNT(*) as count
           FROM triples t
           JOIN entities s ON t.subject = s.id
          WHERE s.name = ?
            AND t.predicate = ?
            AND t.valid_from = ?`,
      )
      .get(agentName, "dreaming_focus", params.validFrom) as { count?: number } | undefined;
    return typeof row?.count === "number" && Number.isFinite(row.count) ? row.count : 0;
  } catch {
    return 0;
  } finally {
    db?.close();
  }
}

function listDreamingKgFacts(params: {
  cfg: OpenClawConfig;
  agentId: string;
  validFrom?: string;
  limit?: number;
}): Array<{
  subject: string;
  predicate: string;
  object: string;
  validFrom?: string | null;
  sourceFile?: string | null;
}> {
  if (!params.validFrom) {
    return [];
  }
  const resolved = resolveMempalacePluginConfig(params.cfg, params.agentId);
  const agentName = humanizeAgentId(params.agentId);
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(resolved.privateKnowledgeGraphPath, { readOnly: true });
    db.exec("PRAGMA busy_timeout = 1000");
    const rows = db
      .prepare(
        `SELECT s.name as subject,
                t.predicate as predicate,
                o.name as object,
                t.valid_from as valid_from,
                t.source_file as source_file
           FROM triples t
           JOIN entities s ON t.subject = s.id
           JOIN entities o ON t.object = o.id
          WHERE s.name = ?
            AND t.predicate = ?
            AND t.valid_from = ?
          ORDER BY o.name ASC
          LIMIT ?`,
      )
      .all(agentName, "dreaming_focus", params.validFrom, Math.max(1, params.limit ?? 6)) as Array<{
      subject: string;
      predicate: string;
      object: string;
      valid_from?: string | null;
      source_file?: string | null;
    }>;
    return rows.map((row) => ({
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      validFrom: row.valid_from,
      sourceFile: row.source_file,
    }));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

export async function readMempalaceDreamingStatus(params: {
  cfg: OpenClawConfig;
  agentId: string;
  workspaceDir: string;
}): Promise<MempalaceDoctorDreamingPayload> {
  const dreaming = resolveMempalaceDreamingConfig(params.cfg);
  const events = await readMemoryHostEvents({
    workspaceDir: params.workspaceDir,
    limit: 400,
  });
  const batch = summarizeLatestDreamingBatch(events);
  const recentRecallQueryCount = countRecentRecallQueries({
    events,
    nowMs: Date.now(),
    lookbackDays: dreaming.lookbackDays,
  });
  const latestDeep = batch?.events.find((event) => event.phase === "deep");
  const latestRem = batch?.events.find((event) => event.phase === "rem");
  const validFrom = batch?.timestamp?.slice(0, 10);
  const lastKgFactCount = latestDeep?.lineCount ?? 0;
  const lastVerifiedKgFacts = countDreamingKgFacts({
    cfg: params.cfg,
    agentId: params.agentId,
    validFrom,
  });
  const lastKgFacts = listDreamingKgFacts({
    cfg: params.cfg,
    agentId: params.agentId,
    validFrom,
    limit: Math.max(1, dreaming.kgThemes),
  });

  let lastDrawer:
    | {
        wing?: string;
        room?: string;
        drawerId?: string;
        text?: string;
        sourceFile?: string | null;
        verified: boolean;
      }
    | undefined;
  const parsedDrawer = parseDrawerReportPath(latestRem?.reportPath);
  if (parsedDrawer) {
    if (parsedDrawer.drawerId) {
      const resolved = resolveMempalacePluginConfig(params.cfg, params.agentId);
      const drawer = await readDrawerById({
        cfg: params.cfg,
        agentId: params.agentId,
        palacePath: resolved.privatePalacePath,
        drawerId: parsedDrawer.drawerId,
      }).catch(() => null);
      lastDrawer = {
        drawerId: parsedDrawer.drawerId,
        wing: drawer?.wing,
        room: drawer?.room,
        ...(typeof drawer?.text === "string" && drawer.text.trim().length > 0
          ? { text: drawer.text.trim() }
          : {}),
        ...(typeof drawer?.source_file === "string" && drawer.source_file.trim().length > 0
          ? { sourceFile: drawer.source_file.trim() }
          : {}),
        verified: Boolean(drawer),
      };
    } else {
      lastDrawer = {
        wing: parsedDrawer.wing,
        room: parsedDrawer.room,
        verified: false,
      };
    }
  }

  return {
    backend: "mempalace-memory",
    enabled: dreaming.enabled,
    ...(dreaming.timezone ? { timezone: dreaming.timezone } : {}),
    cron: dreaming.cron,
    lookbackDays: dreaming.lookbackDays,
    limit: dreaming.limit,
    kgThemes: dreaming.kgThemes,
    recentRecallQueryCount,
    ...(batch
      ? {
          lastRunAt: batch.timestamp,
          lastRunPhases: batch.phases,
          lastRunLineCount: batch.lineCount,
        }
      : {}),
    ...(lastKgFacts.length > 0 ? { lastKgFacts } : {}),
    lastKgFactCount,
    lastVerifiedKgFacts,
    ...(lastDrawer ? { lastDrawer } : {}),
    phases: {
      light: {
        enabled: dreaming.enabled,
        cron: dreaming.cron,
        lookbackDays: dreaming.lookbackDays,
        limit: dreaming.limit,
        managedCronPresent: false,
      },
      deep: {
        enabled: dreaming.enabled,
        cron: dreaming.cron,
        limit: dreaming.kgThemes,
        minScore: 0,
        minRecallCount: 0,
        minUniqueQueries: 0,
        recencyHalfLifeDays: dreaming.lookbackDays,
        managedCronPresent: false,
      },
      rem: {
        enabled: dreaming.enabled,
        cron: dreaming.cron,
        lookbackDays: dreaming.lookbackDays,
        limit: dreaming.limit,
        minPatternStrength: 0,
        managedCronPresent: false,
      },
    },
  };
}

function renderMempalaceDreamingDiaryEntry(params: {
  agentId: string;
  batch: DreamingBatch;
  recentQueries: string[];
  status: MempalaceDoctorDreamingPayload;
}): string {
  const timeLabel = new Date(params.batch.timestamp).toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const lines = [
    "<!-- openclaw:dreaming:diary:start -->",
    "---",
    `*${timeLabel}*`,
    `MemPalace dreaming ran for ${humanizeAgentId(params.agentId)}.`,
    `Phases: ${params.batch.phases.join(", ")}.`,
    `Focus items processed: ${params.batch.lineCount}.`,
    `Recent recall queries: ${params.recentQueries.length > 0 ? params.recentQueries.join(", ") : "none recorded"}.`,
    `Verified drawer: ${params.status.lastDrawer?.verified ? "yes" : "no"}.`,
    `Verified KG facts: ${params.status.lastVerifiedKgFacts}.`,
    "<!-- openclaw:dreaming:diary:end -->",
  ];
  return lines.join("\n");
}

export async function readMempalaceDreamDiary(params: {
  cfg: OpenClawConfig;
  agentId: string;
  workspaceDir: string;
}): Promise<MempalaceDoctorDreamDiaryPayload> {
  const events = await readMemoryHostEvents({
    workspaceDir: params.workspaceDir,
    limit: 400,
  });
  const batch = summarizeLatestDreamingBatch(events);
  const path = `mempalace://diary/${params.agentId}/dreaming-light`;
  if (!batch) {
    return {
      found: false,
      path,
      source: "none",
    };
  }
  const status = await readMempalaceDreamingStatus(params);
  const recentQueries = extractLatestRecallQueries({
    events,
    nowMs: Date.now(),
    lookbackDays: status.lookbackDays,
    limit: 3,
  });
  return {
    found: true,
    path,
    content: renderMempalaceDreamingDiaryEntry({
      agentId: params.agentId,
      batch,
      recentQueries,
      status,
    }),
    updatedAtMs: Date.parse(batch.timestamp),
    source: "mempalace-events",
  };
}

export async function saveSessionMemoryToMempalace(params: {
  cfg: OpenClawConfig;
  agentId: string;
  entry: string;
  timestamp: number;
  slug?: string | null;
  sessionId?: string;
}): Promise<{
  palacePath: string;
  wing: string;
  room: string;
  drawerId?: string;
}> {
  const resolved = resolveMempalacePluginConfig(params.cfg, params.agentId);
  if (!resolved.enabled || !resolved.server) {
    throw new Error(
      "MemPalace session-memory write requested, but mempalace-memory is not enabled.",
    );
  }
  const palacePath = resolved.privatePalacePath;
  const wing = normalizeMempalaceSafeName(
    resolved.defaultWing ?? "OpenClaw Sessions",
    "OpenClaw Sessions",
  );
  const room = normalizeMempalaceSafeName(
    resolved.defaultRoom ?? humanizeAgentId(params.agentId),
    humanizeAgentId(params.agentId),
  );
  const dateStamp = new Date(params.timestamp).toISOString().slice(0, 10);
  const slug = normalizeMempalaceSafeName(
    params.slug?.trim() || params.sessionId || "session",
    "session",
  );
  const sourceFile = `session-memory://${dateStamp}/${slug}`;
  const result = (await callWriteTool({
    cfg: params.cfg,
    agentId: params.agentId,
    toolName: "mempalace_add_drawer",
    arguments: {
      wing,
      room,
      content: params.entry,
      source_file: sourceFile,
      added_by: "openclaw-session-memory",
    },
  })) as { success?: boolean; drawer_id?: string; error?: string };
  if (result.success !== true) {
    throw new Error(result.error ?? "MemPalace session-memory write failed.");
  }
  return {
    palacePath,
    wing,
    room,
    drawerId: typeof result.drawer_id === "string" ? result.drawer_id : undefined,
  };
}

export async function saveDreamingDrawerToMempalace(params: {
  cfg: OpenClawConfig;
  agentId: string;
  content: string;
  sourceFile?: string;
  wing?: string;
  room?: string;
}): Promise<{ wing: string; room: string; drawerId?: string }> {
  const resolved = resolveMempalacePluginConfig(params.cfg, params.agentId);
  const wing = normalizeMempalaceSafeName(
    params.wing ?? resolved.defaultWing ?? "OpenClaw Dreaming",
    "OpenClaw Dreaming",
  );
  const room = normalizeMempalaceSafeName(
    params.room ?? resolved.defaultRoom ?? humanizeAgentId(params.agentId),
    humanizeAgentId(params.agentId),
  );
  const result = (await callWriteTool({
    cfg: params.cfg,
    agentId: params.agentId,
    toolName: "mempalace_add_drawer",
    arguments: {
      wing,
      room,
      content: params.content,
      source_file: params.sourceFile ?? "dreaming://drawer",
      added_by: "openclaw-dreaming",
    },
  })) as { success?: boolean; drawer_id?: string; error?: string };
  if (result.success !== true) {
    throw new Error(result.error ?? "MemPalace dreaming drawer write failed.");
  }
  return {
    wing,
    room,
    drawerId: typeof result.drawer_id === "string" ? result.drawer_id : undefined,
  };
}

export async function saveDreamingDiaryToMempalace(params: {
  cfg: OpenClawConfig;
  agentId: string;
  entry: string;
  topic?: string;
}): Promise<{ wing: string; room: string; drawerId?: string }> {
  const room = normalizeMempalaceSafeName(humanizeAgentId(params.agentId), "OpenClaw Agent");
  const wing = "OpenClaw Dream Diary";
  const result = (await callWriteTool({
    cfg: params.cfg,
    agentId: params.agentId,
    toolName: "mempalace_add_drawer",
    arguments: {
      wing,
      room,
      content: params.entry,
      source_file: `dreaming://diary/${params.topic ?? "dreaming"}`,
      added_by: "openclaw-dreaming",
    },
  })) as { success?: boolean; drawer_id?: string; error?: string };
  if (result.success !== true) {
    throw new Error(result.error ?? "MemPalace diary write failed.");
  }
  return {
    wing,
    room,
    drawerId: typeof result.drawer_id === "string" ? result.drawer_id : undefined,
  };
}

export function ensureKgFactInMempalace(params: {
  cfg: OpenClawConfig;
  agentId: string;
  subject: string;
  predicate: string;
  object: string;
  validFrom?: string;
  sourceFile?: string;
  /** Override which KG database to write to. Defaults to the agent's private KG path. */
  dbPath?: string;
}): boolean {
  const resolved = resolveMempalacePluginConfig(params.cfg, params.agentId);
  const dbPath = params.dbPath ?? resolved.privateKnowledgeGraphPath;
  const subject = normalizeMempalaceSafeName(params.subject, "OpenClaw Agent");
  const predicate = normalizeMempalaceSafeName(params.predicate, "relates to")
    .toLowerCase()
    .replaceAll(" ", "_");
  const object = normalizeMempalaceSafeName(params.object, "unknown");
  const subjectId = toKgEntityId(subject);
  const objectId = toKgEntityId(object);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'unknown',
        properties TEXT DEFAULT '{}',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS triples (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        valid_from TEXT,
        valid_to TEXT,
        confidence REAL DEFAULT 1.0,
        source_closet TEXT,
        source_file TEXT,
        extracted_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_triples_subject ON triples(subject);
      CREATE INDEX IF NOT EXISTS idx_triples_object ON triples(object);
      CREATE INDEX IF NOT EXISTS idx_triples_predicate ON triples(predicate);
      CREATE INDEX IF NOT EXISTS idx_triples_valid ON triples(valid_from, valid_to);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_triples_dedup ON triples(subject, predicate, object, coalesce(valid_to, ''));
    `);
    db.prepare("INSERT OR IGNORE INTO entities (id, name) VALUES (?, ?)").run(subjectId, subject);
    db.prepare("INSERT OR IGNORE INTO entities (id, name) VALUES (?, ?)").run(objectId, object);
    const tripleId = `t_${subjectId}_${predicate}_${objectId}_${Date.now().toString(36)}`;
    const insertResult = db
      .prepare(
        "INSERT OR IGNORE INTO triples (id, subject, predicate, object, valid_from, valid_to, confidence, source_file) VALUES (?, ?, ?, ?, ?, NULL, 1.0, ?)",
      )
      .run(
        tripleId,
        subjectId,
        predicate,
        objectId,
        params.validFrom ?? null,
        params.sourceFile ?? "dreaming://kg",
      );
    return insertResult.changes > 0;
  } finally {
    db.close();
  }
}
