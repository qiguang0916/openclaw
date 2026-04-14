import type { OpenClawConfig } from "openclaw/plugin-sdk/memory-core";
import {
  DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR,
  parseNonNegativeByteSize,
  resolveCronStyleNow,
  SILENT_REPLY_TOKEN,
  type MemoryFlushPlan,
} from "openclaw/plugin-sdk/memory-core-host-runtime-core";

export const DEFAULT_MEMPALACE_MEMORY_FLUSH_SOFT_TOKENS = 4000;
export const DEFAULT_MEMPALACE_MEMORY_FLUSH_FORCE_TRANSCRIPT_BYTES = 2 * 1024 * 1024;

const DEFAULT_ALLOWED_TOOL_NAMES = [
  "read",
  "memory_search",
  "memory_get",
  "mempalace_status",
  "mempalace_search",
  "mempalace_check_duplicate",
  "mempalace_add_drawer",
  "mempalace_kg_query",
  "mempalace_kg_add",
  "mempalace_diary_read",
  "mempalace_diary_write",
] as const;

const MEMPALACE_NO_FILE_WRITE_HINT =
  "Persist durable memory through MemPalace tools only; do not create or edit memory markdown files during this flush.";
const MEMPALACE_DUPLICATE_HINT =
  "Before filing a new verbatim note, check for duplicates with memory_search or mempalace_check_duplicate.";
const MEMPALACE_STORAGE_HINT =
  "Use mempalace_add_drawer for verbatim long-lived notes, mempalace_kg_add for stable facts/relationships, and mempalace_diary_write only for concise agent diary continuity when useful.";
const MEMPALACE_READ_ONLY_HINT =
  "Treat MEMORY.md, DREAMS.md, SOUL.md, TOOLS.md, AGENTS.md, and memory/*.md as read-only reference material during this flush.";
const MEMPALACE_REQUIRED_HINTS = [
  MEMPALACE_NO_FILE_WRITE_HINT,
  MEMPALACE_DUPLICATE_HINT,
  MEMPALACE_STORAGE_HINT,
  MEMPALACE_READ_ONLY_HINT,
];

export const DEFAULT_MEMPALACE_MEMORY_FLUSH_PROMPT = [
  "Pre-compaction memory flush.",
  "The session is near auto-compaction; capture only durable, future-useful memories.",
  MEMPALACE_NO_FILE_WRITE_HINT,
  MEMPALACE_DUPLICATE_HINT,
  MEMPALACE_STORAGE_HINT,
  MEMPALACE_READ_ONLY_HINT,
  `If nothing durable should be persisted, reply with ${SILENT_REPLY_TOKEN}.`,
].join(" ");

export const DEFAULT_MEMPALACE_MEMORY_FLUSH_SYSTEM_PROMPT = [
  "Pre-compaction memory flush turn.",
  "The active memory backend is MemPalace.",
  MEMPALACE_NO_FILE_WRITE_HINT,
  MEMPALACE_DUPLICATE_HINT,
  MEMPALACE_STORAGE_HINT,
  MEMPALACE_READ_ONLY_HINT,
  `You may reply, but usually ${SILENT_REPLY_TOKEN} is correct.`,
].join(" ");

function normalizeNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const int = Math.floor(value);
  return int >= 0 ? int : null;
}

function ensureNoReplyHint(text: string): string {
  if (text.includes(SILENT_REPLY_TOKEN)) {
    return text;
  }
  return `${text}\n\nIf no user-visible reply is needed, start with ${SILENT_REPLY_TOKEN}.`;
}

function ensureRequiredHints(text: string): string {
  let next = text.trim();
  for (const hint of MEMPALACE_REQUIRED_HINTS) {
    if (!next.includes(hint)) {
      next = next ? `${next}\n\n${hint}` : hint;
    }
  }
  return next;
}

function appendCurrentTimeLine(text: string, timeLine: string): string {
  const trimmed = text.trimEnd();
  if (!trimmed) {
    return timeLine;
  }
  if (trimmed.includes("Current time:")) {
    return trimmed;
  }
  return `${trimmed}\n${timeLine}`;
}

export function buildMempalaceMemoryFlushPlan(
  params: {
    cfg?: OpenClawConfig;
    nowMs?: number;
  } = {},
): MemoryFlushPlan | null {
  const nowMs = Number.isFinite(params.nowMs) ? (params.nowMs as number) : Date.now();
  const cfg = params.cfg;
  const defaults = cfg?.agents?.defaults?.compaction?.memoryFlush;
  if (defaults?.enabled === false) {
    return null;
  }

  const softThresholdTokens =
    normalizeNonNegativeInt(defaults?.softThresholdTokens) ??
    DEFAULT_MEMPALACE_MEMORY_FLUSH_SOFT_TOKENS;
  const forceFlushTranscriptBytes =
    parseNonNegativeByteSize(defaults?.forceFlushTranscriptBytes) ??
    DEFAULT_MEMPALACE_MEMORY_FLUSH_FORCE_TRANSCRIPT_BYTES;
  const reserveTokensFloor =
    normalizeNonNegativeInt(cfg?.agents?.defaults?.compaction?.reserveTokensFloor) ??
    DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR;
  const { timeLine } = resolveCronStyleNow(cfg ?? {}, nowMs);

  const promptBase = ensureNoReplyHint(
    ensureRequiredHints(defaults?.prompt?.trim() || DEFAULT_MEMPALACE_MEMORY_FLUSH_PROMPT),
  );
  const systemPrompt = ensureNoReplyHint(
    ensureRequiredHints(
      defaults?.systemPrompt?.trim() || DEFAULT_MEMPALACE_MEMORY_FLUSH_SYSTEM_PROMPT,
    ),
  );

  return {
    softThresholdTokens,
    forceFlushTranscriptBytes,
    reserveTokensFloor,
    prompt: appendCurrentTimeLine(promptBase, timeLine),
    systemPrompt,
    allowedToolNames: [...DEFAULT_ALLOWED_TOOL_NAMES],
  };
}
