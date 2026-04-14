import { isRich, theme } from "openclaw/plugin-sdk/memory-core-host-runtime-cli";
import { loadConfig } from "openclaw/plugin-sdk/memory-core-host-runtime-core";
import type { MemoryHostEvent } from "openclaw/plugin-sdk/memory-host-events";
import {
  emitCliRecallEvent,
  getActiveMemorySearchManager,
  readMemoryHostEvents,
  resolveAgentWorkspaceDir,
  runMempalaceDreamingNow,
} from "./cli-dreaming.runtime.js";
import { resolveMempalaceDreamingConfig } from "./dreaming-config.js";

type DreamingSummary = {
  timestamp: string;
  phases: string[];
  lineCount: number;
};

function color(text: string, colorFn: (input: string) => string): string {
  return isRich() ? colorFn(text) : text;
}

function summarizeRecentDreamingEvents(events: MemoryHostEvent[]): DreamingSummary | null {
  const completed = events.filter(
    (event): event is Extract<MemoryHostEvent, { type: "memory.dream.completed" }> =>
      event.type === "memory.dream.completed",
  );
  if (completed.length === 0) {
    return null;
  }
  const latestTimestamp = completed.at(-1)?.timestamp;
  if (!latestTimestamp) {
    return null;
  }
  const latestBatch = completed.filter((event) => event.timestamp === latestTimestamp);
  return {
    timestamp: latestTimestamp,
    phases: latestBatch.map((event) => event.phase),
    lineCount: latestBatch.reduce((sum, event) => sum + event.lineCount, 0),
  };
}

async function readRecentDreamingSummary(params: {
  cfg: ReturnType<typeof loadConfig>;
  agentId: string;
}): Promise<DreamingSummary | null> {
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, params.agentId);
  if (!workspaceDir) {
    return null;
  }
  const events = await readMemoryHostEvents({
    workspaceDir,
    limit: 40,
  });
  return summarizeRecentDreamingEvents(events);
}

export function formatDreamingStatusLines(params: {
  agentId: string;
  cfg: ReturnType<typeof loadConfig>;
  summary?: DreamingSummary | null;
}): string[] {
  const dreaming = resolveMempalaceDreamingConfig(params.cfg);
  const timezone = dreaming.timezone ? ` (${dreaming.timezone})` : "";
  const lines = [
    `${color("Dreaming", theme.heading)} (${params.agentId})`,
    `${color("Enabled:", theme.muted)} ${color(dreaming.enabled ? `on${timezone}` : `off${timezone}`, dreaming.enabled ? theme.success : theme.warn)}`,
    `${color("Cron:", theme.muted)} ${color(dreaming.cron, theme.info)}`,
    `${color("Lookback:", theme.muted)} ${color(`${dreaming.lookbackDays} day(s)`, theme.info)}`,
    `${color("Limit:", theme.muted)} ${color(String(dreaming.limit), theme.info)}`,
    `${color("kgThemes:", theme.muted)} ${color(String(dreaming.kgThemes), theme.info)}`,
  ];
  if (params.summary) {
    lines.push(
      `${color("Last run:", theme.muted)} ${color(params.summary.timestamp, theme.info)}`,
      `${color("Last phases:", theme.muted)} ${color(params.summary.phases.join(", "), theme.info)}`,
      `${color("Last lines:", theme.muted)} ${color(String(params.summary.lineCount), theme.info)}`,
    );
  }
  return lines;
}

export async function runDreamingNowForCli(params: {
  cfg: ReturnType<typeof loadConfig>;
  agentId: string;
}) {
  return await runMempalaceDreamingNow({
    cfg: params.cfg,
    agentId: params.agentId,
  });
}

export async function runDreamingVerifyForCli(params: {
  cfg: ReturnType<typeof loadConfig>;
  agentId: string;
  query?: string;
  maxResults?: number;
}) {
  let searchResults:
    | Array<{
        path: string;
        startLine: number;
        endLine: number;
        score: number;
      }>
    | undefined;
  const query = params.query?.trim();
  if (query) {
    const { manager, error } = await getActiveMemorySearchManager({
      cfg: params.cfg,
      agentId: params.agentId,
    });
    if (!manager) {
      throw new Error(error ?? "MemPalace memory runtime unavailable.");
    }
    try {
      const results = await manager.search(query, {
        maxResults: params.maxResults,
      });
      emitCliRecallEvent({
        cfg: params.cfg,
        agentId: params.agentId,
        query,
        results,
      });
      searchResults = results.map((result) => ({
        path: result.path,
        startLine: result.startLine,
        endLine: result.endLine,
        score: result.score,
      }));
    } finally {
      await manager.close?.().catch(() => undefined);
    }
  }

  const run = await runDreamingNowForCli({
    cfg: params.cfg,
    agentId: params.agentId,
  });
  const summary = await readRecentDreamingSummary({
    cfg: params.cfg,
    agentId: params.agentId,
  });
  return {
    agentId: params.agentId,
    ...(query ? { query } : {}),
    ...(searchResults ? { searchResults } : {}),
    run,
    summary,
  };
}

export const cliDreamingTesting = {
  formatDreamingStatusLines,
  runDreamingNowForCli,
  runDreamingVerifyForCli,
};
