import { existsSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Type } from "@sinclair/typebox";
import {
  jsonResult,
  readNumberParam,
  readStringParam,
  resolveAgentWorkspaceDir,
  resolveSessionAgentId,
  type AnyAgentTool,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/memory-core";
import {
  buildSyntheticPath,
  callMempalaceTool,
  deleteDrawerBySyntheticPath,
  findDrawerBySyntheticPath,
  forceInsertDrawer,
  listDrawerRecords,
  parseSyntheticPath,
  readDrawerById,
  readKnowledgeGraphFact,
  updateDrawerBySyntheticPath,
  writeDrawerDirect,
  type ParsedSyntheticPath,
} from "./bridge.js";
import { resolveMempalacePluginConfig } from "./config.js";
import { getMempalaceMemorySearchManager } from "./manager.js";
import { queueRecallEvent } from "./recall-events.js";

const MemorySearchSchema = Type.Object({
  query: Type.String(),
  maxResults: Type.Optional(Type.Number()),
  minScore: Type.Optional(Type.Number()),
});

const MemoryGetSchema = Type.Object({
  path: Type.String(),
  from: Type.Optional(Type.Number()),
  lines: Type.Optional(Type.Number()),
});

const MemoryWriteMetadataSchema = Type.Object(
  {
    category: Type.Optional(Type.String()),
    room: Type.Optional(Type.String()),
    source: Type.Optional(Type.String()),
    importance: Type.Optional(Type.Number()),
    tags: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: true },
);

const MemoryWriteSchema = Type.Object(
  {
    content: Type.String(),
    metadata: Type.Optional(MemoryWriteMetadataSchema),
    category: Type.Optional(Type.String()),
    room: Type.Optional(Type.String()),
    source: Type.Optional(Type.String()),
    importance: Type.Optional(Type.Number()),
    tags: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: true },
);

const MemoryKgQuerySchema = Type.Object(
  {
    query: Type.Optional(Type.String()),
    entity: Type.Optional(Type.String()),
    relation: Type.Optional(Type.String()),
    object: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Number()),
    scope: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const MemoryUpdateSchema = Type.Object(
  {
    path: Type.String(),
    content: Type.Optional(Type.String()),
    metadata: Type.Optional(MemoryWriteMetadataSchema),
    category: Type.Optional(Type.String()),
    room: Type.Optional(Type.String()),
    source: Type.Optional(Type.String()),
    importance: Type.Optional(Type.Number()),
    tags: Type.Optional(Type.Array(Type.String())),
    subject: Type.Optional(Type.String()),
    predicate: Type.Optional(Type.String()),
    object: Type.Optional(Type.String()),
    validFrom: Type.Optional(Type.String()),
    validTo: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const MemoryDeleteSchema = Type.Object(
  {
    path: Type.String(),
    hard: Type.Optional(Type.Boolean()),
    reason: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const MemoryExportSchema = Type.Object(
  {
    scope: Type.Optional(Type.String()),
    maxDrawers: Type.Optional(Type.Number()),
    maxTriples: Type.Optional(Type.Number()),
    includeContent: Type.Optional(Type.Boolean()),
    outputPath: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const MemoryImportSchema = Type.Object(
  {
    data: Type.Optional(Type.Object({}, { additionalProperties: true })),
    payload: Type.Optional(Type.Object({}, { additionalProperties: true })),
    inputPath: Type.Optional(Type.String()),
    targetScope: Type.Optional(Type.String()),
    dedupe: Type.Optional(Type.Boolean()),
    overwrite: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: true },
);

const RawMempalaceSchema = Type.Object({}, { additionalProperties: true });
const MempalaceSearchSchema = Type.Object(
  {
    query: Type.String(),
    maxResults: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
);
const MempalaceAddDrawerSchema = Type.Object(
  {
    wing: Type.String(),
    room: Type.String(),
    content: Type.String(),
    sourceFile: Type.Optional(Type.String()),
    source_file: Type.Optional(Type.String()),
    addedBy: Type.Optional(Type.String()),
    added_by: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
const MempalaceCheckDuplicateSchema = Type.Object(
  {
    content: Type.String(),
    threshold: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
);
const MempalaceKgQuerySchema = Type.Object(
  {
    query: Type.String(),
    maxResults: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
);
const MempalaceKgMutationSchema = Type.Object(
  {
    subject: Type.String(),
    predicate: Type.String(),
    object: Type.String(),
    validFrom: Type.Optional(Type.String()),
    valid_from: Type.Optional(Type.String()),
    validTo: Type.Optional(Type.String()),
    valid_to: Type.Optional(Type.String()),
    sourceFile: Type.Optional(Type.String()),
    source_file: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
const MempalaceDiaryReadSchema = Type.Object(
  {
    topic: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
const MempalaceDiaryWriteSchema = Type.Object(
  {
    content: Type.Optional(Type.String()),
    entry: Type.Optional(Type.String()),
    topic: Type.Optional(Type.String()),
    sourceFile: Type.Optional(Type.String()),
    source_file: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

type MemoryWriteMetadata = {
  category?: string;
  room?: string;
  source?: string;
  importance?: number;
  tags?: string[];
};

type KnowledgeGraphRow = {
  subject: string;
  predicate: string;
  object: string;
  valid_from?: string | null;
  valid_to?: string | null;
  source_file?: string | null;
};

type ParsedStoredMemoryContent = {
  body: string;
  metadata: MemoryWriteMetadata;
  managed: boolean;
};

type MemoryImportDrawerRecord = {
  path?: string;
  wing?: string;
  room?: string;
  content?: string;
  text?: string;
  sourceFile?: string;
  source_file?: string;
};

type MemoryImportTripleRecord = {
  subject?: string;
  predicate?: string;
  object?: string;
  validFrom?: string | null;
  valid_from?: string | null;
  validTo?: string | null;
  valid_to?: string | null;
  sourceFile?: string | null;
  source_file?: string | null;
};

function normalizeSafeName(value: string, fallback: string): string {
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

function humanizeAgentName(agentId: string): string {
  return normalizeSafeName(agentId, "OpenClaw Agent");
}

export const MEMPALACE_NATIVE_TOOL_NAMES = [
  "mempalace_status",
  "mempalace_search",
  "mempalace_check_duplicate",
  "mempalace_add_drawer",
  "mempalace_kg_query",
  "mempalace_kg_add",
  "mempalace_kg_invalidate",
  "mempalace_kg_timeline",
  "mempalace_diary_read",
  "mempalace_diary_write",
] as const;

export const MEMPALACE_COMPAT_TOOL_NAMES = [
  "memory_write",
  "memory_kg_query",
  "memory_stats",
  "memory_update",
  "memory_delete",
  "memory_export",
  "memory_import",
] as const;

function isPluginEnabled(config?: OpenClawConfig): boolean {
  return config?.plugins?.entries?.["mempalace-memory"]?.enabled !== false;
}

function unavailableResult(extra?: Record<string, unknown>) {
  return {
    disabled: true,
    unavailable: true,
    error: "MemPalace-backed recall is unavailable.",
    action: "Check the MemPalace MCP runtime and palace configuration, then retry.",
    ...extra,
  };
}

function readOptionalString(params: Record<string, unknown>, key: string): string | undefined {
  return readStringParam(params, key);
}

function readOptionalRecord(
  params: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = params[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readOptionalStringArray(
  params: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = params[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function quoteFrontmatterString(value: string): string {
  return JSON.stringify(value);
}

function buildMetadataFrontmatter(metadata: MemoryWriteMetadata): string {
  const lines: string[] = [];
  if (metadata.category) {
    lines.push(`category: ${quoteFrontmatterString(metadata.category)}`);
  }
  if (metadata.room) {
    lines.push(`room: ${quoteFrontmatterString(metadata.room)}`);
  }
  if (metadata.source) {
    lines.push(`source: ${quoteFrontmatterString(metadata.source)}`);
  }
  if (metadata.importance !== undefined) {
    lines.push(`importance: ${metadata.importance}`);
  }
  if (metadata.tags && metadata.tags.length > 0) {
    lines.push("tags:");
    for (const tag of metadata.tags) {
      lines.push(`  - ${quoteFrontmatterString(tag)}`);
    }
  }
  if (lines.length === 0) {
    return "";
  }
  return `---\n${lines.join("\n")}\n---\n\n`;
}

function extractMemoryWriteMetadata(params: Record<string, unknown>): MemoryWriteMetadata {
  const rawMetadata = readOptionalRecord(params, "metadata") ?? {};
  const category =
    readOptionalString(rawMetadata, "category") ?? readOptionalString(params, "category");
  const room = readOptionalString(rawMetadata, "room") ?? readOptionalString(params, "room");
  const source = readOptionalString(rawMetadata, "source") ?? readOptionalString(params, "source");
  const importance =
    readNumberParam(rawMetadata, "importance") ?? readNumberParam(params, "importance");
  const tags =
    readOptionalStringArray(rawMetadata, "tags") ?? readOptionalStringArray(params, "tags");
  return {
    ...(category ? { category } : {}),
    ...(room ? { room } : {}),
    ...(source ? { source } : {}),
    ...(importance !== undefined ? { importance } : {}),
    ...(tags ? { tags } : {}),
  };
}

function buildStoredMemoryContent(content: string, metadata: MemoryWriteMetadata): string {
  const prefix = buildMetadataFrontmatter(metadata);
  return `${prefix}${content}`;
}

function parseManagedFrontmatter(text: string): ParsedStoredMemoryContent {
  if (!text.startsWith("---\n")) {
    return { body: text, metadata: {}, managed: false };
  }
  const endIndex = text.indexOf("\n---\n");
  if (endIndex < 0) {
    return { body: text, metadata: {}, managed: false };
  }
  const frontmatter = text.slice(4, endIndex);
  const body = text.slice(endIndex + 5);
  const lines = frontmatter.split("\n");
  const metadata: MemoryWriteMetadata = {};
  const tags: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      index += 1;
      continue;
    }
    if (line === "tags:") {
      index += 1;
      while (index < lines.length) {
        const tagLine = lines[index] ?? "";
        const trimmedTag = tagLine.trim();
        if (!trimmedTag.startsWith("- ")) {
          break;
        }
        const raw = trimmedTag.slice(2).trim();
        try {
          tags.push(JSON.parse(raw));
        } catch {
          tags.push(raw.replace(/^"(.*)"$/u, "$1"));
        }
        index += 1;
      }
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 0) {
      return { body: text, metadata: {}, managed: false };
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    switch (key) {
      case "category":
      case "room":
      case "source": {
        try {
          metadata[key] = JSON.parse(rawValue);
        } catch {
          metadata[key] = rawValue.replace(/^"(.*)"$/u, "$1");
        }
        break;
      }
      case "importance": {
        const value = Number(rawValue);
        if (!Number.isFinite(value)) {
          return { body: text, metadata: {}, managed: false };
        }
        metadata.importance = value;
        break;
      }
      default:
        return { body: text, metadata: {}, managed: false };
    }
    index += 1;
  }
  if (tags.length > 0) {
    metadata.tags = tags;
  }
  return {
    body,
    metadata,
    managed: true,
  };
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/u)
    .map((term) => term.trim())
    .filter(Boolean);
}

function readBooleanParam(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];
  return typeof value === "boolean" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readScopeParam(value: string | undefined, fallback: "private" | "all" = "private") {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "private" || normalized === "shared" || normalized === "all") {
    return normalized;
  }
  return fallback;
}

function buildKgFactText(row: {
  subject: string;
  predicate: string;
  object: string;
  valid_from?: string | null;
  valid_to?: string | null;
  source_file?: string | null;
}): string {
  const timing =
    row.valid_from || row.valid_to
      ? `\nvalid_from: ${row.valid_from ?? "unknown"}\nvalid_to: ${row.valid_to ?? "current"}`
      : "";
  const source = row.source_file ? `\nsource_file: ${row.source_file}` : "";
  return `${row.subject} -> ${row.predicate} -> ${row.object}${timing}${source}`;
}

function mergeCountMaps(
  ...maps: Array<Record<string, number> | null | undefined>
): Record<string, number> {
  const merged = new Map<string, number>();
  for (const map of maps) {
    if (!map) {
      continue;
    }
    for (const [key, value] of Object.entries(map)) {
      if (!Number.isFinite(value)) {
        continue;
      }
      merged.set(key, (merged.get(key) ?? 0) + value);
    }
  }
  return Object.fromEntries([...merged.entries()].toSorted(([a], [b]) => a.localeCompare(b)));
}

function countKnowledgeGraphFacts(dbPath?: string): number {
  if (!dbPath || !existsSync(dbPath)) {
    return 0;
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare("SELECT COUNT(*) AS count FROM triples").get() as
      | { count?: number }
      | undefined;
    return typeof row?.count === "number" ? row.count : 0;
  } catch {
    return 0;
  } finally {
    db.close();
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function readFileStats(paths: Array<string | undefined>): { bytes: number; lastUpdated?: string } {
  let bytes = 0;
  let lastUpdatedMs = 0;
  for (const filePath of new Set(paths.filter((value): value is string => Boolean(value)))) {
    if (!existsSync(filePath)) {
      continue;
    }
    const stat = statSync(filePath);
    bytes += stat.size;
    lastUpdatedMs = Math.max(lastUpdatedMs, stat.mtimeMs);
  }
  return {
    bytes,
    ...(lastUpdatedMs > 0 ? { lastUpdated: new Date(lastUpdatedMs).toISOString() } : {}),
  };
}

function queryKnowledgeGraphRows(params: {
  dbPath?: string;
  query?: string;
  entity?: string;
  relation?: string;
  object?: string;
  limit: number;
}): KnowledgeGraphRow[] {
  if (!params.dbPath || !existsSync(params.dbPath)) {
    return [];
  }
  const clauses: string[] = [];
  const sqlParams: string[] = [];
  const queryTerms = params.query ? tokenizeQuery(params.query) : [];
  if (queryTerms.length > 0) {
    const termClause = queryTerms
      .map(
        () =>
          "(lower(s.name) LIKE ? OR lower(t.predicate) LIKE ? OR lower(o.name) LIKE ? OR lower(coalesce(t.source_file, '')) LIKE ?)",
      )
      .join(" OR ");
    clauses.push(`(${termClause})`);
    for (const term of queryTerms) {
      const pattern = `%${term}%`;
      sqlParams.push(pattern, pattern, pattern, pattern);
    }
  }
  if (params.entity) {
    const pattern = `%${params.entity.trim().toLowerCase()}%`;
    clauses.push("(lower(s.name) LIKE ? OR lower(o.name) LIKE ?)");
    sqlParams.push(pattern, pattern);
  }
  if (params.relation) {
    clauses.push("lower(t.predicate) LIKE ?");
    sqlParams.push(`%${params.relation.trim().toLowerCase()}%`);
  }
  if (params.object) {
    clauses.push("lower(o.name) LIKE ?");
    sqlParams.push(`%${params.object.trim().toLowerCase()}%`);
  }
  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const db = new DatabaseSync(params.dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 1000");
    return db
      .prepare(
        `SELECT s.name AS subject, t.predicate AS predicate, o.name AS object,\n` +
          `       t.valid_from AS valid_from, t.valid_to AS valid_to, t.source_file AS source_file\n` +
          `  FROM triples t\n` +
          `  JOIN entities s ON t.subject = s.id\n` +
          `  JOIN entities o ON t.object = o.id\n` +
          `  ${whereClause}\n` +
          ` ORDER BY CASE WHEN t.valid_to IS NULL THEN 0 ELSE 1 END ASC,\n` +
          `          coalesce(t.valid_from, '') DESC,\n` +
          `          s.name ASC,\n` +
          `          t.predicate ASC,\n` +
          `          o.name ASC\n` +
          ` LIMIT ?`,
      )
      .all(...sqlParams, Math.max(1, params.limit)) as KnowledgeGraphRow[];
  } finally {
    db.close();
  }
}

function dedupeKnowledgeGraphRows(rows: KnowledgeGraphRow[]): KnowledgeGraphRow[] {
  const seen = new Set<string>();
  const deduped: KnowledgeGraphRow[] = [];
  for (const row of rows) {
    const key = [
      row.subject,
      row.predicate,
      row.object,
      row.valid_from ?? "",
      row.valid_to ?? "",
      row.source_file ?? "",
    ].join("\u0000");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function listKnowledgeGraphRows(params: { dbPath?: string; limit: number }): KnowledgeGraphRow[] {
  if (!params.dbPath || !existsSync(params.dbPath)) {
    return [];
  }
  const db = new DatabaseSync(params.dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 1000");
    return db
      .prepare(
        `SELECT s.name AS subject, t.predicate AS predicate, o.name AS object,\n` +
          `       t.valid_from AS valid_from, t.valid_to AS valid_to, t.source_file AS source_file\n` +
          `  FROM triples t\n` +
          `  JOIN entities s ON t.subject = s.id\n` +
          `  JOIN entities o ON t.object = o.id\n` +
          ` ORDER BY CASE WHEN t.valid_to IS NULL THEN 0 ELSE 1 END ASC,\n` +
          `          coalesce(t.valid_from, '') DESC,\n` +
          `          s.name ASC,\n` +
          `          t.predicate ASC,\n` +
          `          o.name ASC\n` +
          ` LIMIT ?`,
      )
      .all(Math.max(1, params.limit)) as KnowledgeGraphRow[];
  } finally {
    db.close();
  }
}

function deleteKnowledgeGraphRow(params: {
  dbPath?: string;
  parsed: Extract<ParsedSyntheticPath, { kind: "kg" }>;
}): boolean {
  if (!params.dbPath || !existsSync(params.dbPath)) {
    return false;
  }
  const db = new DatabaseSync(params.dbPath);
  try {
    const result = db
      .prepare(
        `DELETE FROM triples\n` +
          ` WHERE subject IN (SELECT id FROM entities WHERE name = ?)\n` +
          `   AND predicate = ?\n` +
          `   AND object IN (SELECT id FROM entities WHERE name = ?)\n` +
          `   AND ((? IS NULL AND valid_from IS NULL) OR valid_from = ?)\n` +
          `   AND ((? IS NULL AND valid_to IS NULL) OR valid_to = ?)`,
      )
      .run(
        params.parsed.subject,
        params.parsed.predicate,
        params.parsed.object,
        params.parsed.validFrom ?? null,
        params.parsed.validFrom ?? null,
        params.parsed.validTo ?? null,
        params.parsed.validTo ?? null,
      ) as { changes?: number };
    return (result.changes ?? 0) > 0;
  } finally {
    db.close();
  }
}

function ensureKnowledgeGraphSchema(db: DatabaseSync): void {
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
  `);
}

function toKgEntityId(name: string): string {
  return name.toLowerCase().replaceAll(" ", "_").replaceAll("'", "");
}

function insertKnowledgeGraphRow(params: {
  dbPath: string;
  row: MemoryImportTripleRecord;
  scope: "private" | "shared";
}): { inserted: boolean; path?: string } {
  const subjectRaw = params.row.subject?.trim();
  const predicateRaw = params.row.predicate?.trim();
  const objectRaw = params.row.object?.trim();
  if (!subjectRaw || !predicateRaw || !objectRaw) {
    return { inserted: false };
  }
  const subject = normalizeSafeName(subjectRaw, "OpenClaw Agent");
  const predicate = normalizeSafeName(predicateRaw, "relates to")
    .toLowerCase()
    .replaceAll(" ", "_");
  const object = normalizeSafeName(objectRaw, "unknown");
  const validFrom = params.row.validFrom ?? params.row.valid_from ?? null;
  const validTo = params.row.validTo ?? params.row.valid_to ?? null;
  const sourceFile = params.row.sourceFile ?? params.row.source_file ?? "memory-import://kg";
  const db = new DatabaseSync(params.dbPath);
  try {
    ensureKnowledgeGraphSchema(db);
    const subjectId = toKgEntityId(subject);
    const objectId = toKgEntityId(object);
    db.prepare("INSERT OR IGNORE INTO entities (id, name) VALUES (?, ?)").run(subjectId, subject);
    db.prepare("INSERT OR IGNORE INTO entities (id, name) VALUES (?, ?)").run(objectId, object);
    const existing = db
      .prepare(
        "SELECT id FROM triples WHERE subject = ? AND predicate = ? AND object = ? AND ((? IS NULL AND valid_from IS NULL) OR valid_from = ?) AND ((? IS NULL AND valid_to IS NULL) OR valid_to = ?) LIMIT 1",
      )
      .get(subjectId, predicate, objectId, validFrom, validFrom, validTo, validTo) as
      | { id?: string }
      | undefined;
    if (existing?.id) {
      return {
        inserted: false,
        path: buildSyntheticPath({
          scope: params.scope,
          kind: "kg",
          subject,
          predicate,
          object,
          validFrom,
          validTo,
          text: buildKgFactText({
            subject,
            predicate,
            object,
            valid_from: validFrom,
            valid_to: validTo,
            source_file: sourceFile,
          }),
        }),
      };
    }
    const tripleId = `t_${subjectId}_${predicate}_${objectId}_${Date.now().toString(36)}`;
    db.prepare(
      "INSERT INTO triples (id, subject, predicate, object, valid_from, valid_to, confidence, source_file) VALUES (?, ?, ?, ?, ?, ?, 1.0, ?)",
    ).run(tripleId, subjectId, predicate, objectId, validFrom, validTo, sourceFile);
    return {
      inserted: true,
      path: buildSyntheticPath({
        scope: params.scope,
        kind: "kg",
        subject,
        predicate,
        object,
        validFrom,
        validTo,
        text: buildKgFactText({
          subject,
          predicate,
          object,
          valid_from: validFrom,
          valid_to: validTo,
          source_file: sourceFile,
        }),
      }),
    };
  } finally {
    db.close();
  }
}

function resolveToolWorkspaceDir(cfg: OpenClawConfig, agentId: string): string {
  return resolveAgentWorkspaceDir(cfg, agentId) ?? process.cwd();
}

function resolveFilesystemPath(baseDir: string, targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(baseDir, targetPath);
}

function buildNativeToolResult(toolName: string, extra?: Record<string, unknown>) {
  return unavailableResult({
    tool: toolName,
    ...extra,
  });
}

async function executeNativeMempalaceTool(params: {
  options: {
    config?: OpenClawConfig;
    agentSessionKey?: string;
  };
  toolName: (typeof MEMPALACE_NATIVE_TOOL_NAMES)[number];
  rawParams: Record<string, unknown>;
  normalize?: (params: Record<string, unknown>) => Record<string, unknown>;
}) {
  const cfg = params.options.config;
  if (!cfg) {
    return jsonResult(buildNativeToolResult(params.toolName));
  }
  const agentId = resolveSessionAgentId({
    sessionKey: params.options.agentSessionKey,
    config: cfg,
  });
  const resolved = resolveMempalacePluginConfig(cfg, agentId);
  if (!resolved.enabled || !resolved.server) {
    return jsonResult(
      buildNativeToolResult(params.toolName, {
        error: "MemPalace MCP runtime unavailable.",
      }),
    );
  }
  try {
    const result = await callMempalaceTool({
      cfg,
      agentId,
      toolName: params.toolName,
      palacePath: resolved.privatePalacePath,
      arguments: params.normalize ? params.normalize(params.rawParams) : params.rawParams,
    });
    return jsonResult(result as Record<string, unknown>);
  } catch (cause) {
    return jsonResult(
      buildNativeToolResult(params.toolName, {
        error: cause instanceof Error ? cause.message : String(cause),
      }),
    );
  }
}

function createNativeMempalaceTool(
  options: {
    config?: OpenClawConfig;
    agentSessionKey?: string;
  },
  definition: {
    label: string;
    name: (typeof MEMPALACE_NATIVE_TOOL_NAMES)[number];
    description: string;
    parameters: ReturnType<typeof Type.Object>;
    normalize?: (params: Record<string, unknown>) => Record<string, unknown>;
  },
): AnyAgentTool | null {
  if (!isPluginEnabled(options.config)) {
    return null;
  }
  return {
    label: definition.label,
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    execute: async (_toolCallId, params) =>
      await executeNativeMempalaceTool({
        options,
        toolName: definition.name,
        rawParams: params,
        normalize: definition.normalize,
      }),
  };
}

function normalizeSearchArgs(params: Record<string, unknown>): Record<string, unknown> {
  const query = readStringParam(params, "query", { required: true });
  const maxResults = readNumberParam(params, "maxResults", { integer: true });
  return {
    query,
    ...(maxResults !== undefined ? { max_results: maxResults } : {}),
  };
}

function normalizeDuplicateArgs(params: Record<string, unknown>): Record<string, unknown> {
  const content = readStringParam(params, "content", { required: true });
  const threshold = readNumberParam(params, "threshold");
  return {
    content,
    ...(threshold !== undefined ? { threshold } : {}),
  };
}

function normalizeAddDrawerArgs(params: Record<string, unknown>): Record<string, unknown> {
  const wing = readStringParam(params, "wing", { required: true });
  const room = readStringParam(params, "room", { required: true });
  const content = readStringParam(params, "content", { required: true });
  const sourceFile = readOptionalString(params, "sourceFile");
  const addedBy = readOptionalString(params, "addedBy");
  return {
    wing,
    room,
    content,
    ...(sourceFile ? { source_file: sourceFile } : {}),
    ...(addedBy ? { added_by: addedBy } : {}),
  };
}

function normalizeKgQueryArgs(params: Record<string, unknown>): Record<string, unknown> {
  const query = readStringParam(params, "query", { required: true });
  const maxResults = readNumberParam(params, "maxResults", { integer: true });
  return {
    query,
    ...(maxResults !== undefined ? { max_results: maxResults } : {}),
  };
}

function normalizeKgMutationArgs(params: Record<string, unknown>): Record<string, unknown> {
  const subject = readStringParam(params, "subject", { required: true });
  const predicate = readStringParam(params, "predicate", { required: true });
  const object = readStringParam(params, "object", { required: true });
  const validFrom = readOptionalString(params, "validFrom");
  const validTo = readOptionalString(params, "validTo");
  const sourceFile = readOptionalString(params, "sourceFile");
  return {
    subject,
    predicate,
    object,
    ...(validFrom ? { valid_from: validFrom } : {}),
    ...(validTo ? { valid_to: validTo } : {}),
    ...(sourceFile ? { source_file: sourceFile } : {}),
  };
}

function normalizeDiaryWriteArgs(params: Record<string, unknown>): Record<string, unknown> {
  const content =
    readOptionalString(params, "content") ?? readStringParam(params, "entry", { required: true });
  const topic = readOptionalString(params, "topic");
  const sourceFile = readOptionalString(params, "sourceFile");
  return {
    content,
    ...(topic ? { topic } : {}),
    ...(sourceFile ? { source_file: sourceFile } : {}),
  };
}

function resolveWritablePalacePath(
  resolved: ReturnType<typeof resolveMempalacePluginConfig>,
  scope: "private" | "shared",
): string {
  if (scope === "private") {
    return resolved.privatePalacePath;
  }
  if (!resolved.writeShared || !resolved.sharedPalacePath) {
    throw new Error("Shared MemPalace writes are not enabled for this agent.");
  }
  return resolved.sharedPalacePath;
}

function resolveWritableKnowledgeGraphPath(
  resolved: ReturnType<typeof resolveMempalacePluginConfig>,
  scope: "private" | "shared",
): string {
  if (scope === "private") {
    return resolved.privateKnowledgeGraphPath;
  }
  if (!resolved.writeShared || !resolved.sharedKnowledgeGraphPath) {
    throw new Error("Shared MemPalace knowledge-graph writes are not enabled for this agent.");
  }
  return resolved.sharedKnowledgeGraphPath;
}

function readImportPayload(params: {
  args: Record<string, unknown>;
  workspaceDir: string;
}): Promise<Record<string, unknown>> {
  const inlinePayload =
    readOptionalRecord(params.args, "data") ?? readOptionalRecord(params.args, "payload");
  const inputPath = readOptionalString(params.args, "inputPath");
  if (inlinePayload) {
    return Promise.resolve(inlinePayload);
  }
  if (!inputPath) {
    return Promise.resolve({});
  }
  const resolvedPath = resolveFilesystemPath(params.workspaceDir, inputPath);
  return fs
    .readFile(resolvedPath, "utf8")
    .then((content) => JSON.parse(content) as Record<string, unknown>);
}

function normalizeImportDrawerRecords(
  payload: Record<string, unknown>,
): MemoryImportDrawerRecord[] {
  const raw = payload.drawers;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => asRecord(entry))
    .filter((entry): entry is MemoryImportDrawerRecord => Boolean(entry));
}

function normalizeImportTripleRecords(
  payload: Record<string, unknown>,
): MemoryImportTripleRecord[] {
  const raw = payload.triples;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => asRecord(entry))
    .filter((entry): entry is MemoryImportTripleRecord => Boolean(entry));
}

export function createMemorySearchTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  if (!isPluginEnabled(options.config)) {
    return null;
  }
  return {
    label: "MemPalace Search",
    name: "memory_search",
    description:
      "MemPalace-backed recall over drawers and knowledge graph facts. Use for continuity questions, prior decisions, preferences, and timelines.",
    parameters: MemorySearchSchema,
    execute: async (_toolCallId, params) => {
      const cfg = options.config;
      if (!cfg) {
        return jsonResult(unavailableResult({ results: [] }));
      }
      const query = readStringParam(params, "query", { required: true });
      const maxResults = readNumberParam(params, "maxResults");
      const minScore = readNumberParam(params, "minScore");
      const agentId = resolveSessionAgentId({
        sessionKey: options.agentSessionKey,
        config: cfg,
      });
      const { manager, error } = await getMempalaceMemorySearchManager({
        cfg,
        agentId,
      });
      if (!manager) {
        return jsonResult(
          unavailableResult({
            results: [],
            query,
            maxResults,
            minScore,
            error: error ?? "MemPalace manager unavailable.",
          }),
        );
      }
      try {
        const results = await manager.search(query, {
          maxResults: maxResults ?? undefined,
          minScore: minScore ?? undefined,
          sessionKey: options.agentSessionKey,
        });
        queueRecallEvent({
          cfg,
          agentId,
          query,
          results,
        });
        return jsonResult({
          results,
          provider: "mempalace",
          model: "mcp",
          mode: "mcp+kg",
          citations: "off",
        });
      } catch (cause) {
        return jsonResult(
          unavailableResult({
            results: [],
            query,
            maxResults,
            minScore,
            error: cause instanceof Error ? cause.message : String(cause),
          }),
        );
      }
    },
  };
}

export function createMemoryGetTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  if (!isPluginEnabled(options.config)) {
    return null;
  }
  return {
    label: "MemPalace Get",
    name: "memory_get",
    description:
      "Read the exact stored text for a MemPalace search result path. Works with stable synthetic paths returned by memory_search.",
    parameters: MemoryGetSchema,
    execute: async (_toolCallId, params) => {
      const cfg = options.config;
      if (!cfg) {
        return jsonResult(unavailableResult({ text: "" }));
      }
      const path = readStringParam(params, "path", { required: true });
      const from = readNumberParam(params, "from", { integer: true });
      const lines = readNumberParam(params, "lines", { integer: true });
      const agentId = resolveSessionAgentId({
        sessionKey: options.agentSessionKey,
        config: cfg,
      });
      const { manager, error } = await getMempalaceMemorySearchManager({
        cfg,
        agentId,
      });
      if (!manager) {
        return jsonResult(
          unavailableResult({
            path,
            from,
            lines,
            text: "",
            error: error ?? "MemPalace manager unavailable.",
          }),
        );
      }
      try {
        const result = await manager.readFile({
          relPath: path,
          from: from ?? undefined,
          lines: lines ?? undefined,
        });
        return jsonResult(result);
      } catch (cause) {
        return jsonResult(
          unavailableResult({
            path,
            from,
            lines,
            text: "",
            error: cause instanceof Error ? cause.message : String(cause),
          }),
        );
      }
    },
  };
}

export function createMemoryWriteTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  if (!isPluginEnabled(options.config)) {
    return null;
  }
  return {
    label: "MemPalace Write",
    name: "memory_write",
    description:
      "Write a durable memory entry into the current agent's MemPalace drawer store using the shared memory_* interface.",
    parameters: MemoryWriteSchema,
    execute: async (_toolCallId, params) => {
      const cfg = options.config;
      if (!cfg) {
        return jsonResult(unavailableResult({ success: false }));
      }
      const content = readStringParam(params, "content", { required: true });
      const agentId = resolveSessionAgentId({
        sessionKey: options.agentSessionKey,
        config: cfg,
      });
      const resolved = resolveMempalacePluginConfig(cfg, agentId);
      if (!resolved.enabled || !resolved.server) {
        return jsonResult(
          unavailableResult({
            success: false,
            error: "MemPalace MCP runtime unavailable.",
          }),
        );
      }
      const metadata = extractMemoryWriteMetadata(params);
      const wing = normalizeSafeName(
        metadata.category ?? resolved.defaultWing ?? "OpenClaw Notes",
        "OpenClaw Notes",
      );
      const room = normalizeSafeName(
        metadata.room ?? resolved.defaultRoom ?? humanizeAgentName(agentId),
        humanizeAgentName(agentId),
      );
      const storedContent = buildStoredMemoryContent(content, metadata);
      const sourceFile = metadata.source ?? "memory-write://manual";
      try {
        // In compat (single-palace) mode the daemon's fixed PALACE_PATH matches
        // privatePalacePath, so MCP write reaches the correct location.
        // In non-compat (per-agent isolation) mode the daemon always writes to
        // its own startup palace path regardless of MEMPALACE_PALACE_PATH in the
        // subprocess env, so we bypass it and write directly via Python.
        const result = resolved.compatSinglePalaceMode
          ? ((await callMempalaceTool({
              cfg,
              agentId,
              toolName: "mempalace_add_drawer",
              palacePath: resolved.privatePalacePath,
              arguments: {
                wing,
                room,
                content: storedContent,
                source_file: sourceFile,
                added_by: "openclaw-memory_write",
              },
            })) as { success?: boolean; drawer_id?: string; error?: string })
          : await writeDrawerDirect({
              cfg,
              agentId,
              palacePath: resolved.privatePalacePath,
              wing,
              room,
              content: storedContent,
              sourceFile,
            });
        if (result.success !== true) {
          return jsonResult({
            success: false,
            error: result.error ?? "MemPalace write failed.",
          });
        }
        const drawerId = typeof result.drawer_id === "string" ? result.drawer_id : undefined;
        let canonicalRecord: Awaited<ReturnType<typeof readDrawerById>> | null = null;
        let verificationFailed = false;
        if (drawerId) {
          try {
            canonicalRecord = await readDrawerById({
              cfg,
              agentId,
              palacePath: resolved.privatePalacePath,
              drawerId,
            });
          } catch {
            verificationFailed = true;
          }
        }
        const canonicalText = canonicalRecord?.text ?? storedContent;
        const canonicalWing = canonicalRecord?.wing ?? wing;
        const canonicalRoom = canonicalRecord?.room ?? room;
        const canonicalSourceFile = canonicalRecord?.source_file ?? sourceFile;
        return jsonResult({
          success: true,
          verified: !verificationFailed,
          provider: "mempalace",
          path: buildSyntheticPath({
            scope: "private",
            kind: "drawer",
            wing: canonicalWing,
            room: canonicalRoom,
            text: canonicalText,
          }),
          drawerId,
          wing: canonicalWing,
          room: canonicalRoom,
          source: canonicalSourceFile,
          metadata,
        });
      } catch (cause) {
        return jsonResult({
          success: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
  };
}

export function createMemoryKgQueryTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  if (!isPluginEnabled(options.config)) {
    return null;
  }
  return {
    label: "MemPalace KG Query",
    name: "memory_kg_query",
    description:
      "Query the current agent MemPalace knowledge graph through a stable shared memory_* interface.",
    parameters: MemoryKgQuerySchema,
    execute: async (_toolCallId, params) => {
      const cfg = options.config;
      if (!cfg) {
        return jsonResult(unavailableResult({ triples: [], entities: [], relations: [] }));
      }
      const agentId = resolveSessionAgentId({
        sessionKey: options.agentSessionKey,
        config: cfg,
      });
      const resolved = resolveMempalacePluginConfig(cfg, agentId);
      const query = readOptionalString(params, "query");
      const entity = readOptionalString(params, "entity");
      const relation = readOptionalString(params, "relation");
      const object = readOptionalString(params, "object");
      const scope = readOptionalString(params, "scope") ?? "all";
      const limit = Math.max(1, Math.floor(readNumberParam(params, "limit") ?? 10));

      const privateRows =
        scope === "shared"
          ? []
          : queryKnowledgeGraphRows({
              dbPath: resolved.privateKnowledgeGraphPath,
              query,
              entity,
              relation,
              object,
              limit,
            });
      const sharedRows =
        scope === "private" || !resolved.readShared || !resolved.sharedKnowledgeGraphPath
          ? []
          : queryKnowledgeGraphRows({
              dbPath: resolved.sharedKnowledgeGraphPath,
              query,
              entity,
              relation,
              object,
              limit,
            });

      const triples = dedupeKnowledgeGraphRows([...privateRows, ...sharedRows]).slice(0, limit);
      const entities = [...new Set(triples.flatMap((row) => [row.subject, row.object]))].toSorted();
      const relations = [...new Set(triples.map((row) => row.predicate))].toSorted();

      return jsonResult({
        provider: "mempalace",
        scope,
        query,
        entity,
        relation,
        object,
        total: triples.length,
        triples: triples.map((row) => ({
          subject: row.subject,
          predicate: row.predicate,
          object: row.object,
          validFrom: row.valid_from ?? undefined,
          validTo: row.valid_to ?? undefined,
          sourceFile: row.source_file ?? undefined,
          current: row.valid_to == null,
        })),
        facts: triples.map((row) => ({
          subject: row.subject,
          predicate: row.predicate,
          object: row.object,
          validFrom: row.valid_from ?? undefined,
          validTo: row.valid_to ?? undefined,
          sourceFile: row.source_file ?? undefined,
          current: row.valid_to == null,
        })),
        entities,
        relations,
      });
    },
  };
}

export function createMemoryStatsTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  if (!isPluginEnabled(options.config)) {
    return null;
  }
  return {
    label: "MemPalace Stats",
    name: "memory_stats",
    description:
      "Return lightweight MemPalace health and storage statistics through a shared memory_* interface.",
    parameters: RawMempalaceSchema,
    execute: async () => {
      const cfg = options.config;
      if (!cfg) {
        return jsonResult(unavailableResult({ totalMemories: 0 }));
      }
      const agentId = resolveSessionAgentId({
        sessionKey: options.agentSessionKey,
        config: cfg,
      });
      const resolved = resolveMempalacePluginConfig(cfg, agentId);
      if (!resolved.enabled || !resolved.server) {
        return jsonResult(
          unavailableResult({
            totalMemories: 0,
            error: "MemPalace MCP runtime unavailable.",
          }),
        );
      }

      const statusErrors: string[] = [];
      const privateStatus = (await callMempalaceTool({
        cfg,
        agentId,
        toolName: "mempalace_status",
        palacePath: resolved.privatePalacePath,
        arguments: {},
      }).catch((cause) => {
        statusErrors.push(cause instanceof Error ? cause.message : String(cause));
        return null;
      })) as {
        total_drawers?: number;
        wings?: Record<string, number>;
        rooms?: Record<string, number>;
      } | null;

      const sharedStatus =
        resolved.readShared &&
        resolved.sharedPalacePath &&
        resolved.sharedPalacePath !== resolved.privatePalacePath
          ? ((await callMempalaceTool({
              cfg,
              agentId,
              toolName: "mempalace_status",
              palacePath: resolved.sharedPalacePath,
              arguments: {},
            }).catch((cause) => {
              statusErrors.push(cause instanceof Error ? cause.message : String(cause));
              return null;
            })) as {
              total_drawers?: number;
              wings?: Record<string, number>;
              rooms?: Record<string, number>;
            } | null)
          : null;

      const privateDrawers =
        typeof privateStatus?.total_drawers === "number" ? privateStatus.total_drawers : 0;
      const sharedDrawers =
        typeof sharedStatus?.total_drawers === "number" ? sharedStatus.total_drawers : 0;
      const privateKgFacts = countKnowledgeGraphFacts(resolved.privateKnowledgeGraphPath);
      const sharedKgFacts =
        resolved.sharedKnowledgeGraphPath &&
        resolved.sharedKnowledgeGraphPath !== resolved.privateKnowledgeGraphPath
          ? countKnowledgeGraphFacts(resolved.sharedKnowledgeGraphPath)
          : 0;
      const storage = readFileStats([
        resolved.privateKnowledgeGraphPath,
        resolved.sharedKnowledgeGraphPath,
      ]);

      return jsonResult({
        provider: "mempalace",
        health: statusErrors.length === 0 ? "ok" : "degraded",
        totalMemories: privateDrawers + sharedDrawers + privateKgFacts + sharedKgFacts,
        totalDrawers: privateDrawers + sharedDrawers,
        kgFacts: privateKgFacts + sharedKgFacts,
        categories: mergeCountMaps(privateStatus?.wings, sharedStatus?.wings),
        rooms: mergeCountMaps(privateStatus?.rooms, sharedStatus?.rooms),
        storageBytes: storage.bytes,
        storageSize: formatBytes(storage.bytes),
        lastUpdated: storage.lastUpdated,
        private: {
          drawers: privateDrawers,
          kgFacts: privateKgFacts,
          palacePath: resolved.privatePalacePath,
          knowledgeGraphPath: resolved.privateKnowledgeGraphPath,
        },
        shared:
          resolved.readShared && resolved.sharedPalacePath
            ? {
                drawers: sharedDrawers,
                kgFacts: sharedKgFacts,
                palacePath: resolved.sharedPalacePath,
                knowledgeGraphPath: resolved.sharedKnowledgeGraphPath,
              }
            : undefined,
        errors: statusErrors,
      });
    },
  };
}

export function createMemoryUpdateTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  if (!isPluginEnabled(options.config)) {
    return null;
  }
  return {
    label: "MemPalace Update",
    name: "memory_update",
    description:
      "Update a durable memory entry by synthetic path. Drawer entries are updated in place; KG facts preserve history by invalidating the old fact before writing the replacement.",
    parameters: MemoryUpdateSchema,
    execute: async (_toolCallId, params) => {
      const cfg = options.config;
      if (!cfg) {
        return jsonResult(unavailableResult({ success: false }));
      }
      const relPath = readStringParam(params, "path", { required: true });
      const parsed = parseSyntheticPath(relPath);
      if (!parsed) {
        return jsonResult({
          success: false,
          error:
            "Unsupported MemPalace path. Run memory_search first and update one of the returned synthetic paths.",
        });
      }
      const agentId = resolveSessionAgentId({
        sessionKey: options.agentSessionKey,
        config: cfg,
      });
      const resolved = resolveMempalacePluginConfig(cfg, agentId);

      if (parsed.kind === "drawer") {
        try {
          const palacePath = resolveWritablePalacePath(resolved, parsed.scope);
          const existing = await findDrawerBySyntheticPath({
            cfg,
            agentId,
            palacePath,
            wing: parsed.wing,
            room: parsed.room,
            digest: parsed.digest,
          });
          if (!existing) {
            return jsonResult({
              success: false,
              error: `MemPalace drawer not found for ${relPath}.`,
            });
          }
          const parsedContent = parseManagedFrontmatter(existing.text);
          const metadata = {
            ...parsedContent.metadata,
            ...extractMemoryWriteMetadata(params),
          };
          const nextBody = readOptionalString(params, "content") ?? parsedContent.body;
          const metadataChanged = Object.keys(extractMemoryWriteMetadata(params)).length > 0;
          if (readOptionalString(params, "content") === undefined && !metadataChanged) {
            return jsonResult({
              success: false,
              error: "memory_update requires content and/or metadata changes for drawer entries.",
            });
          }
          const nextWing = normalizeSafeName(metadata.category ?? existing.wing, existing.wing);
          const nextRoom = normalizeSafeName(metadata.room ?? existing.room, existing.room);
          const nextSourceFile = metadata.source ?? existing.source_file;
          const nextText = buildStoredMemoryContent(nextBody, metadata);
          const updated = await updateDrawerBySyntheticPath({
            cfg,
            agentId,
            palacePath,
            wing: parsed.wing,
            room: parsed.room,
            digest: parsed.digest,
            nextWing,
            nextRoom,
            content: nextText,
            sourceFile: nextSourceFile,
          });
          if (!updated) {
            return jsonResult({
              success: false,
              error: `MemPalace drawer update failed for ${relPath}.`,
            });
          }
          return jsonResult({
            success: true,
            kind: "drawer",
            oldPath: relPath,
            path: buildSyntheticPath({
              scope: parsed.scope,
              kind: "drawer",
              wing: updated.wing,
              room: updated.room,
              text: updated.text,
            }),
            drawerId: updated.drawer_id,
            metadata,
            sourceFile: updated.source_file,
          });
        } catch (cause) {
          return jsonResult({
            success: false,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }

      try {
        const dbPath = resolveWritableKnowledgeGraphPath(resolved, parsed.scope);
        const current = readKnowledgeGraphFact({
          dbPath,
          subject: parsed.subject,
          predicate: parsed.predicate,
          object: parsed.object,
          validFrom: parsed.validFrom,
          validTo: parsed.validTo,
          digest: parsed.digest,
        });
        if (!current) {
          return jsonResult({
            success: false,
            error: `MemPalace knowledge graph fact not found for ${relPath}.`,
          });
        }
        const nextSubject = readOptionalString(params, "subject") ?? parsed.subject;
        const nextPredicate = readOptionalString(params, "predicate") ?? parsed.predicate;
        const nextObject = readOptionalString(params, "object") ?? parsed.object;
        const nextValidFrom = readOptionalString(params, "validFrom") ?? parsed.validFrom;
        const nextValidTo = readOptionalString(params, "validTo") ?? parsed.validTo;
        const nextSourceFile =
          readOptionalString(params, "source") ?? current.source_file ?? undefined;
        const changed =
          nextSubject !== parsed.subject ||
          nextPredicate !== parsed.predicate ||
          nextObject !== parsed.object ||
          nextValidFrom !== parsed.validFrom ||
          nextValidTo !== parsed.validTo ||
          nextSourceFile !== current.source_file;
        if (!changed) {
          return jsonResult({
            success: false,
            error: "memory_update requires at least one changed field for KG facts.",
          });
        }
        if (parsed.validTo == null) {
          await callMempalaceTool({
            cfg,
            agentId,
            toolName: "mempalace_kg_invalidate",
            palacePath: path.dirname(dbPath),
            arguments: {
              subject: parsed.subject,
              predicate: parsed.predicate,
              object: parsed.object,
              ...(parsed.validFrom ? { valid_from: parsed.validFrom } : {}),
            },
          });
        } else {
          deleteKnowledgeGraphRow({
            dbPath,
            parsed,
          });
        }
        const inserted = insertKnowledgeGraphRow({
          dbPath,
          scope: parsed.scope,
          row: {
            subject: nextSubject,
            predicate: nextPredicate,
            object: nextObject,
            validFrom: nextValidFrom ?? null,
            validTo: nextValidTo ?? null,
            sourceFile: nextSourceFile ?? null,
          },
        });
        return jsonResult({
          success: inserted.inserted,
          kind: "kg",
          oldPath: relPath,
          path: inserted.path,
        });
      } catch (cause) {
        return jsonResult({
          success: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
  };
}

export function createMemoryDeleteTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  if (!isPluginEnabled(options.config)) {
    return null;
  }
  return {
    label: "MemPalace Delete",
    name: "memory_delete",
    description:
      "Delete a durable memory entry by synthetic path. Drawer deletions are hard deletes; KG deletions default to soft invalidation unless hard=true.",
    parameters: MemoryDeleteSchema,
    execute: async (_toolCallId, params) => {
      const cfg = options.config;
      if (!cfg) {
        return jsonResult(unavailableResult({ success: false }));
      }
      const relPath = readStringParam(params, "path", { required: true });
      const parsed = parseSyntheticPath(relPath);
      if (!parsed) {
        return jsonResult({
          success: false,
          error:
            "Unsupported MemPalace path. Run memory_search first and delete one of the returned synthetic paths.",
        });
      }
      const hard = readBooleanParam(params, "hard") === true;
      const agentId = resolveSessionAgentId({
        sessionKey: options.agentSessionKey,
        config: cfg,
      });
      const resolved = resolveMempalacePluginConfig(cfg, agentId);

      if (parsed.kind === "drawer") {
        try {
          const palacePath = resolveWritablePalacePath(resolved, parsed.scope);
          const deleted = await deleteDrawerBySyntheticPath({
            cfg,
            agentId,
            palacePath,
            wing: parsed.wing,
            room: parsed.room,
            digest: parsed.digest,
          });
          return jsonResult({
            success: Boolean(deleted?.deleted),
            kind: "drawer",
            mode: "hard",
            path: relPath,
            drawerId: deleted?.drawer_id,
          });
        } catch (cause) {
          return jsonResult({
            success: false,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }

      try {
        const dbPath = resolveWritableKnowledgeGraphPath(resolved, parsed.scope);
        if (!hard && parsed.validTo == null) {
          await callMempalaceTool({
            cfg,
            agentId,
            toolName: "mempalace_kg_invalidate",
            palacePath: path.dirname(dbPath),
            arguments: {
              subject: parsed.subject,
              predicate: parsed.predicate,
              object: parsed.object,
              ...(parsed.validFrom ? { valid_from: parsed.validFrom } : {}),
            },
          });
          return jsonResult({
            success: true,
            kind: "kg",
            mode: "soft",
            path: relPath,
          });
        }
        const deleted = deleteKnowledgeGraphRow({ dbPath, parsed });
        return jsonResult({
          success: deleted,
          kind: "kg",
          mode: "hard",
          path: relPath,
        });
      } catch (cause) {
        return jsonResult({
          success: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
  };
}

export function createMemoryExportTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  if (!isPluginEnabled(options.config)) {
    return null;
  }
  return {
    label: "MemPalace Export",
    name: "memory_export",
    description:
      "Export drawer entries and KG facts from MemPalace as JSON, optionally writing the export to a file.",
    parameters: MemoryExportSchema,
    execute: async (_toolCallId, params) => {
      const cfg = options.config;
      if (!cfg) {
        return jsonResult(unavailableResult({ success: false }));
      }
      const agentId = resolveSessionAgentId({
        sessionKey: options.agentSessionKey,
        config: cfg,
      });
      const resolved = resolveMempalacePluginConfig(cfg, agentId);
      const scope = readScopeParam(readOptionalString(params, "scope"), "private");
      const maxDrawers = Math.max(1, Math.floor(readNumberParam(params, "maxDrawers") ?? 200));
      const maxTriples = Math.max(1, Math.floor(readNumberParam(params, "maxTriples") ?? 200));
      const includeContent = readBooleanParam(params, "includeContent") ?? true;
      const scopes =
        scope === "all"
          ? ([
              "private",
              ...(resolved.readShared && resolved.sharedPalacePath ? ["shared"] : []),
            ] as Array<"private" | "shared">)
          : ([scope] as Array<"private" | "shared">);

      try {
        const drawers = [];
        const triples = [];
        for (const currentScope of scopes) {
          const palacePath =
            currentScope === "private" ? resolved.privatePalacePath : resolved.sharedPalacePath;
          const kgPath =
            currentScope === "private"
              ? resolved.privateKnowledgeGraphPath
              : resolved.sharedKnowledgeGraphPath;
          if (palacePath) {
            const records = await listDrawerRecords({
              cfg,
              agentId,
              palacePath,
              limit: maxDrawers,
            });
            for (const record of records
              .toSorted((left, right) =>
                `${left.wing}|${left.room}|${left.source_file ?? ""}|${left.drawer_id}`.localeCompare(
                  `${right.wing}|${right.room}|${right.source_file ?? ""}|${right.drawer_id}`,
                ),
              )
              .slice(0, maxDrawers)) {
              drawers.push({
                scope: currentScope,
                path: buildSyntheticPath({
                  scope: currentScope,
                  kind: "drawer",
                  wing: record.wing,
                  room: record.room,
                  text: record.text,
                }),
                drawerId: record.drawer_id,
                wing: record.wing,
                room: record.room,
                sourceFile: record.source_file,
                ...(includeContent ? { content: record.text } : {}),
              });
            }
          }
          for (const row of listKnowledgeGraphRows({
            dbPath: kgPath,
            limit: maxTriples,
          }).slice(0, maxTriples)) {
            triples.push({
              scope: currentScope,
              path: buildSyntheticPath({
                scope: currentScope,
                kind: "kg",
                subject: row.subject,
                predicate: row.predicate,
                object: row.object,
                validFrom: row.valid_from,
                validTo: row.valid_to,
                text: buildKgFactText(row),
              }),
              subject: row.subject,
              predicate: row.predicate,
              object: row.object,
              validFrom: row.valid_from ?? undefined,
              validTo: row.valid_to ?? undefined,
              sourceFile: row.source_file ?? undefined,
              ...(includeContent ? { text: buildKgFactText(row) } : {}),
            });
          }
        }
        const data = {
          version: 1,
          provider: "mempalace",
          exportedAt: new Date().toISOString(),
          scope,
          drawers,
          triples,
        };
        const outputPath = readOptionalString(params, "outputPath");
        if (outputPath) {
          const workspaceDir = resolveToolWorkspaceDir(cfg, agentId);
          const resolvedOutputPath = resolveFilesystemPath(workspaceDir, outputPath);
          await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true });
          await fs.writeFile(resolvedOutputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
          return jsonResult({
            success: true,
            provider: "mempalace",
            outputPath: resolvedOutputPath,
            counts: {
              drawers: drawers.length,
              triples: triples.length,
            },
          });
        }
        return jsonResult({
          success: true,
          provider: "mempalace",
          counts: {
            drawers: drawers.length,
            triples: triples.length,
          },
          data,
        });
      } catch (cause) {
        return jsonResult({
          success: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
  };
}

export function createMemoryImportTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  if (!isPluginEnabled(options.config)) {
    return null;
  }
  return {
    label: "MemPalace Import",
    name: "memory_import",
    description:
      "Import drawer entries and KG facts into MemPalace from inline JSON payloads or an input file.",
    parameters: MemoryImportSchema,
    execute: async (_toolCallId, params) => {
      const cfg = options.config;
      if (!cfg) {
        return jsonResult(unavailableResult({ success: false }));
      }
      const agentId = resolveSessionAgentId({
        sessionKey: options.agentSessionKey,
        config: cfg,
      });
      const resolved = resolveMempalacePluginConfig(cfg, agentId);
      const workspaceDir = resolveToolWorkspaceDir(cfg, agentId);
      const targetScopeRaw = readScopeParam(readOptionalString(params, "targetScope"), "private");
      const targetScope = targetScopeRaw === "all" ? "private" : targetScopeRaw;
      const dedupe = readBooleanParam(params, "dedupe") ?? true;
      const overwrite = readBooleanParam(params, "overwrite") ?? false;

      try {
        const payload = await readImportPayload({
          args: params,
          workspaceDir,
        });
        const drawerRecords = normalizeImportDrawerRecords(payload);
        const tripleRecords = normalizeImportTripleRecords(payload);
        if (drawerRecords.length === 0 && tripleRecords.length === 0) {
          return jsonResult({
            success: false,
            error: "memory_import requires drawers and/or triples in the payload.",
          });
        }

        const palacePath = resolveWritablePalacePath(resolved, targetScope);
        const kgPath = resolveWritableKnowledgeGraphPath(resolved, targetScope);
        const existingDrawers = new Map<string, { drawerId: string }>();
        for (const record of await listDrawerRecords({
          cfg,
          agentId,
          palacePath,
          limit: 10_000,
        })) {
          existingDrawers.set(
            buildSyntheticPath({
              scope: targetScope,
              kind: "drawer",
              wing: record.wing,
              room: record.room,
              text: record.text,
            }),
            { drawerId: record.drawer_id },
          );
        }

        let importedDrawers = 0;
        let updatedDrawers = 0;
        let skippedDrawers = 0;
        for (const drawer of drawerRecords) {
          const text = typeof drawer.content === "string" ? drawer.content : drawer.text;
          if (typeof text !== "string" || !text.trim()) {
            skippedDrawers += 1;
            continue;
          }
          const wing = normalizeSafeName(drawer.wing ?? "Imported Memory", "Imported Memory");
          const room = normalizeSafeName(
            drawer.room ?? humanizeAgentName(agentId),
            humanizeAgentName(agentId),
          );
          const sourceFile = drawer.sourceFile ?? drawer.source_file ?? "memory-import://drawer";
          const nextPath = buildSyntheticPath({
            scope: targetScope,
            kind: "drawer",
            wing,
            room,
            text,
          });
          if (dedupe && existingDrawers.has(nextPath)) {
            skippedDrawers += 1;
            continue;
          }
          const sourcePath = typeof drawer.path === "string" ? drawer.path.trim() : "";
          if (overwrite && sourcePath) {
            const parsedSource = parseSyntheticPath(sourcePath);
            if (parsedSource?.kind === "drawer" && parsedSource.scope === targetScope) {
              const updated = await updateDrawerBySyntheticPath({
                cfg,
                agentId,
                palacePath,
                wing: parsedSource.wing,
                room: parsedSource.room,
                digest: parsedSource.digest,
                nextWing: wing,
                nextRoom: room,
                content: text,
                sourceFile,
              });
              if (updated) {
                updatedDrawers += 1;
                existingDrawers.set(nextPath, { drawerId: updated.drawer_id });
                continue;
              }
            }
          }
          const added = await forceInsertDrawer({
            cfg,
            agentId,
            palacePath,
            wing,
            room,
            content: text,
            sourceFile,
            addedBy: "openclaw-memory_import",
          });
          if (added.success) {
            importedDrawers += 1;
            if (typeof added.drawer_id === "string") {
              existingDrawers.set(nextPath, { drawerId: added.drawer_id });
            }
          } else {
            skippedDrawers += 1;
          }
        }

        let importedTriples = 0;
        let skippedTriples = 0;
        for (const triple of tripleRecords) {
          const inserted = insertKnowledgeGraphRow({
            dbPath: kgPath,
            scope: targetScope,
            row: triple,
          });
          if (inserted.inserted) {
            importedTriples += 1;
          } else {
            skippedTriples += 1;
          }
        }

        return jsonResult({
          success: true,
          provider: "mempalace",
          targetScope,
          counts: {
            importedDrawers,
            updatedDrawers,
            skippedDrawers,
            importedTriples,
            skippedTriples,
          },
        });
      } catch (cause) {
        return jsonResult({
          success: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
  };
}

export function createMempalaceStatusTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return createNativeMempalaceTool(options, {
    label: "MemPalace Status",
    name: "mempalace_status",
    description: "Inspect the raw MemPalace runtime status for the current agent palace.",
    parameters: RawMempalaceSchema,
  });
}

export function createMempalaceSearchTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return createNativeMempalaceTool(options, {
    label: "MemPalace Raw Search",
    name: "mempalace_search",
    description:
      "Query the raw MemPalace drawer search tool for the current private palace without OpenClaw result decoration.",
    parameters: MempalaceSearchSchema,
    normalize: normalizeSearchArgs,
  });
}

export function createMempalaceCheckDuplicateTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return createNativeMempalaceTool(options, {
    label: "MemPalace Check Duplicate",
    name: "mempalace_check_duplicate",
    description: "Check whether a proposed durable note duplicates an existing MemPalace drawer.",
    parameters: MempalaceCheckDuplicateSchema,
    normalize: normalizeDuplicateArgs,
  });
}

export function createMempalaceAddDrawerTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return createNativeMempalaceTool(options, {
    label: "MemPalace Add Drawer",
    name: "mempalace_add_drawer",
    description: "Persist a durable verbatim note into the current agent's MemPalace drawer store.",
    parameters: MempalaceAddDrawerSchema,
    normalize: normalizeAddDrawerArgs,
  });
}

export function createMempalaceKgQueryTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return createNativeMempalaceTool(options, {
    label: "MemPalace KG Query",
    name: "mempalace_kg_query",
    description: "Query the current agent MemPalace knowledge graph directly.",
    parameters: MempalaceKgQuerySchema,
    normalize: normalizeKgQueryArgs,
  });
}

export function createMempalaceKgAddTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return createNativeMempalaceTool(options, {
    label: "MemPalace KG Add",
    name: "mempalace_kg_add",
    description:
      "Add a durable fact or relationship to the current agent MemPalace knowledge graph.",
    parameters: MempalaceKgMutationSchema,
    normalize: normalizeKgMutationArgs,
  });
}

export function createMempalaceKgInvalidateTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return createNativeMempalaceTool(options, {
    label: "MemPalace KG Invalidate",
    name: "mempalace_kg_invalidate",
    description:
      "Close or invalidate an existing MemPalace knowledge graph fact for the current agent.",
    parameters: MempalaceKgMutationSchema,
    normalize: normalizeKgMutationArgs,
  });
}

export function createMempalaceKgTimelineTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return createNativeMempalaceTool(options, {
    label: "MemPalace KG Timeline",
    name: "mempalace_kg_timeline",
    description: "Inspect the timeline history for MemPalace knowledge graph entities or facts.",
    parameters: RawMempalaceSchema,
  });
}

export function createMempalaceDiaryReadTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return createNativeMempalaceTool(options, {
    label: "MemPalace Diary Read",
    name: "mempalace_diary_read",
    description: "Read a MemPalace diary entry for the current agent.",
    parameters: MempalaceDiaryReadSchema,
  });
}

export function createMempalaceDiaryWriteTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  return createNativeMempalaceTool(options, {
    label: "MemPalace Diary Write",
    name: "mempalace_diary_write",
    description: "Write a concise continuity diary entry into the current agent MemPalace store.",
    parameters: MempalaceDiaryWriteSchema,
    normalize: normalizeDiaryWriteArgs,
  });
}
