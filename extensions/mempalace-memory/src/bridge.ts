import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OpenClawConfig } from "openclaw/plugin-sdk/memory-core";
import { resolveMempalacePluginConfig } from "./config.js";
import { expandSearchTerms } from "./search-aliases.js";

export type MempalaceDrawerHit = {
  text: string;
  wing: string;
  room: string;
  source_file?: string;
  similarity: number;
};

export type MempalaceDrawerRecord = MempalaceDrawerHit & {
  drawer_id: string;
};

export type MempalaceKgHit = {
  text: string;
  score: number;
  subject: string;
  predicate: string;
  object: string;
  valid_from?: string | null;
  valid_to?: string | null;
  source_file?: string | null;
};

type JsonRpcResponse = {
  result?: { content?: Array<{ text?: string }> };
  error?: { message?: string };
};

type PalaceStatus = {
  total_drawers: number;
  wings?: Record<string, number>;
  rooms?: Record<string, number>;
};

type SyntheticPathScope = "private" | "shared";

export type SyntheticDrawerPath = {
  scope: SyntheticPathScope;
  kind: "drawer";
  version: "v1";
  wing: string;
  room: string;
  digest: string;
};

export type SyntheticKgPath = {
  scope: SyntheticPathScope;
  kind: "kg";
  version: "v1";
  subject: string;
  predicate: string;
  object: string;
  validFrom?: string;
  validTo?: string;
  digest: string;
};

export type ParsedSyntheticPath = SyntheticDrawerPath | SyntheticKgPath;

function digestText(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 32);
}

function encodeSyntheticSegment(value?: string | null): string {
  if (!value) {
    return "_";
  }
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeSyntheticSegment(value: string): string | undefined {
  if (!value || value === "_") {
    return undefined;
  }
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
}

function stripMarkdownSuffix(value: string): string {
  return value.endsWith(".md") ? value.slice(0, -3) : value;
}

function buildMcpEnv(env: NodeJS.ProcessEnv | undefined, palacePath: string): NodeJS.ProcessEnv {
  const merged = {
    ...process.env,
    ...env,
  };
  // Some local deployments pin a Chroma telemetry implementation path that is
  // not valid across versions. The official runtime bridge prefers portability
  // over inheriting that brittle override.
  delete merged.CHROMA_PRODUCT_TELEMETRY_IMPL;
  return {
    ...merged,
    MEMPALACE_PALACE_PATH: palacePath,
  };
}

const MAX_CONCURRENT_MCP_CALLS = 8;
let pendingMcpCalls = 0;
const mcpCallQueue: Array<() => void> = [];

function acquireMcpSlot(): Promise<void> {
  if (pendingMcpCalls < MAX_CONCURRENT_MCP_CALLS) {
    pendingMcpCalls++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    mcpCallQueue.push(resolve);
  });
}

function releaseMcpSlot(): void {
  const next = mcpCallQueue.shift();
  if (next) {
    next();
  } else {
    pendingMcpCalls--;
  }
}

export async function callMempalaceTool(params: {
  cfg: OpenClawConfig;
  agentId: string;
  toolName: string;
  palacePath: string;
  arguments: Record<string, unknown>;
}): Promise<unknown> {
  const resolved = resolveMempalacePluginConfig(params.cfg, params.agentId);
  const server = resolved.server;
  if (!server) {
    throw new Error("MemPalace MCP server is not configured.");
  }

  await acquireMcpSlot();
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(server.command, server.args, {
        env: buildMcpEnv(server.env, params.palacePath),
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`MemPalace MCP call timed out after ${resolved.timeoutMs}ms`));
      }, resolved.timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", () => {
        clearTimeout(timeout);
        const lines = stdout
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter(Boolean);
        // Filter by id:1 to get the tools/call response, skipping the
        // initialize response (id:0) and any non-JSON or notification lines.
        let toolResponse: JsonRpcResponse | undefined;
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as JsonRpcResponse & { id?: unknown };
            if (parsed.id === 1) {
              toolResponse = parsed;
              break;
            }
          } catch {
            // skip non-JSON lines
          }
        }
        if (!toolResponse) {
          reject(new Error(stderr || "MemPalace MCP response was empty"));
          return;
        }
        try {
          if (toolResponse.error?.message) {
            reject(new Error(toolResponse.error.message));
            return;
          }
          const text = toolResponse.result?.content?.[0]?.text;
          if (typeof text !== "string") {
            reject(new Error("MemPalace MCP response missing text content"));
            return;
          }
          resolve(JSON.parse(text));
        } catch (error) {
          reject(
            new Error(
              `Failed to parse MemPalace MCP response: ${error instanceof Error ? error.message : String(error)}${stderr ? ` (${stderr.trim()})` : ""}`,
            ),
          );
        }
      });

      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "openclaw", version: "1.0.0" },
          },
        }) + "\n",
      );
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {},
        }) + "\n",
      );
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: params.toolName,
            arguments: params.arguments,
          },
        }) + "\n",
      );
      child.stdin.end();
    });
  } finally {
    releaseMcpSlot();
  }
}

function resolvePythonCommand(command: string, args: string[]): string {
  // If the command itself looks like a Python interpreter, use it directly.
  if (/(?:^|[/\\])python3?$/.test(command)) {
    return command;
  }
  // Otherwise look for a python interpreter in the args list (e.g. "uv run python3").
  const pythonArg = args.find((arg) => /(?:^|[/\\])python3?$/.test(arg));
  if (pythonArg) {
    return pythonArg;
  }
  // Fall back to the system python3 so the error is meaningful rather than
  // spawning a tool runner (e.g. uvx) with an unsupported -c flag.
  return "python3";
}

function resolvePythonServer(params: { cfg: OpenClawConfig; agentId: string }): {
  command: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
} {
  const resolved = resolveMempalacePluginConfig(params.cfg, params.agentId);
  const server = resolved.server;
  if (!server) {
    throw new Error("MemPalace runtime is not configured.");
  }
  return {
    command: resolvePythonCommand(server.command, server.args),
    env: server.env,
    timeoutMs: resolved.timeoutMs,
  };
}

async function runMempalacePythonJson(params: {
  cfg: OpenClawConfig;
  agentId: string;
  palacePath: string;
  script: string;
  payload: Record<string, unknown>;
}): Promise<unknown> {
  const server = resolvePythonServer(params);
  await acquireMcpSlot();
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(server.command, ["-c", params.script], {
        env: buildMcpEnv(server.env, params.palacePath),
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`MemPalace Python bridge timed out after ${server.timeoutMs}ms`));
      }, server.timeoutMs);
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(stderr.trim() || `MemPalace Python bridge exited ${code}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout || "{}"));
        } catch (error) {
          reject(
            new Error(
              `Failed to parse MemPalace Python JSON output: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      });
      child.stdin.write(JSON.stringify(params.payload));
      child.stdin.end();
    });
  } finally {
    releaseMcpSlot();
  }
}

const DRAWER_SEARCH_SCRIPT = `
import json, sys
payload = json.loads(sys.stdin.read())
palace_path = payload["palace_path"]
query = payload["query"]
max_results = int(payload.get("max_results", 5))
wing = payload.get("wing")
room = payload.get("room")
after_ts = payload.get("after_ts")
before_ts = payload.get("before_ts")
has_time_filter = after_ts is not None or before_ts is not None
if not has_time_filter:
    from mempalace.searcher import search_memories
    try:
        result = search_memories(query, palace_path=palace_path, wing=wing, room=room, n_results=max_results)
    except Exception as exc:
        if "Collection [mempalace_drawers] does not exist" in str(exc):
            print(json.dumps({"results": []}))
            sys.exit(0)
        raise
    print(json.dumps(result))
    sys.exit(0)
import chromadb
conditions = []
if wing:
    conditions.append({"wing": {"$eq": wing}})
if room:
    conditions.append({"room": {"$eq": room}})
if after_ts is not None:
    conditions.append({"filed_at_ts": {"$gte": int(after_ts)}})
if before_ts is not None:
    conditions.append({"filed_at_ts": {"$lte": int(before_ts)}})
where = {"$and": conditions} if len(conditions) > 1 else (conditions[0] if conditions else None)
try:
    from mempalace.config import get_embedding_function
    ef = get_embedding_function()
except Exception:
    ef = None
client = chromadb.PersistentClient(path=palace_path)
try:
    col = client.get_collection("mempalace_drawers", **({"embedding_function": ef} if ef else {}))
except Exception as exc:
    if "Collection [mempalace_drawers] does not exist" in str(exc):
        print(json.dumps({"results": []}))
        sys.exit(0)
    raise
qkw = {"query_texts": [query], "n_results": max_results, "include": ["documents", "metadatas", "distances"]}
if where is not None:
    qkw["where"] = where
raw = col.query(**qkw)
docs = (raw.get("documents") or [[]])[0]
metas = (raw.get("metadatas") or [[]])[0]
dists = (raw.get("distances") or [[]])[0]
results = []
for doc, meta, dist in zip(docs, metas, dists):
    m = meta or {}
    results.append({"text": doc or "", "wing": m.get("wing", ""), "room": m.get("room", ""), "similarity": round(max(0.0, 1.0 - float(dist)), 6), "source_file": m.get("source_file")})
print(json.dumps({"results": results}))
`.trim();

const PALACE_STATUS_SCRIPT = `
import json, sys
from collections import defaultdict
import chromadb
payload = json.loads(sys.stdin.read())
client = chromadb.PersistentClient(path=payload["palace_path"])
try:
    col = client.get_collection("mempalace_drawers")
except Exception as exc:
    if "Collection [mempalace_drawers] does not exist" in str(exc):
        print(json.dumps({
            "total_drawers": 0,
            "wings": {},
            "rooms": {},
        }))
        sys.exit(0)
    raise
rows = col.get(limit=10000, include=["metadatas"])
wings = defaultdict(int)
rooms = defaultdict(int)
for meta in rows.get("metadatas", []):
    wings[meta.get("wing", "unknown")] += 1
    rooms[meta.get("room", "unknown")] += 1
print(json.dumps({
    "total_drawers": len(rows.get("metadatas", [])),
    "wings": dict(wings),
    "rooms": dict(rooms),
}))
`.trim();

const DRAWER_READ_SCRIPT = `
import hashlib, json, sys
import chromadb
payload = json.loads(sys.stdin.read())
client = chromadb.PersistentClient(path=payload["palace_path"])
try:
    col = client.get_collection("mempalace_drawers")
except Exception as exc:
    if "Collection [mempalace_drawers] does not exist" in str(exc):
        print(json.dumps({"error": "Drawer not found"}))
        sys.exit(0)
    raise
rows = col.get(limit=10000, include=["documents", "metadatas"])
documents = rows.get("documents", []) or []
metadatas = rows.get("metadatas", []) or []
for doc, meta in zip(documents, metadatas):
    text = doc or ""
    if (meta or {}).get("wing") != payload["wing"]:
        continue
    if (meta or {}).get("room") != payload["room"]:
        continue
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:32]
    if digest != payload["digest"]:
        continue
    print(json.dumps({
        "text": text,
        "wing": (meta or {}).get("wing"),
        "room": (meta or {}).get("room"),
        "source_file": (meta or {}).get("source_file"),
    }))
    sys.exit(0)
print(json.dumps({"error": "Drawer not found"}))
`.trim();

const DRAWER_READ_BY_ID_SCRIPT = `
import json, sys
import chromadb
payload = json.loads(sys.stdin.read())
client = chromadb.PersistentClient(path=payload["palace_path"])
try:
    col = client.get_collection("mempalace_drawers")
except Exception as exc:
    if "Collection [mempalace_drawers] does not exist" in str(exc):
        print(json.dumps({"error": "Drawer not found"}))
        sys.exit(0)
    raise
rows = col.get(ids=[payload["drawer_id"]], include=["documents", "metadatas"])
ids = rows.get("ids", []) or []
documents = rows.get("documents", []) or []
metadatas = rows.get("metadatas", []) or []
if ids and documents:
    print(json.dumps({
        "text": documents[0] or "",
        "wing": (metadatas[0] or {}).get("wing"),
        "room": (metadatas[0] or {}).get("room"),
        "source_file": (metadatas[0] or {}).get("source_file"),
    }))
else:
    print(json.dumps({"error": "Drawer not found"}))
`.trim();

const DRAWER_FIND_SCRIPT = `
import hashlib, json, sys
import chromadb
payload = json.loads(sys.stdin.read())
client = chromadb.PersistentClient(path=payload["palace_path"])
try:
    col = client.get_collection("mempalace_drawers")
except Exception as exc:
    if "Collection [mempalace_drawers] does not exist" in str(exc):
        print(json.dumps({"error": "Drawer not found"}))
        sys.exit(0)
    raise
rows = col.get(limit=10000, include=["documents", "metadatas"])
ids = rows.get("ids", []) or []
documents = rows.get("documents", []) or []
metadatas = rows.get("metadatas", []) or []
for drawer_id, doc, meta in zip(ids, documents, metadatas):
    text = doc or ""
    if (meta or {}).get("wing") != payload["wing"]:
        continue
    if (meta or {}).get("room") != payload["room"]:
        continue
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:32]
    if digest != payload["digest"]:
        continue
    print(json.dumps({
        "drawer_id": drawer_id,
        "text": text,
        "wing": (meta or {}).get("wing"),
        "room": (meta or {}).get("room"),
        "source_file": (meta or {}).get("source_file"),
    }))
    sys.exit(0)
print(json.dumps({"error": "Drawer not found"}))
`.trim();

const DRAWER_LIST_SCRIPT = `
import json, sys
import chromadb
payload = json.loads(sys.stdin.read())
client = chromadb.PersistentClient(path=payload["palace_path"])
try:
    col = client.get_collection("mempalace_drawers")
except Exception as exc:
    if "Collection [mempalace_drawers] does not exist" in str(exc):
        print(json.dumps({"results": []}))
        sys.exit(0)
    raise
rows = col.get(limit=payload.get("limit", 10000), include=["documents", "metadatas"])
ids = rows.get("ids", []) or []
documents = rows.get("documents", []) or []
metadatas = rows.get("metadatas", []) or []
results = []
for drawer_id, doc, meta in zip(ids, documents, metadatas):
    results.append({
        "drawer_id": drawer_id,
        "text": doc or "",
        "wing": (meta or {}).get("wing"),
        "room": (meta or {}).get("room"),
        "source_file": (meta or {}).get("source_file"),
    })
print(json.dumps({"results": results}))
`.trim();

const DRAWER_UPDATE_SCRIPT = `
import hashlib, json, sys
import chromadb
payload = json.loads(sys.stdin.read())
client = chromadb.PersistentClient(path=payload["palace_path"])
try:
    col = client.get_collection("mempalace_drawers")
except Exception as exc:
    if "Collection [mempalace_drawers] does not exist" in str(exc):
        print(json.dumps({"error": "Drawer not found"}))
        sys.exit(0)
    raise
rows = col.get(limit=10000, include=["documents", "metadatas"])
ids = rows.get("ids", []) or []
documents = rows.get("documents", []) or []
metadatas = rows.get("metadatas", []) or []
for drawer_id, doc, meta in zip(ids, documents, metadatas):
    text = doc or ""
    if (meta or {}).get("wing") != payload["wing"]:
        continue
    if (meta or {}).get("room") != payload["room"]:
        continue
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:32]
    if digest != payload["digest"]:
        continue
    next_meta = {
        "wing": payload["next_wing"],
        "room": payload["next_room"],
        "source_file": payload.get("source_file"),
    }
    col.update(ids=[drawer_id], documents=[payload["content"]], metadatas=[next_meta])
    print(json.dumps({
        "drawer_id": drawer_id,
        "text": payload["content"],
        "wing": payload["next_wing"],
        "room": payload["next_room"],
        "source_file": payload.get("source_file"),
    }))
    sys.exit(0)
print(json.dumps({"error": "Drawer not found"}))
`.trim();

const DRAWER_DELETE_SCRIPT = `
import hashlib, json, sys
import chromadb
payload = json.loads(sys.stdin.read())
client = chromadb.PersistentClient(path=payload["palace_path"])
try:
    col = client.get_collection("mempalace_drawers")
except Exception as exc:
    if "Collection [mempalace_drawers] does not exist" in str(exc):
        print(json.dumps({"error": "Drawer not found"}))
        sys.exit(0)
    raise
rows = col.get(limit=10000, include=["documents", "metadatas"])
ids = rows.get("ids", []) or []
documents = rows.get("documents", []) or []
metadatas = rows.get("metadatas", []) or []
for drawer_id, doc, meta in zip(ids, documents, metadatas):
    text = doc or ""
    if (meta or {}).get("wing") != payload["wing"]:
        continue
    if (meta or {}).get("room") != payload["room"]:
        continue
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:32]
    if digest != payload["digest"]:
        continue
    col.delete(ids=[drawer_id])
    print(json.dumps({"deleted": True, "drawer_id": drawer_id}))
    sys.exit(0)
print(json.dumps({"error": "Drawer not found"}))
`.trim();

// Write a drawer directly to a per-agent private palace, bypassing the MCP
// daemon. The daemon has a fixed PALACE_PATH set at startup and cannot honor
// per-request palace paths. In non-compat (per-agent isolation) mode the
// TypeScript layer routes private writes here so they land in the correct
// agent-specific directory instead of the daemon's shared palace.
const DRAWER_WRITE_DIRECT_SCRIPT = `
import hashlib, json, sys
from datetime import datetime
import chromadb
payload = json.loads(sys.stdin.read())
palace_path = payload["palace_path"]
wing = payload["wing"]
room = payload["room"]
content = payload["content"]
source_file = payload.get("source_file") or ""
added_by = payload.get("added_by") or "memory-write"
client = chromadb.PersistentClient(path=palace_path)
try:
    from mempalace.config import get_embedding_function
    ef = get_embedding_function()
    col = client.get_or_create_collection("mempalace_drawers", embedding_function=ef)
except Exception:
    col = client.get_or_create_collection("mempalace_drawers")
content_hash = hashlib.sha1(content.encode("utf-8")).hexdigest()[:20]
loc_hash = hashlib.sha1((wing + "/" + room).encode("utf-8")).hexdigest()[:8]
drawer_id = f"drawer_{wing}_{room}_{loc_hash}_{content_hash}"
try:
    col.upsert(
        ids=[drawer_id],
        documents=[content],
        metadatas=[{"wing": wing, "room": room, "source_file": source_file,
                    "chunk_index": 0, "added_by": added_by,
                    "filed_at": datetime.now().isoformat(),
                    "filed_at_ts": int(datetime.now().timestamp())}]
    )
    print(json.dumps({"success": True, "drawer_id": drawer_id, "wing": wing, "room": room}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
`.trim();

export async function writeDrawerDirect(params: {
  cfg: OpenClawConfig;
  agentId: string;
  palacePath: string;
  wing: string;
  room: string;
  content: string;
  sourceFile?: string;
}): Promise<{
  success: boolean;
  drawer_id?: string;
  wing?: string;
  room?: string;
  error?: string;
}> {
  return (await runMempalacePythonJson({
    cfg: params.cfg,
    agentId: params.agentId,
    palacePath: params.palacePath,
    script: DRAWER_WRITE_DIRECT_SCRIPT,
    payload: {
      palace_path: params.palacePath,
      wing: params.wing,
      room: params.room,
      content: params.content,
      source_file: params.sourceFile ?? "",
      added_by: "openclaw-memory_write",
    },
  })) as { success: boolean; drawer_id?: string; wing?: string; room?: string; error?: string };
}

// Force-insert (upsert) a drawer without the MCP-layer duplicate check.
// Uses a deterministic ID keyed on (wing, room, content_digest) so that
// re-importing the same entry is idempotent and never silently dropped.
const DRAWER_FORCE_INSERT_SCRIPT = `
import hashlib, json, sys
from datetime import datetime
import chromadb
payload = json.loads(sys.stdin.read())
client = chromadb.PersistentClient(path=payload["palace_path"])
col = client.get_or_create_collection("mempalace_drawers")
wing = payload["wing"]
room = payload["room"]
content = payload["content"]
source_file = payload.get("source_file") or ""
added_by = payload.get("added_by") or "memory-import"
content_digest = hashlib.sha1(content.encode("utf-8")).hexdigest()[:16]
loc_digest = hashlib.sha1((wing + "/" + room).encode("utf-8")).hexdigest()[:8]
drawer_id = f"drawer_import_{loc_digest}_{content_digest}"
try:
    col.upsert(
        ids=[drawer_id],
        documents=[content],
        metadatas=[{
            "wing": wing,
            "room": room,
            "source_file": source_file,
            "chunk_index": 0,
            "added_by": added_by,
            "filed_at": datetime.now().isoformat(),
            "filed_at_ts": int(datetime.now().timestamp()),
        }]
    )
    print(json.dumps({"success": True, "drawer_id": drawer_id, "wing": wing, "room": room}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
`.trim();

export async function forceInsertDrawer(params: {
  cfg: OpenClawConfig;
  agentId: string;
  palacePath: string;
  wing: string;
  room: string;
  content: string;
  sourceFile?: string;
  addedBy?: string;
}): Promise<{
  success: boolean;
  drawer_id?: string;
  wing?: string;
  room?: string;
  error?: string;
}> {
  return (await runMempalacePythonJson({
    cfg: params.cfg,
    agentId: params.agentId,
    palacePath: params.palacePath,
    script: DRAWER_FORCE_INSERT_SCRIPT,
    payload: {
      palace_path: params.palacePath,
      wing: params.wing,
      room: params.room,
      content: params.content,
      source_file: params.sourceFile ?? "",
      added_by: params.addedBy ?? "memory-import",
    },
  })) as { success: boolean; drawer_id?: string; wing?: string; room?: string; error?: string };
}

export async function searchDrawerMemories(params: {
  cfg: OpenClawConfig;
  agentId: string;
  palacePath: string;
  query: string;
  maxResults: number;
  wing?: string;
  room?: string;
  afterTs?: number;
  beforeTs?: number;
}): Promise<MempalaceDrawerHit[]> {
  const result = (await runMempalacePythonJson({
    cfg: params.cfg,
    agentId: params.agentId,
    palacePath: params.palacePath,
    script: DRAWER_SEARCH_SCRIPT,
    payload: {
      query: params.query,
      palace_path: params.palacePath,
      max_results: params.maxResults,
      ...(params.wing ? { wing: params.wing } : {}),
      ...(params.room ? { room: params.room } : {}),
      ...(params.afterTs !== undefined ? { after_ts: params.afterTs } : {}),
      ...(params.beforeTs !== undefined ? { before_ts: params.beforeTs } : {}),
    },
  })) as { results?: MempalaceDrawerHit[]; error?: string };
  if (result.error) {
    throw new Error(result.error);
  }
  return result.results ?? [];
}

export async function getMempalaceStatus(params: {
  cfg: OpenClawConfig;
  agentId: string;
  palacePath: string;
}): Promise<PalaceStatus> {
  return (await runMempalacePythonJson({
    cfg: params.cfg,
    agentId: params.agentId,
    palacePath: params.palacePath,
    script: PALACE_STATUS_SCRIPT,
    payload: {
      palace_path: params.palacePath,
    },
  })) as PalaceStatus;
}

export async function readDrawerBySyntheticPath(params: {
  cfg: OpenClawConfig;
  agentId: string;
  palacePath: string;
  wing: string;
  room: string;
  digest: string;
}): Promise<MempalaceDrawerHit | null> {
  const result = (await runMempalacePythonJson({
    cfg: params.cfg,
    agentId: params.agentId,
    palacePath: params.palacePath,
    script: DRAWER_READ_SCRIPT,
    payload: {
      palace_path: params.palacePath,
      wing: params.wing,
      room: params.room,
      digest: params.digest,
    },
  })) as { text?: string; wing?: string; room?: string; source_file?: string; error?: string };
  if (result.error) {
    return null;
  }
  const text = typeof result.text === "string" ? result.text : "";
  if (!text) {
    return null;
  }
  return {
    text,
    wing: typeof result.wing === "string" ? result.wing : params.wing,
    room: typeof result.room === "string" ? result.room : params.room,
    source_file: typeof result.source_file === "string" ? result.source_file : undefined,
    similarity: 1,
  };
}

export async function readDrawerById(params: {
  cfg: OpenClawConfig;
  agentId: string;
  palacePath: string;
  drawerId: string;
}): Promise<MempalaceDrawerHit | null> {
  const result = (await runMempalacePythonJson({
    cfg: params.cfg,
    agentId: params.agentId,
    palacePath: params.palacePath,
    script: DRAWER_READ_BY_ID_SCRIPT,
    payload: {
      palace_path: params.palacePath,
      drawer_id: params.drawerId,
    },
  })) as { text?: string; wing?: string; room?: string; source_file?: string; error?: string };
  if (result.error) {
    return null;
  }
  return {
    text: typeof result.text === "string" ? result.text : "",
    wing: typeof result.wing === "string" ? result.wing : "unknown",
    room: typeof result.room === "string" ? result.room : "unknown",
    source_file: typeof result.source_file === "string" ? result.source_file : undefined,
    similarity: 1,
  };
}

export async function findDrawerBySyntheticPath(params: {
  cfg: OpenClawConfig;
  agentId: string;
  palacePath: string;
  wing: string;
  room: string;
  digest: string;
}): Promise<MempalaceDrawerRecord | null> {
  const result = (await runMempalacePythonJson({
    cfg: params.cfg,
    agentId: params.agentId,
    palacePath: params.palacePath,
    script: DRAWER_FIND_SCRIPT,
    payload: {
      palace_path: params.palacePath,
      wing: params.wing,
      room: params.room,
      digest: params.digest,
    },
  })) as {
    drawer_id?: string;
    text?: string;
    wing?: string;
    room?: string;
    source_file?: string;
    error?: string;
  };
  if (result.error || typeof result.drawer_id !== "string" || typeof result.text !== "string") {
    return null;
  }
  return {
    drawer_id: result.drawer_id,
    text: result.text,
    wing: typeof result.wing === "string" ? result.wing : params.wing,
    room: typeof result.room === "string" ? result.room : params.room,
    source_file: typeof result.source_file === "string" ? result.source_file : undefined,
    similarity: 1,
  };
}

export async function listDrawerRecords(params: {
  cfg: OpenClawConfig;
  agentId: string;
  palacePath: string;
  limit?: number;
}): Promise<MempalaceDrawerRecord[]> {
  const result = (await runMempalacePythonJson({
    cfg: params.cfg,
    agentId: params.agentId,
    palacePath: params.palacePath,
    script: DRAWER_LIST_SCRIPT,
    payload: {
      palace_path: params.palacePath,
      limit: params.limit ?? 10_000,
    },
  })) as { results?: MempalaceDrawerRecord[]; error?: string };
  if (result.error) {
    throw new Error(result.error);
  }
  return (result.results ?? []).map((entry) => ({
    drawer_id: entry.drawer_id,
    text: entry.text ?? "",
    wing: entry.wing ?? "unknown",
    room: entry.room ?? "unknown",
    source_file: entry.source_file,
    similarity: 1,
  }));
}

export async function updateDrawerBySyntheticPath(params: {
  cfg: OpenClawConfig;
  agentId: string;
  palacePath: string;
  wing: string;
  room: string;
  digest: string;
  nextWing: string;
  nextRoom: string;
  content: string;
  sourceFile?: string;
}): Promise<MempalaceDrawerRecord | null> {
  const result = (await runMempalacePythonJson({
    cfg: params.cfg,
    agentId: params.agentId,
    palacePath: params.palacePath,
    script: DRAWER_UPDATE_SCRIPT,
    payload: {
      palace_path: params.palacePath,
      wing: params.wing,
      room: params.room,
      digest: params.digest,
      next_wing: params.nextWing,
      next_room: params.nextRoom,
      content: params.content,
      source_file: params.sourceFile,
    },
  })) as {
    drawer_id?: string;
    text?: string;
    wing?: string;
    room?: string;
    source_file?: string;
    error?: string;
  };
  if (result.error || typeof result.drawer_id !== "string" || typeof result.text !== "string") {
    return null;
  }
  return {
    drawer_id: result.drawer_id,
    text: result.text,
    wing: typeof result.wing === "string" ? result.wing : params.nextWing,
    room: typeof result.room === "string" ? result.room : params.nextRoom,
    source_file: typeof result.source_file === "string" ? result.source_file : undefined,
    similarity: 1,
  };
}

export async function deleteDrawerBySyntheticPath(params: {
  cfg: OpenClawConfig;
  agentId: string;
  palacePath: string;
  wing: string;
  room: string;
  digest: string;
}): Promise<{ deleted: boolean; drawer_id: string } | null> {
  const result = (await runMempalacePythonJson({
    cfg: params.cfg,
    agentId: params.agentId,
    palacePath: params.palacePath,
    script: DRAWER_DELETE_SCRIPT,
    payload: {
      palace_path: params.palacePath,
      wing: params.wing,
      room: params.room,
      digest: params.digest,
    },
  })) as { deleted?: boolean; drawer_id?: string; error?: string };
  if (result.error || result.deleted !== true || typeof result.drawer_id !== "string") {
    return null;
  }
  return {
    deleted: true,
    drawer_id: result.drawer_id,
  };
}

export async function listMempalaceTools(params: {
  cfg: OpenClawConfig;
  agentId: string;
  palacePath: string;
}): Promise<string[]> {
  const resolved = resolveMempalacePluginConfig(params.cfg, params.agentId);
  const server = resolved.server;
  if (!server) {
    return [];
  }
  await acquireMcpSlot();
  try {
    return await new Promise((resolve) => {
      const child = spawn(server.command, server.args, {
        env: buildMcpEnv(server.env, params.palacePath),
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        resolve([]);
      }, resolved.timeoutMs);
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.on("error", () => {
        clearTimeout(timeout);
        resolve([]);
      });
      child.on("close", () => {
        clearTimeout(timeout);
        const lines = stdout
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter(Boolean);
        // Filter by id:1 to get the tools/list response, skipping the
        // initialize response (id:0) and any non-JSON or notification lines.
        for (const line of lines) {
          try {
            const response = JSON.parse(line) as {
              id?: unknown;
              result?: { tools?: Array<{ name?: string }> };
            };
            if (response.id !== 1) {
              continue;
            }
            resolve(
              (response.result?.tools ?? [])
                .map((tool) => tool.name?.trim())
                .filter((name): name is string => Boolean(name)),
            );
            return;
          } catch {
            // skip non-JSON lines
          }
        }
        resolve([]);
      });
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "openclaw", version: "1.0.0" },
          },
        }) + "\n",
      );
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {},
        }) + "\n",
      );
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }) + "\n",
      );
      child.stdin.end();
    });
  } finally {
    releaseMcpSlot();
  }
}

function tokenize(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
  const expanded = expandSearchTerms(tokens);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of expanded) {
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    result.push(token);
  }
  return result.slice(0, 8);
}

function buildKgText(row: {
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

function scoreKgRow(rowText: string, terms: string[], current: boolean, query: string): number {
  const normalized = rowText.toLowerCase();
  if (normalized === query.toLowerCase()) {
    return 0.99;
  }
  let hits = 0;
  for (const term of terms) {
    if (normalized.includes(term)) {
      hits += 1;
    }
  }
  const coverage = terms.length > 0 ? hits / terms.length : 0;
  return Math.min(0.95, coverage * 0.75 + (current ? 0.15 : 0.05));
}

export function searchKnowledgeGraph(params: {
  dbPath: string;
  query: string;
  maxResults: number;
}): MempalaceKgHit[] {
  const terms = tokenize(params.query);
  if (terms.length === 0) {
    return [];
  }
  const sqlTerms = terms
    .map(
      () =>
        "(lower(s.name) LIKE ? OR lower(t.predicate) LIKE ? OR lower(o.name) LIKE ? OR lower(coalesce(t.source_file, '')) LIKE ?)",
    )
    .join(" OR ");
  const queryParams = terms.flatMap((term) => {
    const pattern = `%${term}%`;
    return [pattern, pattern, pattern, pattern];
  });

  const db = new DatabaseSync(params.dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 1000");
    const rows = db
      .prepare(
        `SELECT s.name as subject, t.predicate as predicate, o.name as object,\n` +
          `       t.valid_from as valid_from, t.valid_to as valid_to, t.source_file as source_file\n` +
          `  FROM triples t\n` +
          `  JOIN entities s ON t.subject = s.id\n` +
          `  JOIN entities o ON t.object = o.id\n` +
          ` WHERE ${sqlTerms}\n` +
          ` ORDER BY CASE WHEN t.valid_to IS NULL THEN 0 ELSE 1 END ASC,\n` +
          `          coalesce(t.valid_from, '') DESC\n` +
          ` LIMIT ?`,
      )
      .all(...queryParams, Math.max(1, params.maxResults * 2)) as Array<{
      subject: string;
      predicate: string;
      object: string;
      valid_from?: string | null;
      valid_to?: string | null;
      source_file?: string | null;
    }>;

    return rows
      .map((row) => {
        const text = buildKgText(row);
        return {
          text,
          score: scoreKgRow(text, terms, row.valid_to == null, params.query),
          subject: row.subject,
          predicate: row.predicate,
          object: row.object,
          valid_from: row.valid_from,
          valid_to: row.valid_to,
          source_file: row.source_file,
        } satisfies MempalaceKgHit;
      })
      .toSorted((left, right) => right.score - left.score)
      .slice(0, Math.max(1, params.maxResults));
  } finally {
    db.close();
  }
}

export function readKnowledgeGraphFact(params: {
  dbPath: string;
  subject: string;
  predicate: string;
  object: string;
  validFrom?: string;
  validTo?: string;
  digest?: string;
}): MempalaceKgHit | null {
  const db = new DatabaseSync(params.dbPath, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 1000");
    const row = db
      .prepare(
        `SELECT s.name as subject, t.predicate as predicate, o.name as object,\n` +
          `       t.valid_from as valid_from, t.valid_to as valid_to, t.source_file as source_file\n` +
          `  FROM triples t\n` +
          `  JOIN entities s ON t.subject = s.id\n` +
          `  JOIN entities o ON t.object = o.id\n` +
          ` WHERE s.name = ? AND t.predicate = ? AND o.name = ?\n` +
          `   AND ((? IS NULL AND t.valid_from IS NULL) OR t.valid_from = ?)\n` +
          `   AND ((? IS NULL AND t.valid_to IS NULL) OR t.valid_to = ?)\n` +
          ` LIMIT 1`,
      )
      .get(
        params.subject,
        params.predicate,
        params.object,
        params.validFrom ?? null,
        params.validFrom ?? null,
        params.validTo ?? null,
        params.validTo ?? null,
      ) as
      | {
          subject: string;
          predicate: string;
          object: string;
          valid_from?: string | null;
          valid_to?: string | null;
          source_file?: string | null;
        }
      | undefined;
    if (!row) {
      return null;
    }
    const text = buildKgText(row);
    if (params.digest && digestText(text) !== params.digest) {
      return null;
    }
    return {
      text,
      score: 1,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      valid_from: row.valid_from,
      valid_to: row.valid_to,
      source_file: row.source_file,
    };
  } finally {
    db.close();
  }
}

export function buildSyntheticPath(
  params:
    | {
        scope: SyntheticPathScope;
        kind: "drawer";
        wing?: string;
        room?: string;
        text: string;
      }
    | {
        scope: SyntheticPathScope;
        kind: "kg";
        subject: string;
        predicate: string;
        object: string;
        validFrom?: string | null;
        validTo?: string | null;
        text: string;
      },
): string {
  const digest = digestText(params.text);
  if (params.kind === "kg") {
    return [
      "mempalace",
      params.scope,
      "kg",
      "v1",
      encodeSyntheticSegment(params.subject),
      encodeSyntheticSegment(params.predicate),
      encodeSyntheticSegment(params.object),
      encodeSyntheticSegment(params.validFrom),
      encodeSyntheticSegment(params.validTo),
      `${digest}.md`,
    ].join("/");
  }
  return [
    "mempalace",
    params.scope,
    "drawer",
    "v1",
    encodeSyntheticSegment(params.wing ?? "unknown"),
    encodeSyntheticSegment(params.room ?? "unknown"),
    `${digest}.md`,
  ].join("/");
}

export function parseSyntheticPath(relPath: string): ParsedSyntheticPath | null {
  const parts = relPath.split("/");
  if (parts[0] !== "mempalace") {
    return null;
  }
  const scope = parts[1];
  if (scope !== "private" && scope !== "shared") {
    return null;
  }
  const kind = parts[2];
  const version = parts[3];
  if (version !== "v1") {
    return null;
  }
  if (kind === "drawer" && parts.length === 7) {
    const wing = decodeSyntheticSegment(parts[4]);
    const room = decodeSyntheticSegment(parts[5]);
    const digest = stripMarkdownSuffix(parts[6]);
    if (!wing || !room || !digest) {
      return null;
    }
    return {
      scope,
      kind: "drawer",
      version: "v1",
      wing,
      room,
      digest,
    };
  }
  if (kind === "kg" && parts.length === 10) {
    const subject = decodeSyntheticSegment(parts[4]);
    const predicate = decodeSyntheticSegment(parts[5]);
    const object = decodeSyntheticSegment(parts[6]);
    const validFrom = decodeSyntheticSegment(parts[7]);
    const validTo = decodeSyntheticSegment(parts[8]);
    const digest = stripMarkdownSuffix(parts[9]);
    if (!subject || !predicate || !object || !digest) {
      return null;
    }
    return {
      scope,
      kind: "kg",
      version: "v1",
      subject,
      predicate,
      object,
      validFrom,
      validTo,
      digest,
    };
  }
  return null;
}

export function defaultKnowledgeGraphPath(): string {
  return path.join(os.homedir(), ".mempalace", "knowledge_graph.sqlite3");
}

// ---------------------------------------------------------------------------
// FTS5 (SQLite full-text search) helpers
// ---------------------------------------------------------------------------

const DRAWER_FTS_WRITE_SCRIPT = `
import json, sys, sqlite3, os
payload = json.loads(sys.stdin.read())
palace_path = payload["palace_path"]
drawer_id = payload["drawer_id"]
wing = payload.get("wing", "")
room = payload.get("room", "")
source_file = payload.get("source_file", "")
content = payload["content"]
fts_path = os.path.join(palace_path, "fts5.db")
conn = sqlite3.connect(fts_path)
try:
    conn.execute("CREATE TABLE IF NOT EXISTS fts_meta(drawer_id TEXT PRIMARY KEY, wing TEXT, room TEXT, source_file TEXT, rowid_ref INTEGER)")
    conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(text)")
    old = conn.execute("SELECT rowid_ref FROM fts_meta WHERE drawer_id=?", (drawer_id,)).fetchone()
    if old:
        conn.execute("DELETE FROM fts WHERE rowid=?", (old[0],))
    conn.execute("INSERT INTO fts(text) VALUES(?)", (content,))
    rid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.execute("INSERT OR REPLACE INTO fts_meta VALUES(?,?,?,?,?)", (drawer_id, wing, room, source_file, rid))
    conn.commit()
    print(json.dumps({"success": True}))
except Exception as exc:
    print(json.dumps({"success": False, "error": str(exc)}))
finally:
    conn.close()
`.trim();

const DRAWER_FTS_SEARCH_SCRIPT = `
import json, sys, sqlite3, os
payload = json.loads(sys.stdin.read())
palace_path = payload["palace_path"]
query = payload["query"]
max_results = int(payload.get("max_results", 5))
wing_filter = payload.get("wing")
room_filter = payload.get("room")
fts_path = os.path.join(palace_path, "fts5.db")
if not os.path.exists(fts_path):
    print(json.dumps({"results": []}))
    sys.exit(0)
conn = sqlite3.connect(fts_path)
try:
    sql_params = [query]
    where_parts = ["f MATCH ?"]
    if wing_filter:
        where_parts.append("m.wing = ?")
        sql_params.append(wing_filter)
    if room_filter:
        where_parts.append("m.room = ?")
        sql_params.append(room_filter)
    sql_params.append(max_results)
    sql = "SELECT m.wing, m.room, m.source_file, f.text, f.rank FROM fts f JOIN fts_meta m ON m.rowid_ref = f.rowid WHERE " + " AND ".join(where_parts) + " ORDER BY f.rank LIMIT ?"
    rows = conn.execute(sql, sql_params).fetchall()
    results = []
    if rows:
        ranks = [r[4] for r in rows]
        min_r = min(ranks)
        max_r = max(ranks)
        for wing, room, src, text, rank in rows:
            if min_r == max_r:
                sim = 0.8
            else:
                sim = round(0.5 + 0.5 * (rank - max_r) / (min_r - max_r), 4)
            results.append({"text": text or "", "wing": wing or "", "room": room or "", "similarity": sim, "source_file": src})
    print(json.dumps({"results": results}))
except Exception as exc:
    if "no such table" in str(exc).lower() or "unable to open" in str(exc).lower():
        print(json.dumps({"results": []}))
    else:
        raise
finally:
    conn.close()
`.trim();

export async function writeFtsEntry(params: {
  cfg: OpenClawConfig;
  agentId: string;
  palacePath: string;
  drawerId: string;
  wing: string;
  room: string;
  content: string;
  sourceFile?: string;
}): Promise<void> {
  await runMempalacePythonJson({
    cfg: params.cfg,
    agentId: params.agentId,
    palacePath: params.palacePath,
    script: DRAWER_FTS_WRITE_SCRIPT,
    payload: {
      palace_path: params.palacePath,
      drawer_id: params.drawerId,
      wing: params.wing,
      room: params.room,
      content: params.content,
      source_file: params.sourceFile ?? "",
    },
  });
}

export async function searchFts(params: {
  cfg: OpenClawConfig;
  agentId: string;
  palacePath: string;
  query: string;
  maxResults: number;
  wing?: string;
  room?: string;
}): Promise<MempalaceDrawerHit[]> {
  const result = (await runMempalacePythonJson({
    cfg: params.cfg,
    agentId: params.agentId,
    palacePath: params.palacePath,
    script: DRAWER_FTS_SEARCH_SCRIPT,
    payload: {
      palace_path: params.palacePath,
      query: params.query,
      max_results: params.maxResults,
      ...(params.wing ? { wing: params.wing } : {}),
      ...(params.room ? { room: params.room } : {}),
    },
  })) as { results?: MempalaceDrawerHit[]; error?: string };
  return result.results ?? [];
}
