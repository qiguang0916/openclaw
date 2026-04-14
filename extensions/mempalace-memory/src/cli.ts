import type { Command } from "commander";
import { resolveAgentWorkspaceDir } from "openclaw/plugin-sdk/memory-core";
import {
  defaultRuntime,
  formatDocsLink,
  formatHelpExamples,
  isRich,
  theme,
} from "openclaw/plugin-sdk/memory-core-host-runtime-cli";
import {
  loadConfig,
  resolveDefaultAgentId,
} from "openclaw/plugin-sdk/memory-core-host-runtime-core";
import type { MemoryHostEvent } from "openclaw/plugin-sdk/memory-host-events";
import { readMemoryHostEvents } from "openclaw/plugin-sdk/memory-host-events";
import { getActiveMemorySearchManager } from "openclaw/plugin-sdk/memory-host-search";
import { emitCliRecallEvent } from "./cli-recall.js";
import { resolveMempalaceDreamingConfig, runMempalaceDreamingNow } from "./dreaming.js";

type MemoryCommandOptions = {
  agent?: string;
  json?: boolean;
  deep?: boolean;
};

type MemorySearchCommandOptions = MemoryCommandOptions & {
  query?: string;
  maxResults?: number;
  minScore?: number;
};

type MemoryGetCommandOptions = MemoryCommandOptions & {
  path?: string;
  from?: number;
  lines?: number;
};

type MemoryDreamCommandOptions = MemoryCommandOptions;

type MemoryDreamVerifyOptions = MemoryDreamCommandOptions & {
  query?: string;
  maxResults?: number;
};

type DreamingSummary = {
  timestamp: string;
  phases: string[];
  lineCount: number;
};

function resolveAgentId(agent?: string): string {
  const trimmed = agent?.trim();
  if (trimmed) {
    return trimmed;
  }
  return resolveDefaultAgentId(loadConfig());
}

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

function formatDreamingStatusLines(params: {
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

async function runDreamingNowForCli(params: {
  cfg: ReturnType<typeof loadConfig>;
  agentId: string;
}) {
  return await runMempalaceDreamingNow({
    cfg: params.cfg,
    agentId: params.agentId,
  });
}

async function runDreamingVerifyForCli(params: {
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

async function runMemoryStatus(opts: MemoryCommandOptions) {
  const cfg = loadConfig();
  const agentId = resolveAgentId(opts.agent);
  const { manager, error } = await getActiveMemorySearchManager({
    cfg,
    agentId,
    purpose: "status",
  });
  if (!manager) {
    defaultRuntime.error(error ?? "MemPalace memory runtime unavailable.");
    return;
  }
  try {
    if (opts.deep) {
      await manager.probeVectorAvailability().catch(() => undefined);
    }
    const status = manager.status();
    if (opts.json) {
      defaultRuntime.writeJson({ agentId, status });
      return;
    }
    const lines = [
      `${color("Memory Search", theme.heading)} (${agentId})`,
      `${color("Provider:", theme.muted)} ${color(status.provider, theme.info)}`,
      `${color("Model:", theme.muted)} ${color(status.model ?? "<unknown>", theme.info)}`,
      `${color("Indexed:", theme.muted)} ${color(`${status.files ?? 0} files · ${status.chunks ?? 0} chunks`, theme.success)}`,
      `${color("Store:", theme.muted)} ${color(status.dbPath ?? "<unknown>", theme.info)}`,
    ];
    const custom = (status.custom as { mempalace?: Record<string, unknown> } | undefined)
      ?.mempalace;
    if (custom) {
      if (typeof custom.privatePalacePath === "string") {
        lines.push(
          `${color("Private palace:", theme.muted)} ${color(custom.privatePalacePath, theme.info)}`,
        );
      }
      if (
        typeof custom.sharedPalacePath === "string" &&
        custom.sharedPalacePath !== custom.privatePalacePath
      ) {
        lines.push(
          `${color("Shared palace:", theme.muted)} ${color(custom.sharedPalacePath, theme.info)}`,
        );
      }
      if (Array.isArray(custom.tools)) {
        lines.push(
          `${color("Tools:", theme.muted)} ${color(String(custom.tools.length), theme.info)}`,
        );
      }
      if (typeof custom.privateError === "string") {
        lines.push(
          `${color("Private error:", theme.muted)} ${color(custom.privateError, theme.warn)}`,
        );
      }
      if (typeof custom.sharedError === "string") {
        lines.push(
          `${color("Shared error:", theme.muted)} ${color(custom.sharedError, theme.warn)}`,
        );
      }
    }
    defaultRuntime.log(lines.join("\n"));
  } finally {
    await manager.close?.().catch(() => undefined);
  }
}

async function runMemorySearch(queryArg: string | undefined, opts: MemorySearchCommandOptions) {
  const query = opts.query ?? queryArg;
  if (!query) {
    defaultRuntime.error("Missing search query. Provide a positional query or use --query <text>.");
    return;
  }
  const cfg = loadConfig();
  const agentId = resolveAgentId(opts.agent);
  const { manager, error } = await getActiveMemorySearchManager({
    cfg,
    agentId,
  });
  if (!manager) {
    defaultRuntime.error(error ?? "MemPalace memory runtime unavailable.");
    return;
  }
  try {
    const results = await manager.search(query, {
      maxResults: opts.maxResults,
      minScore: opts.minScore,
    });
    emitCliRecallEvent({
      cfg,
      agentId,
      query,
      results,
    });
    if (opts.json) {
      defaultRuntime.writeJson({ results });
      return;
    }
    if (results.length === 0) {
      defaultRuntime.log("No matches.");
      return;
    }
    const lines: string[] = [];
    for (const result of results) {
      lines.push(
        `${color(result.score.toFixed(3), theme.success)} ${color(`${result.path}:${result.startLine}-${result.endLine}`, theme.accent)}`,
      );
      lines.push(color(result.snippet, theme.muted));
      lines.push("");
    }
    defaultRuntime.log(lines.join("\n").trim());
  } finally {
    await manager.close?.().catch(() => undefined);
  }
}

async function runMemoryGet(pathArg: string | undefined, opts: MemoryGetCommandOptions) {
  const lookupPath = opts.path ?? pathArg;
  if (!lookupPath) {
    defaultRuntime.error("Missing memory path. Provide a positional path or use --path <value>.");
    return;
  }
  const cfg = loadConfig();
  const agentId = resolveAgentId(opts.agent);
  const { manager, error } = await getActiveMemorySearchManager({
    cfg,
    agentId,
  });
  if (!manager) {
    defaultRuntime.error(error ?? "MemPalace memory runtime unavailable.");
    return;
  }
  try {
    const result = await manager.readFile({
      relPath: lookupPath,
      from: opts.from,
      lines: opts.lines,
    });
    if (opts.json) {
      defaultRuntime.writeJson(result);
      return;
    }
    defaultRuntime.log(result.text);
  } finally {
    await manager.close?.().catch(() => undefined);
  }
}

async function runMemoryDreamStatus(opts: MemoryDreamCommandOptions) {
  const cfg = loadConfig();
  const agentId = resolveAgentId(opts.agent);
  const summary = await readRecentDreamingSummary({ cfg, agentId });
  const lines = formatDreamingStatusLines({ agentId, cfg, summary });
  if (opts.json) {
    defaultRuntime.writeJson({
      agentId,
      dreaming: resolveMempalaceDreamingConfig(cfg),
      summary,
    });
    return;
  }
  defaultRuntime.log(lines.join("\n"));
}

async function runMemoryDreamNow(opts: MemoryDreamCommandOptions) {
  const cfg = loadConfig();
  const agentId = resolveAgentId(opts.agent);
  const result = await runDreamingNowForCli({ cfg, agentId });
  if (opts.json) {
    defaultRuntime.writeJson(result);
    return;
  }
  defaultRuntime.log(
    [
      `${color("Dreaming run complete", theme.success)} (${result.agentId})`,
      `${color("Workspace:", theme.muted)} ${color(result.workspaceDir, theme.info)}`,
      `${color("Focus items:", theme.muted)} ${color(String(result.aggregateCount), theme.info)}`,
      `${color("Diary topic:", theme.muted)} ${color(result.diary.topic, theme.info)}`,
      `${color("Drawer:", theme.muted)} ${color(`${result.drawer.wing} / ${result.drawer.room}`, theme.info)}`,
      `${color("KG facts:", theme.muted)} ${color(String(result.kgFacts.length), theme.info)}`,
      `${color("Verified drawer:", theme.muted)} ${color(result.verified.drawer ? "yes" : "no", result.verified.drawer ? theme.success : theme.warn)}`,
      `${color("Verified KG facts:", theme.muted)} ${color(String(result.verified.kgFacts), theme.info)}`,
    ].join("\n"),
  );
}

async function runMemoryDreamVerify(queryArg: string | undefined, opts: MemoryDreamVerifyOptions) {
  const cfg = loadConfig();
  const agentId = resolveAgentId(opts.agent);
  const query = opts.query ?? queryArg;
  const result = await runDreamingVerifyForCli({
    cfg,
    agentId,
    query,
    maxResults: opts.maxResults,
  });
  if (opts.json) {
    defaultRuntime.writeJson(result);
    return;
  }
  const lines = [
    `${color("Dreaming verify complete", theme.success)} (${result.agentId})`,
    ...(result.query ? [`${color("Query:", theme.muted)} ${color(result.query, theme.info)}`] : []),
    ...(result.searchResults
      ? [
          `${color("Search results:", theme.muted)} ${color(String(result.searchResults.length), theme.info)}`,
        ]
      : []),
    `${color("Verified drawer:", theme.muted)} ${color(result.run.verified.drawer ? "yes" : "no", result.run.verified.drawer ? theme.success : theme.warn)}`,
    `${color("Verified KG facts:", theme.muted)} ${color(String(result.run.verified.kgFacts), theme.info)}`,
    ...(result.summary
      ? [
          `${color("Last run:", theme.muted)} ${color(result.summary.timestamp, theme.info)}`,
          `${color("Last phases:", theme.muted)} ${color(result.summary.phases.join(", "), theme.info)}`,
        ]
      : []),
  ];
  defaultRuntime.log(lines.join("\n"));
}

export const __testing = {
  summarizeRecentDreamingEvents,
  readRecentDreamingSummary,
  formatDreamingStatusLines,
  runDreamingNowForCli,
  runDreamingVerifyForCli,
};

function unsupported(subcommand: string): void {
  defaultRuntime.log(
    `${subcommand} is not implemented for mempalace-memory yet. Use status/search for now; promote/index/rem-harness remain memory-core-era commands.`,
  );
}

export function registerMempalaceMemoryCli(program: Command) {
  const memory = program
    .command("memory")
    .description("Search and inspect active memory")
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples([
          ["openclaw memory status", "Show active memory runtime status."],
          ["openclaw memory dream status", "Show MemPalace dreaming status."],
          ["openclaw memory dream run", "Run one MemPalace dreaming pass now."],
          [
            'openclaw memory dream verify "memory query"',
            "Seed recall, run dreaming, and report verification.",
          ],
          ["openclaw memory status --deep", "Probe active memory runtime readiness."],
          ['openclaw memory search "meeting notes"', "Search active memory."],
          [
            'openclaw memory get "mempalace/private/kg/..."',
            "Read exact stored text for one search result.",
          ],
          [
            'openclaw memory search --query "deployment" --max-results 20',
            "Search with explicit options.",
          ],
        ])}\n\n${theme.muted("Docs:")} ${formatDocsLink("/cli/memory", "docs.openclaw.ai/cli/memory")}\n`,
    );

  memory
    .command("status")
    .description("Show active memory runtime status")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--json", "Print JSON")
    .option("--deep", "Probe runtime readiness")
    .action(async (opts: MemoryCommandOptions) => {
      await runMemoryStatus(opts);
    });

  memory
    .command("search")
    .description("Search active memory")
    .argument("[query]", "Search query")
    .option("--query <text>", "Search query (alternative to positional argument)")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--max-results <n>", "Max results", (value: string) => Number(value))
    .option("--min-score <n>", "Minimum score", (value: string) => Number(value))
    .option("--json", "Print JSON")
    .action(async (queryArg: string | undefined, opts: MemorySearchCommandOptions) => {
      await runMemorySearch(queryArg, opts);
    });

  memory
    .command("get")
    .description("Read an exact active-memory entry by path")
    .argument("[path]", "Synthetic memory path returned by memory search")
    .option("--path <value>", "Synthetic memory path (alternative to positional argument)")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--from <n>", "Starting line number", (value: string) => Number(value))
    .option("--lines <n>", "Number of lines to read", (value: string) => Number(value))
    .option("--json", "Print JSON")
    .action(async (pathArg: string | undefined, opts: MemoryGetCommandOptions) => {
      await runMemoryGet(pathArg, opts);
    });

  memory.command("dream").description("Inspect or run MemPalace-native dreaming");

  const dream = memory.commands.find((command) => command.name() === "dream");
  if (!dream) {
    throw new Error("Failed to register mempalace-memory dream CLI group.");
  }

  dream
    .command("status")
    .description("Show dreaming status")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--json", "Print JSON")
    .action(async (opts: MemoryDreamCommandOptions) => {
      await runMemoryDreamStatus(opts);
    });

  dream
    .command("run")
    .description("Run one dreaming pass now")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--json", "Print JSON")
    .action(async (opts: MemoryDreamCommandOptions) => {
      await runMemoryDreamNow(opts);
    });

  dream
    .command("verify")
    .description("Seed recall, run dreaming, and report verification")
    .argument("[query]", "Optional query to seed recall before dreaming")
    .option("--query <text>", "Query to seed recall (alternative to positional argument)")
    .option("--max-results <n>", "Max recall results to seed", (value: string) => Number(value))
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--json", "Print JSON")
    .action(async (queryArg: string | undefined, opts: MemoryDreamVerifyOptions) => {
      await runMemoryDreamVerify(queryArg, opts);
    });

  memory
    .command("index")
    .description("MemPalace uses a live store; explicit reindex is not required")
    .action(() => unsupported("memory index"));

  memory
    .command("promote")
    .description("Unsupported for mempalace-memory")
    .action(() => unsupported("memory promote"));

  memory
    .command("promote-explain")
    .description("Unsupported for mempalace-memory")
    .action(() => unsupported("memory promote-explain"));

  memory
    .command("rem-harness")
    .description("Unsupported for mempalace-memory")
    .action(() => unsupported("memory rem-harness"));
}
