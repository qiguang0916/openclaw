import type { OpenClawConfig } from "openclaw/plugin-sdk/memory-core";
import { resolveAgentWorkspaceDir } from "openclaw/plugin-sdk/memory-core";
import { appendMemoryHostEvent } from "openclaw/plugin-sdk/memory-host-events";

export function queueRecallEvent(params: {
  cfg: OpenClawConfig;
  agentId: string;
  query: string;
  results: Array<{
    path: string;
    startLine: number;
    endLine: number;
    score: number;
  }>;
}): void {
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, params.agentId)?.trim();
  if (!workspaceDir || params.results.length === 0) {
    return;
  }
  void appendMemoryHostEvent(workspaceDir, {
    type: "memory.recall.recorded",
    timestamp: new Date().toISOString(),
    query: params.query,
    resultCount: params.results.length,
    results: params.results.map((result) => ({
      path: result.path,
      startLine: result.startLine,
      endLine: result.endLine,
      score: result.score,
    })),
  }).catch(() => {
    // Best-effort only. Recall event persistence must never block memory recall.
  });
}
