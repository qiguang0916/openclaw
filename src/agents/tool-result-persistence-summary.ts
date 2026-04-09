import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { collectTextContentBlocks } from "./content-blocks.js";

const EXEC_PERSIST_SUMMARY_MIN_CHARS = 6_000;
const EXEC_HEAD_SNIPPET_CHARS = 1_400;
const EXEC_TAIL_SNIPPET_CHARS = 900;
const EXEC_LIST_SUMMARY_SAMPLE_LIMIT = 5;

type ToolResultMessage = Extract<AgentMessage, { role: "toolResult" }>;

export type ToolResultPersistenceMeta = {
  toolCallId?: string;
  toolName?: string;
  isSynthetic?: boolean;
};

type ExecToolResultDetails = {
  status?: unknown;
  exitCode?: unknown;
  durationMs?: unknown;
  timedOut?: unknown;
  cwd?: unknown;
};

type GatewayConfigResultVariant =
  | {
      action: "config.get";
      hash?: string;
      path?: string;
      restart?: undefined;
      noop?: false;
      config?: Record<string, unknown>;
    }
  | {
      action: "config.patch" | "config.apply" | "config.write";
      hash?: undefined;
      path?: string;
      restart?: Record<string, unknown>;
      noop: boolean;
      config?: Record<string, unknown>;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function collectToolResultText(message: ToolResultMessage): string {
  return collectTextContentBlocks((message as { content?: unknown }).content).join("\n\n");
}

function replaceToolResultText(message: ToolResultMessage, text: string): ToolResultMessage {
  const content = Array.isArray((message as { content?: unknown }).content)
    ? ([...(message as { content: unknown[] }).content] as Array<Record<string, unknown>>)
    : [];

  let inserted = false;
  const nextContent: Array<Record<string, unknown>> = [];
  for (const block of content) {
    if (block?.type === "text") {
      if (!inserted) {
        nextContent.push({ ...block, type: "text", text });
        inserted = true;
      }
      continue;
    }
    nextContent.push(block);
  }

  if (!inserted) {
    nextContent.unshift({ type: "text", text });
  }

  return { ...message, content: nextContent } as unknown as ToolResultMessage;
}

function formatDurationMs(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  if (value < 1_000) {
    return `${Math.round(value)}ms`;
  }
  if (value < 60_000) {
    return `${(value / 1_000).toFixed(1)}s`;
  }
  return `${(value / 60_000).toFixed(1)}m`;
}

function countNonEmptyLines(text: string): number {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function detectExecListHeading(
  text: string,
): { kind: "skills" | "plugins"; heading: string } | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (/^Skills \(\d+\/\d+ ready\)$/u.test(line)) {
      return { kind: "skills", heading: line };
    }
    if (/^Plugins \(\d+\/\d+ loaded\)$/u.test(line)) {
      return { kind: "plugins", heading: line };
    }
  }
  return null;
}

type ParsedExecListEntry = {
  status: string;
  name: string;
};

function cleanExecListCell(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function extractExecListEntries(text: string, heading: string): ParsedExecListEntry[] {
  const lines = text.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  const body = lines.slice(headingIndex >= 0 ? headingIndex + 1 : 0);
  const entries: ParsedExecListEntry[] = [];

  for (const rawLine of body) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (
      trimmed.startsWith("Source roots:") ||
      /^(stock|workspace|global):/u.test(trimmed) ||
      /^[┌┬┐├┼┤└┴┘─]+$/u.test(trimmed) ||
      trimmed.startsWith("Tip:")
    ) {
      continue;
    }

    if (line.includes("│")) {
      const cells = line
        .split("│")
        .map((cell) => cleanExecListCell(cell))
        .filter(Boolean);
      if (cells.length < 2) {
        continue;
      }
      if (cells[0] === "Status" || cells[1] === "Skill" || cells[1] === "Plugin") {
        continue;
      }
      const [status, name] = cells;
      if (status && name) {
        entries.push({ status, name });
      }
      continue;
    }

    const parts = trimmed.split(/\s{2,}/u).map((part) => cleanExecListCell(part));
    if (parts.length < 2) {
      continue;
    }
    if (parts[0] === "Status" || parts[1] === "Skill" || parts[1] === "Plugin") {
      continue;
    }
    const [status, name] = parts;
    if (status && name) {
      entries.push({ status, name });
    }
  }

  return entries;
}

function formatExecListNames(names: string[]): string | undefined {
  if (names.length === 0) {
    return undefined;
  }
  const shown = names.slice(0, EXEC_LIST_SUMMARY_SAMPLE_LIMIT);
  const extra = names.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} (+${extra} more)` : shown.join(", ");
}

function isHealthyExecListStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return (
    normalized === "✓" ||
    normalized.startsWith("✓ ") ||
    normalized === "loaded" ||
    normalized.startsWith("loaded ") ||
    normalized === "ready" ||
    normalized.startsWith("ready ")
  );
}

function summarizeExecListOutput(
  text: string,
  params: { kind: "skills" | "plugins"; heading: string },
): string {
  const entries = extractExecListEntries(text, params.heading);
  const sampleNames = entries.map((entry) => entry.name);
  const notReadyNames = entries
    .filter((entry) => !isHealthyExecListStatus(entry.status))
    .map((entry) => entry.name);
  const omittedChars = Math.max(0, text.length - params.heading.length);
  const label = params.kind === "skills" ? "skill list" : "plugin list";
  const sampleLabel = params.kind === "skills" ? "Sample skills" : "Sample plugins";
  const issueLabel = params.kind === "skills" ? "Needs attention" : "Non-loaded / attention";

  return [
    `[Exec ${label} summarized for persisted transcript]`,
    `Heading: ${params.heading}`,
    ...(entries.length > 0 ? [`Entries parsed: ${entries.length}`] : []),
    ...(notReadyNames.length > 0 ? [`${issueLabel}: ${formatExecListNames(notReadyNames)}`] : []),
    ...(sampleNames.length > 0 ? [`${sampleLabel}: ${formatExecListNames(sampleNames)}`] : []),
    "",
    `[${omittedChars.toLocaleString("en-US")} characters omitted from persisted transcript; full output retained in tool details]`,
  ].join("\n");
}

function buildExecSnippetSummary(text: string): {
  head: string;
  tail?: string;
  omittedChars: number;
  omittedLines: number;
} {
  const normalized = text.trim();
  if (normalized.length <= EXEC_HEAD_SNIPPET_CHARS + EXEC_TAIL_SNIPPET_CHARS + 256) {
    return {
      head: normalized,
      omittedChars: 0,
      omittedLines: 0,
    };
  }

  const head = normalized.slice(0, EXEC_HEAD_SNIPPET_CHARS).trimEnd();
  const tail = normalized.slice(-EXEC_TAIL_SNIPPET_CHARS).trimStart();
  const omittedChars = Math.max(0, normalized.length - head.length - tail.length);
  const omittedLines = Math.max(
    0,
    countNonEmptyLines(normalized) - countNonEmptyLines(head) - countNonEmptyLines(tail),
  );
  return {
    head,
    tail,
    omittedChars,
    omittedLines,
  };
}

function summarizeExecToolResult(message: ToolResultMessage): ToolResultMessage {
  const text = collectToolResultText(message);
  if (text.length < EXEC_PERSIST_SUMMARY_MIN_CHARS) {
    return message;
  }

  const listHeading = detectExecListHeading(text);
  if (listHeading) {
    return replaceToolResultText(message, summarizeExecListOutput(text, listHeading));
  }

  const details = isRecord((message as { details?: unknown }).details)
    ? ((message as { details: ExecToolResultDetails }).details ?? {})
    : {};
  const status = trimToUndefined(details.status) ?? "completed";
  const exitCode =
    typeof details.exitCode === "number" && Number.isFinite(details.exitCode)
      ? details.exitCode
      : undefined;
  const duration = formatDurationMs(details.durationMs);
  const cwd = trimToUndefined(details.cwd);
  const timedOut = details.timedOut === true;
  const snippet = buildExecSnippetSummary(text);

  const summaryLines = [
    "[Exec output summarized for persisted transcript]",
    `Status: ${status}${exitCode !== undefined ? ` (exit ${exitCode})` : ""}${timedOut ? ", timed out" : ""}${duration ? `, ${duration}` : ""}`,
    ...(cwd ? [`cwd: ${cwd}`] : []),
    "",
    "Head excerpt:",
    snippet.head,
    ...(snippet.tail ? ["", "Tail excerpt:", snippet.tail] : []),
    "",
    `[${snippet.omittedChars.toLocaleString("en-US")} characters${snippet.omittedLines > 0 ? ` and ${snippet.omittedLines.toLocaleString("en-US")} lines` : ""} omitted from persisted transcript; full output retained in tool details]`,
  ];

  return replaceToolResultText(message, summaryLines.join("\n"));
}

function formatTopLevelKeys(config: Record<string, unknown> | undefined): string | undefined {
  if (!config) {
    return undefined;
  }
  const keys = Object.keys(config);
  if (keys.length === 0) {
    return "(empty)";
  }
  const shown = keys.slice(0, 6);
  const extra = keys.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} (+${extra} more)` : shown.join(", ");
}

function describeGatewayConfigResult(
  result: Record<string, unknown>,
): GatewayConfigResultVariant | null {
  const config = isRecord(result.config) ? result.config : undefined;
  const path = trimToUndefined(result.path);
  if (typeof result.hash === "string" && config) {
    return {
      action: "config.get",
      hash: result.hash,
      path,
      config,
    };
  }

  const restart = isRecord(result.restart) ? result.restart : undefined;
  if (!config) {
    return null;
  }

  const restartReason = trimToUndefined(restart?.reason);
  const action =
    restartReason === "config.patch"
      ? "config.patch"
      : restartReason === "config.apply"
        ? "config.apply"
        : result.noop === true
          ? "config.patch"
          : "config.write";

  return {
    action,
    path,
    restart,
    noop: result.noop === true,
    config,
  };
}

function formatGatewayRestartSummary(restart: Record<string, unknown> | undefined): string {
  if (!restart) {
    return "none";
  }
  const delayMs =
    typeof restart.delayMs === "number" && Number.isFinite(restart.delayMs)
      ? restart.delayMs
      : undefined;
  const coalesced = restart.coalesced === true;
  const reason = trimToUndefined(restart.reason);
  const parts = [
    "scheduled",
    ...(reason ? [`reason=${reason}`] : []),
    ...(delayMs !== undefined ? [`delay=${delayMs}ms`] : []),
    ...(coalesced ? ["coalesced"] : []),
  ];
  return parts.join(", ");
}

function summarizeGatewayToolResult(message: ToolResultMessage): ToolResultMessage {
  const details = isRecord((message as { details?: unknown }).details)
    ? ((message as { details: Record<string, unknown> }).details ?? {})
    : undefined;
  const result = details && isRecord(details.result) ? details.result : undefined;
  if (!result) {
    return message;
  }

  const variant = describeGatewayConfigResult(result);
  if (!variant) {
    return message;
  }

  const topLevelKeys = formatTopLevelKeys(variant.config);
  const summaryLines = [
    "[Gateway config result summarized for persisted transcript]",
    `Action: ${variant.action}`,
    `Status: ${details?.ok === true ? "ok" : "unknown"}`,
    ...(variant.hash ? [`Hash: ${variant.hash}`] : []),
    ...(variant.path ? [`Path: ${variant.path}`] : []),
    ...(topLevelKeys ? [`Config keys: ${topLevelKeys}`] : []),
    ...(variant.action === "config.patch" ||
    variant.action === "config.apply" ||
    variant.action === "config.write"
      ? [
          `Restart: ${variant.noop ? "not needed (noop)" : formatGatewayRestartSummary(variant.restart)}`,
        ]
      : []),
    "",
    "[Full config payload omitted from persisted transcript; full payload retained in tool details]",
  ];

  return replaceToolResultText(message, summaryLines.join("\n"));
}

export function summarizeToolResultForPersistence(
  message: AgentMessage,
  meta: ToolResultPersistenceMeta,
): AgentMessage {
  if ((message as { role?: unknown }).role !== "toolResult" || meta.isSynthetic) {
    return message;
  }

  const toolResult = message as ToolResultMessage;
  const toolName =
    trimToUndefined(meta.toolName) ??
    trimToUndefined((toolResult as { toolName?: unknown }).toolName);
  if (toolName === "exec") {
    return summarizeExecToolResult(toolResult);
  }
  if (toolName === "gateway") {
    return summarizeGatewayToolResult(toolResult);
  }
  return toolResult;
}
