import { existsSync } from "node:fs";
import type { OpenClawConfig } from "openclaw/plugin-sdk/memory-core";
import type {
  MemoryEmbeddingProbeResult,
  MemoryProviderStatus,
  MemorySearchManager,
  MemorySearchResult,
  MemorySyncProgressUpdate,
} from "openclaw/plugin-sdk/memory-core-host-runtime-files";
import {
  buildSyntheticPath,
  getMempalaceStatus,
  parseSyntheticPath,
  readDrawerBySyntheticPath,
  readKnowledgeGraphFact,
  searchDrawerMemories,
  searchKnowledgeGraph,
} from "./bridge.js";
import { resolveMempalacePluginConfig } from "./config.js";
import { buildSearchQueryVariants } from "./search-aliases.js";

type CachedEntry = {
  text: string;
  path: string;
};

type SearchHit =
  | {
      kind: "drawer";
      path: string;
      text: string;
      score: number;
      source: "memory";
    }
  | {
      kind: "kg";
      path: string;
      text: string;
      score: number;
      source: "memory";
    };

type StatusSnapshot = {
  privateDrawers: number;
  sharedDrawers: number;
  tools: string[];
  privateError?: string;
  sharedError?: string;
};

const MANAGER_CACHE_MAX_SIZE = 50;
const MANAGER_CACHE = new Map<string, MempalaceMemoryManager>();

function trimSnippet(text: string, maxChars = 700): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars - 1)}…`;
}

function applyLineSlice(text: string, from?: number, lines?: number): string {
  if (!from && !lines) {
    return text;
  }
  const fileLines = text.split("\n");
  const start = Math.max(1, from ?? 1);
  const count = Math.max(1, lines ?? fileLines.length);
  return fileLines.slice(start - 1, start - 1 + count).join("\n");
}

function scoreHit(hit: SearchHit, minScore: number): boolean {
  return Number.isFinite(hit.score) && hit.score >= minScore;
}

function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const bestByPath = new Map<string, SearchHit>();
  for (const hit of hits) {
    const existing = bestByPath.get(hit.path);
    if (!existing || hit.score > existing.score) {
      bestByPath.set(hit.path, hit);
    }
  }
  return [...bestByPath.values()];
}

function defaultMinScore(): number {
  return 0.15;
}

async function resolveDrawerHits(params: {
  cfg: OpenClawConfig;
  agentId: string;
  query: string;
  maxResults: number;
  scope: "private" | "shared";
  palacePath?: string;
}): Promise<SearchHit[]> {
  if (!params.palacePath) {
    return [];
  }
  const palacePath = params.palacePath;
  const variants = buildSearchQueryVariants(params.query);
  const batches = await Promise.all(
    variants.map(
      async (query) =>
        await searchDrawerMemories({
          cfg: params.cfg,
          agentId: params.agentId,
          palacePath,
          query,
          maxResults: Math.max(1, params.maxResults * 2),
        }),
    ),
  );
  return batches.flatMap((raw) =>
    raw.map((result) => {
      const text = result.text ?? "";
      return {
        kind: "drawer",
        path: buildSyntheticPath({
          scope: params.scope,
          kind: "drawer",
          wing: result.wing,
          room: result.room,
          text,
        }),
        text,
        score: typeof result.similarity === "number" ? result.similarity : 0,
        source: "memory",
      } satisfies SearchHit;
    }),
  );
}

function resolveKgHits(params: {
  query: string;
  maxResults: number;
  scope: "private" | "shared";
  dbPath?: string;
}): SearchHit[] {
  if (!params.dbPath || !existsSync(params.dbPath)) {
    return [];
  }
  const results = searchKnowledgeGraph({
    dbPath: params.dbPath,
    query: params.query,
    maxResults: Math.max(1, params.maxResults),
  });
  return results.map((result) => ({
    kind: "kg",
    path: buildSyntheticPath({
      scope: params.scope,
      kind: "kg",
      subject: result.subject,
      predicate: result.predicate,
      object: result.object,
      validFrom: result.valid_from,
      validTo: result.valid_to,
      text: result.text,
    }),
    text: result.text,
    score: result.score,
    source: "memory",
  }));
}

export class MempalaceMemoryManager implements MemorySearchManager {
  private readonly cache = new Map<string, CachedEntry>();
  private statusSnapshot: StatusSnapshot | null = null;

  constructor(
    private readonly cfg: OpenClawConfig,
    private readonly agentId: string,
  ) {}

  private resolved() {
    return resolveMempalacePluginConfig(this.cfg, this.agentId);
  }

  private async refreshStatus(): Promise<StatusSnapshot> {
    const resolved = this.resolved();
    const snapshot: StatusSnapshot = {
      privateDrawers: 0,
      sharedDrawers: 0,
      tools: [
        "mempalace_search",
        "mempalace_check_duplicate",
        "mempalace_add_drawer",
        "mempalace_kg_query",
        "mempalace_kg_add",
        "mempalace_kg_invalidate",
        "mempalace_kg_timeline",
        "mempalace_diary_read",
        "mempalace_diary_write",
      ],
    };
    if (!resolved.server) {
      snapshot.privateError = "MemPalace MCP server is not configured.";
      this.statusSnapshot = snapshot;
      return snapshot;
    }
    try {
      const privateStatus = await getMempalaceStatus({
        cfg: this.cfg,
        agentId: this.agentId,
        palacePath: resolved.privatePalacePath,
      });
      snapshot.privateDrawers =
        typeof privateStatus.total_drawers === "number" ? privateStatus.total_drawers : 0;
    } catch (error) {
      snapshot.privateError = error instanceof Error ? error.message : String(error);
    }
    if (resolved.readShared && resolved.sharedPalacePath) {
      try {
        const sharedStatus = await getMempalaceStatus({
          cfg: this.cfg,
          agentId: this.agentId,
          palacePath: resolved.sharedPalacePath,
        });
        snapshot.sharedDrawers =
          typeof sharedStatus.total_drawers === "number" ? sharedStatus.total_drawers : 0;
      } catch (error) {
        snapshot.sharedError = error instanceof Error ? error.message : String(error);
      }
    }
    this.statusSnapshot = snapshot;
    return snapshot;
  }

  async search(
    query: string,
    opts?: { maxResults?: number; minScore?: number; sessionKey?: string },
  ): Promise<MemorySearchResult[]> {
    void opts?.sessionKey;
    const cleaned = query.trim();
    if (!cleaned) {
      return [];
    }
    const resolved = this.resolved();
    const maxResults = Math.max(1, opts?.maxResults ?? 6);
    const minScore = opts?.minScore ?? defaultMinScore();

    const [privateDrawerHits, sharedDrawerHits] = await Promise.all([
      resolveDrawerHits({
        cfg: this.cfg,
        agentId: this.agentId,
        query: cleaned,
        maxResults,
        scope: "private",
        palacePath: resolved.privatePalacePath,
      }),
      resolved.readShared &&
      resolved.sharedPalacePath &&
      resolved.sharedPalacePath !== resolved.privatePalacePath
        ? resolveDrawerHits({
            cfg: this.cfg,
            agentId: this.agentId,
            query: cleaned,
            maxResults,
            scope: "shared",
            palacePath: resolved.sharedPalacePath,
          })
        : Promise.resolve([]),
    ]);

    const kgPrivateHits = resolveKgHits({
      query: cleaned,
      maxResults,
      scope: "private",
      dbPath: resolved.privateKnowledgeGraphPath,
    });
    const kgSharedHits =
      resolved.readShared && resolved.sharedKnowledgeGraphPath
        ? resolveKgHits({
            query: cleaned,
            maxResults,
            scope: "shared",
            dbPath: resolved.sharedKnowledgeGraphPath,
          })
        : [];

    const merged = dedupeHits([
      ...privateDrawerHits,
      ...sharedDrawerHits,
      ...kgPrivateHits,
      ...kgSharedHits,
    ])
      .filter((hit) => scoreHit(hit, minScore))
      .toSorted((left, right) => right.score - left.score)
      .slice(0, maxResults);

    for (const hit of merged) {
      this.cache.set(hit.path, { path: hit.path, text: hit.text });
    }

    return merged.map((hit) => ({
      path: hit.path,
      startLine: 1,
      endLine: Math.max(1, hit.text.split("\n").length),
      score: hit.score,
      snippet: trimSnippet(hit.text),
      source: hit.source,
    }));
  }

  async readFile(params: {
    relPath: string;
    from?: number;
    lines?: number;
  }): Promise<{ text: string; path: string }> {
    const cached = this.cache.get(params.relPath);
    if (cached) {
      return {
        path: cached.path,
        text: applyLineSlice(cached.text, params.from, params.lines),
      };
    }

    const source = parseSyntheticPath(params.relPath);
    if (!source) {
      throw new Error(
        "Unsupported MemPalace memory path. Re-run memory_search and use one of the returned synthetic MemPalace paths.",
      );
    }

    const resolved = this.resolved();
    if (source.scope === "shared" && !resolved.readShared) {
      throw new Error("Shared MemPalace recall is disabled for this agent.");
    }

    if (source.kind === "drawer") {
      const palacePath =
        source.scope === "shared" ? resolved.sharedPalacePath : resolved.privatePalacePath;
      if (!palacePath) {
        throw new Error(`No ${source.scope} MemPalace palace is configured for this agent.`);
      }
      const drawer = await readDrawerBySyntheticPath({
        cfg: this.cfg,
        agentId: this.agentId,
        palacePath,
        wing: source.wing,
        room: source.room,
        digest: source.digest,
      });
      if (!drawer) {
        throw new Error(`MemPalace drawer not found for ${params.relPath}.`);
      }
      this.cache.set(params.relPath, { path: params.relPath, text: drawer.text });
      return {
        path: params.relPath,
        text: applyLineSlice(drawer.text, params.from, params.lines),
      };
    }

    const dbPath =
      source.scope === "shared"
        ? resolved.sharedKnowledgeGraphPath
        : resolved.privateKnowledgeGraphPath;
    if (!dbPath || !existsSync(dbPath)) {
      throw new Error(`No ${source.scope} MemPalace knowledge graph is configured for this agent.`);
    }
    const fact = readKnowledgeGraphFact({
      dbPath,
      subject: source.subject,
      predicate: source.predicate,
      object: source.object,
      validFrom: source.validFrom,
      validTo: source.validTo,
      digest: source.digest,
    });
    if (!fact) {
      throw new Error(`MemPalace knowledge graph fact not found for ${params.relPath}.`);
    }
    this.cache.set(params.relPath, { path: params.relPath, text: fact.text });
    return {
      path: params.relPath,
      text: applyLineSlice(fact.text, params.from, params.lines),
    };
  }

  status(): MemoryProviderStatus {
    const resolved = this.resolved();
    const snapshot = this.statusSnapshot;
    const sharedIsSamePalace =
      Boolean(resolved.sharedPalacePath) &&
      resolved.sharedPalacePath === resolved.privatePalacePath;
    const total = sharedIsSamePalace
      ? (snapshot?.privateDrawers ?? 0)
      : (snapshot?.privateDrawers ?? 0) + (snapshot?.sharedDrawers ?? 0);
    return {
      backend: "builtin",
      provider: "mempalace",
      model: "mcp",
      requestedProvider: "mempalace",
      files: total,
      chunks: total,
      dirty: false,
      workspaceDir: resolved.privatePalacePath,
      dbPath: resolved.privatePalacePath,
      sources: ["memory"],
      sourceCounts: [{ source: "memory", files: total, chunks: total }],
      vector: {
        enabled: true,
        available: Boolean(snapshot && !snapshot.privateError),
      },
      custom: {
        mempalace: {
          privatePalacePath: resolved.privatePalacePath,
          privateKnowledgeGraphPath: resolved.privateKnowledgeGraphPath,
          sharedPalacePath: resolved.sharedPalacePath,
          sharedKnowledgeGraphPath: resolved.sharedKnowledgeGraphPath,
          readShared: resolved.readShared,
          writeShared: resolved.writeShared,
          compatSinglePalaceMode: resolved.compatSinglePalaceMode,
          continuityCueBudget: resolved.continuityCueBudget,
          tools: snapshot?.tools ?? [],
          privateDrawers: snapshot?.privateDrawers ?? 0,
          sharedDrawers: sharedIsSamePalace ? 0 : (snapshot?.sharedDrawers ?? 0),
          privateError: snapshot?.privateError,
          sharedError: snapshot?.sharedError,
        },
      },
    };
  }

  async sync(params?: {
    reason?: string;
    force?: boolean;
    sessionFiles?: string[];
    progress?: (update: MemorySyncProgressUpdate) => void;
  }): Promise<void> {
    void params?.reason;
    void params?.force;
    void params?.sessionFiles;
    params?.progress?.({ completed: 0, total: 1, label: "MemPalace runtime is live-store based" });
    params?.progress?.({ completed: 1, total: 1, label: "No sync needed" });
  }

  async probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult> {
    try {
      const status = await this.refreshStatus();
      if (status.privateError) {
        return { ok: false, error: status.privateError };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async probeVectorAvailability(): Promise<boolean> {
    const probe = await this.probeEmbeddingAvailability();
    return probe.ok;
  }

  async close(): Promise<void> {
    this.cache.clear();
  }
}

export async function getMempalaceMemorySearchManager(params: {
  cfg: OpenClawConfig;
  agentId: string;
  purpose?: "default" | "status";
}): Promise<{ manager: MemorySearchManager | null; error?: string }> {
  void params.purpose;
  const resolved = resolveMempalacePluginConfig(params.cfg, params.agentId);
  if (!resolved.enabled) {
    return { manager: null, error: "mempalace-memory is disabled." };
  }
  if (!resolved.server) {
    return { manager: null, error: "MemPalace MCP server is not configured." };
  }
  const key = JSON.stringify({
    agentId: params.agentId,
    privatePalacePath: resolved.privatePalacePath,
    privateKnowledgeGraphPath: resolved.privateKnowledgeGraphPath,
    sharedPalacePath: resolved.sharedPalacePath,
    sharedKnowledgeGraphPath: resolved.sharedKnowledgeGraphPath,
    readShared: resolved.readShared,
    writeShared: resolved.writeShared,
    timeoutMs: resolved.timeoutMs,
  });
  const existing = MANAGER_CACHE.get(key);
  if (existing) {
    // Refresh LRU order by re-inserting
    MANAGER_CACHE.delete(key);
    MANAGER_CACHE.set(key, existing);
    await existing.probeEmbeddingAvailability().catch(() => undefined);
    return { manager: existing };
  }
  const manager = new MempalaceMemoryManager(params.cfg, params.agentId);
  await manager.probeEmbeddingAvailability();
  // Evict oldest entry when cache exceeds max size
  if (MANAGER_CACHE.size >= MANAGER_CACHE_MAX_SIZE) {
    const oldestKey = MANAGER_CACHE.keys().next().value;
    if (oldestKey !== undefined) {
      const oldest = MANAGER_CACHE.get(oldestKey);
      MANAGER_CACHE.delete(oldestKey);
      void oldest?.close().catch(() => undefined);
    }
  }
  MANAGER_CACHE.set(key, manager);
  return { manager };
}

export async function closeAllMempalaceMemorySearchManagers(): Promise<void> {
  const managers = Array.from(MANAGER_CACHE.values());
  MANAGER_CACHE.clear();
  for (const manager of managers) {
    await manager.close?.().catch(() => undefined);
  }
}
