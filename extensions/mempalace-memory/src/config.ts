import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/memory-core";

type RawPerAgentConfig = {
  privatePalacePath?: string;
  privateKnowledgeGraphPath?: string;
  readShared?: boolean;
  writeShared?: boolean;
  defaultWing?: string;
  defaultRoom?: string;
};

export type ResolvedMempalaceServerConfig = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  enabled: boolean;
  serverName: string;
};

export type ResolvedMempalacePluginConfig = {
  enabled: boolean;
  timeoutMs: number;
  continuityCueBudget: number;
  sharedPalacePath?: string;
  sharedKnowledgeGraphPath?: string;
  privatePalacePath: string;
  privateKnowledgeGraphPath: string;
  readShared: boolean;
  writeShared: boolean;
  defaultWing?: string;
  defaultRoom?: string;
  compatSinglePalaceMode: boolean;
  server: ResolvedMempalaceServerConfig | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function expandHomePath(inputPath: string | undefined): string | undefined {
  if (!inputPath) {
    return undefined;
  }
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function sanitizeList(values: unknown): string[] {
  return Array.isArray(values)
    ? values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
}

function defaultSharedKnowledgeGraphPath(): string {
  return path.join(os.homedir(), ".mempalace-data", "knowledge_graph.sqlite3");
}

function legacySharedKnowledgeGraphPath(): string {
  return path.join(os.homedir(), ".mempalace", "knowledge_graph.sqlite3");
}

function normalizeKnownSharedKnowledgeGraphPath(inputPath?: string): string | undefined {
  if (!inputPath) {
    return undefined;
  }
  const canonicalPath = defaultSharedKnowledgeGraphPath();
  const legacyPath = legacySharedKnowledgeGraphPath();
  if (inputPath !== legacyPath && inputPath !== canonicalPath) {
    return inputPath;
  }

  try {
    if (!fs.existsSync(legacyPath)) {
      return canonicalPath;
    }
    const legacyStat = fs.statSync(legacyPath);
    fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });

    if (!fs.existsSync(canonicalPath)) {
      fs.symlinkSync(legacyPath, canonicalPath);
      return canonicalPath;
    }

    const canonicalLstat = fs.lstatSync(canonicalPath);
    if (canonicalLstat.isSymbolicLink()) {
      return canonicalPath;
    }

    const canonicalStat = fs.statSync(canonicalPath);
    if (canonicalStat.size === 0 && legacyStat.size > 0) {
      fs.rmSync(canonicalPath, { force: true });
      fs.symlinkSync(legacyPath, canonicalPath);
    }
  } catch {
    // Fall through to the canonical path so new installs still converge.
  }

  return canonicalPath;
}

function matchAgentPattern(agentId: string, pattern: string): boolean {
  if (!pattern.includes("*")) {
    return agentId === pattern;
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(agentId);
}

function includesAgent(agentId: string, list: string[]): boolean {
  return list.some((pattern) => matchAgentPattern(agentId, pattern));
}

function resolvePluginEntryConfig(cfg?: OpenClawConfig): Record<string, unknown> {
  const entry = asRecord(cfg?.plugins?.entries?.["mempalace-memory"]);
  return asRecord(entry?.config) ?? {};
}

function resolvePerAgentConfig(
  raw: Record<string, unknown>,
  agentId: string,
): RawPerAgentConfig | undefined {
  const perAgent = asRecord(raw.perAgent);
  const scoped = asRecord(perAgent?.[agentId]);
  if (!scoped) {
    return undefined;
  }
  return {
    privatePalacePath:
      typeof scoped.privatePalacePath === "string" ? scoped.privatePalacePath : undefined,
    privateKnowledgeGraphPath:
      typeof scoped.privateKnowledgeGraphPath === "string"
        ? scoped.privateKnowledgeGraphPath
        : undefined,
    readShared: typeof scoped.readShared === "boolean" ? scoped.readShared : undefined,
    writeShared: typeof scoped.writeShared === "boolean" ? scoped.writeShared : undefined,
    defaultWing: typeof scoped.defaultWing === "string" ? scoped.defaultWing : undefined,
    defaultRoom: typeof scoped.defaultRoom === "string" ? scoped.defaultRoom : undefined,
  };
}

export function resolveMempalaceServerConfig(
  cfg?: OpenClawConfig,
  serverName = "mempalace",
): ResolvedMempalaceServerConfig | null {
  const server = asRecord(cfg?.mcp?.servers?.[serverName]);
  if (!server) {
    return null;
  }
  const command = typeof server.command === "string" ? server.command.trim() : "";
  if (!command) {
    return null;
  }
  const args = Array.isArray(server.args)
    ? server.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  const env = asRecord(server.env) ?? {};
  return {
    command,
    args,
    env: Object.fromEntries(
      Object.entries(env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    enabled: server.enabled !== false,
    serverName,
  };
}

export function resolveMempalacePluginConfig(
  cfg: OpenClawConfig | undefined,
  agentId: string,
): ResolvedMempalacePluginConfig {
  const raw = resolvePluginEntryConfig(cfg);
  const perAgent = resolvePerAgentConfig(raw, agentId);
  const serverName = typeof raw.mcpServerName === "string" ? raw.mcpServerName.trim() : "mempalace";
  const server = resolveMempalaceServerConfig(cfg, serverName);

  const serverPalacePath =
    typeof server?.env.MEMPALACE_PALACE_PATH === "string"
      ? expandHomePath(server.env.MEMPALACE_PALACE_PATH)
      : undefined;
  const explicitSharedPalacePath = expandHomePath(
    typeof raw.sharedPalacePath === "string" ? raw.sharedPalacePath : undefined,
  );
  const explicitDefaultPrivateRoot = expandHomePath(
    typeof raw.defaultPrivateRoot === "string" ? raw.defaultPrivateRoot : undefined,
  );
  const explicitSharedKnowledgeGraphPath = expandHomePath(
    typeof raw.sharedKnowledgeGraphPath === "string" ? raw.sharedKnowledgeGraphPath : undefined,
  );
  const sharedKnowledgeGraphPath =
    normalizeKnownSharedKnowledgeGraphPath(explicitSharedKnowledgeGraphPath) ??
    normalizeKnownSharedKnowledgeGraphPath(defaultSharedKnowledgeGraphPath()) ??
    defaultSharedKnowledgeGraphPath();

  const compatSinglePalaceMode =
    !explicitSharedPalacePath &&
    !explicitDefaultPrivateRoot &&
    !perAgent?.privatePalacePath &&
    Boolean(serverPalacePath);

  const sharedPalacePath = compatSinglePalaceMode
    ? serverPalacePath
    : (explicitSharedPalacePath ?? serverPalacePath);
  const defaultPrivateRoot =
    explicitDefaultPrivateRoot ?? path.join(os.homedir(), ".mempalace", "openclaw", "agents");
  const privatePalacePath =
    expandHomePath(perAgent?.privatePalacePath) ??
    (compatSinglePalaceMode ? sharedPalacePath : path.join(defaultPrivateRoot, agentId));

  const privateKnowledgeGraphPath =
    expandHomePath(perAgent?.privateKnowledgeGraphPath) ??
    (compatSinglePalaceMode
      ? sharedKnowledgeGraphPath
      : path.join(
          privatePalacePath ?? path.join(defaultPrivateRoot, agentId),
          "knowledge_graph.sqlite3",
        ));
  const resolvedPrivateKnowledgeGraphPath = privateKnowledgeGraphPath ?? sharedKnowledgeGraphPath;

  const sharedReadAgents = sanitizeList(raw.sharedReadAgents);
  const sharedWriteAgents = sanitizeList(raw.sharedWriteAgents);

  const readShared =
    typeof perAgent?.readShared === "boolean"
      ? perAgent.readShared
      : compatSinglePalaceMode || includesAgent(agentId, sharedReadAgents);
  const writeShared =
    typeof perAgent?.writeShared === "boolean"
      ? perAgent.writeShared
      : compatSinglePalaceMode || includesAgent(agentId, sharedWriteAgents);

  const timeoutMs =
    typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs) && raw.timeoutMs > 0
      ? Math.floor(raw.timeoutMs)
      : 10_000;
  const continuityCueBudget =
    typeof raw.continuityCueBudget === "number" &&
    Number.isFinite(raw.continuityCueBudget) &&
    raw.continuityCueBudget >= 1 &&
    raw.continuityCueBudget <= 3
      ? Math.floor(raw.continuityCueBudget)
      : 2;

  return {
    enabled: asRecord(cfg?.plugins?.entries?.["mempalace-memory"])?.enabled !== false,
    timeoutMs,
    continuityCueBudget,
    sharedPalacePath,
    sharedKnowledgeGraphPath,
    privatePalacePath: privatePalacePath ?? path.join(defaultPrivateRoot, agentId),
    privateKnowledgeGraphPath: resolvedPrivateKnowledgeGraphPath,
    readShared: Boolean(readShared && sharedPalacePath),
    writeShared: Boolean(writeShared && sharedPalacePath),
    defaultWing: perAgent?.defaultWing,
    defaultRoom: perAgent?.defaultRoom,
    compatSinglePalaceMode,
    server: server?.enabled === false ? null : server,
  };
}
