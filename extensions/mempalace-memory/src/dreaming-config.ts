import type { OpenClawConfig } from "openclaw/plugin-sdk/memory-core";

const DEFAULT_DREAMING_CRON = "0 3 * * *";
const DEFAULT_DREAMING_LOOKBACK_DAYS = 7;
const DEFAULT_DREAMING_LIMIT = 6;
const DEFAULT_DREAMING_KG_THEMES = 3;

export type MempalaceDreamingAutoExtractPromotion = {
  enabled: boolean;
  /** Minimum number of times a summary must appear in auto-extract events to qualify for KG promotion. */
  minHits: number;
};

export type MempalaceDreamingConfig = {
  enabled: boolean;
  cron: string;
  timezone?: string;
  lookbackDays: number;
  limit: number;
  kgThemes: number;
  autoExtractPromotion: MempalaceDreamingAutoExtractPromotion;
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

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const next = Math.floor(value);
  return next >= 0 ? next : fallback;
}

function resolvePluginConfig(cfg?: OpenClawConfig): Record<string, unknown> {
  const entry = asRecord(cfg?.plugins?.entries?.["mempalace-memory"]);
  return asRecord(entry?.config) ?? {};
}

function resolveAutoExtractPromotion(raw: unknown): MempalaceDreamingAutoExtractPromotion {
  const record = asRecord(raw);
  return {
    enabled: record?.enabled !== false,
    minHits: normalizeNonNegativeInt(record?.minHits, 2),
  };
}

export function resolveMempalaceDreamingConfig(cfg?: OpenClawConfig): MempalaceDreamingConfig {
  const pluginConfig = resolvePluginConfig(cfg);
  const dreaming = asRecord(pluginConfig.dreaming);
  return {
    enabled: dreaming?.enabled !== false,
    cron: normalizeTrimmedString(dreaming?.cron) ?? DEFAULT_DREAMING_CRON,
    timezone: normalizeTrimmedString(dreaming?.timezone),
    lookbackDays: normalizeNonNegativeInt(dreaming?.lookbackDays, DEFAULT_DREAMING_LOOKBACK_DAYS),
    limit: normalizeNonNegativeInt(dreaming?.limit, DEFAULT_DREAMING_LIMIT),
    kgThemes: normalizeNonNegativeInt(dreaming?.kgThemes, DEFAULT_DREAMING_KG_THEMES),
    autoExtractPromotion: resolveAutoExtractPromotion(dreaming?.autoExtractPromotion),
  };
}

export const MEMPALACE_DREAMING_DEFAULTS = {
  DEFAULT_DREAMING_CRON,
  DEFAULT_DREAMING_LOOKBACK_DAYS,
  DEFAULT_DREAMING_LIMIT,
  DEFAULT_DREAMING_KG_THEMES,
} as const;
