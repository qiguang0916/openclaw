import type { OpenClawConfig } from "openclaw/plugin-sdk/memory-core";
import type { MemorySearchResult } from "openclaw/plugin-sdk/memory-core-host-runtime-files";
import { queueRecallEvent } from "./recall-events.js";

export function emitCliRecallEvent(params: {
  cfg: OpenClawConfig;
  agentId: string;
  query: string;
  results: MemorySearchResult[];
}): void {
  queueRecallEvent({
    cfg: params.cfg,
    agentId: params.agentId,
    query: params.query,
    results: params.results.map((result) => ({
      path: result.path,
      startLine: result.startLine,
      endLine: result.endLine,
      score: result.score,
    })),
  });
}
