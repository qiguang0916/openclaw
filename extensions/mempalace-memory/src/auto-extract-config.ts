import type { OpenClawConfig } from "openclaw/plugin-sdk/memory-core";

export type MempalaceAutoExtractMode = "off" | "conservative" | "balanced";

export type ResolvedMempalaceAutoExtractConfig = {
  enabled: boolean;
  mode: MempalaceAutoExtractMode;
  maxWritesPerTurn: number;
  maxSourceChars: number;
  maxCandidateChars: number;
  dedupeSimilarity: number;
  writeSharedUserMemory: boolean;
  writePrivateContinuity: boolean;
  /** Minimum turns between any auto-extract writes for the same session. 0 = no cooldown. */
  cooldownTurns: number;
  /** Minimum candidate priority to write. 0 = no minimum. */
  minConfidence: number;
  /** Allow writing high-confidence facts directly to the knowledge graph. */
  allowKgWrite: boolean;
  /** Minimum candidate priority required for KG write (only when allowKgWrite is true). */
  kgWriteMinConfidence: number;
  /**
   * Identity label used as KG subject and shared-palace room qualifier for extracted user facts.
   * Defaults to "User". Set per-deployment when the palace is shared across multiple user identities.
   */
  userIdentity: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readAutoExtractConfig(cfg?: OpenClawConfig): Record<string, unknown> {
  const entry = asRecord(cfg?.plugins?.entries?.["mempalace-memory"]);
  const pluginConfig = asRecord(entry?.config);
  return asRecord(pluginConfig?.autoExtract) ?? {};
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeIdentityString(value: unknown): string {
  if (typeof value !== "string") {
    return "User";
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "User";
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function resolveMode(raw: unknown): MempalaceAutoExtractMode {
  return raw === "off" || raw === "balanced" || raw === "conservative" ? raw : "conservative";
}

export function resolveMempalaceAutoExtractConfig(
  cfg?: OpenClawConfig,
): ResolvedMempalaceAutoExtractConfig {
  const raw = readAutoExtractConfig(cfg);
  const mode = resolveMode(raw.mode);
  const enabled = raw.enabled !== false && mode !== "off";

  return {
    enabled,
    mode,
    maxWritesPerTurn: clampInteger(raw.maxWritesPerTurn, 2, 1, 5),
    maxSourceChars: clampInteger(raw.maxSourceChars, 1_500, 200, 12_000),
    maxCandidateChars: clampInteger(raw.maxCandidateChars, 280, 40, 2_000),
    dedupeSimilarity: clampNumber(raw.dedupeSimilarity, 0.92, 0.5, 0.999),
    writeSharedUserMemory: raw.writeSharedUserMemory !== false,
    writePrivateContinuity: raw.writePrivateContinuity !== false,
    cooldownTurns: clampInteger(raw.cooldownTurns, 0, 0, 20),
    minConfidence: clampInteger(raw.minConfidence, 0, 0, 100),
    allowKgWrite: raw.allowKgWrite === true,
    kgWriteMinConfidence: clampInteger(raw.kgWriteMinConfidence, 95, 50, 100),
    userIdentity: normalizeIdentityString(raw.userIdentity),
  };
}
