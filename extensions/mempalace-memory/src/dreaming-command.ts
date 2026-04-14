import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk/memory-core";
import { resolveMempalaceDreamingConfig } from "./dreaming-config.js";

type DreamingRunTarget =
  | {
      ok: true;
      agentId: string;
      workspaceDir: string;
    }
  | {
      ok: false;
      reason: string;
    };

function isActiveMempalaceMemorySlot(cfg: OpenClawConfig): boolean {
  const activeSlot =
    typeof cfg.plugins?.slots?.memory === "string" ? cfg.plugins.slots.memory.trim() : "";
  if (activeSlot !== "mempalace-memory") {
    return false;
  }
  return cfg.plugins?.entries?.["mempalace-memory"]?.enabled !== false;
}

function updateDreamingEnabledInConfig(cfg: OpenClawConfig, enabled: boolean): OpenClawConfig {
  const entries = { ...cfg.plugins?.entries };
  const existingEntry =
    entries["mempalace-memory"] && typeof entries["mempalace-memory"] === "object"
      ? (entries["mempalace-memory"] as Record<string, unknown>)
      : {};
  const existingConfig =
    existingEntry.config && typeof existingEntry.config === "object"
      ? (existingEntry.config as Record<string, unknown>)
      : {};
  const existingDreaming =
    existingConfig.dreaming && typeof existingConfig.dreaming === "object"
      ? (existingConfig.dreaming as Record<string, unknown>)
      : {};
  entries["mempalace-memory"] = {
    ...existingEntry,
    config: {
      ...existingConfig,
      dreaming: {
        ...existingDreaming,
        enabled,
      },
    },
  };
  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      entries,
    },
  };
}

function formatDreamingStatus(cfg: OpenClawConfig): string {
  const dreaming = resolveMempalaceDreamingConfig(cfg);
  const timezone = dreaming.timezone ? ` (${dreaming.timezone})` : "";
  return [
    "Dreaming status:",
    `- enabled: ${dreaming.enabled ? "on" : "off"}${timezone}`,
    `- cron: ${dreaming.cron}`,
    `- lookbackDays: ${dreaming.lookbackDays}`,
    `- limit: ${dreaming.limit}`,
    `- kgThemes: ${dreaming.kgThemes}`,
    "- outputs: MemPalace diary + dreaming drawer + dreaming_focus KG facts",
  ].join("\n");
}

async function resolveDreamingRunTarget(params: {
  cfg: OpenClawConfig;
  sessionKey?: string;
}): Promise<DreamingRunTarget> {
  if (!isActiveMempalaceMemorySlot(params.cfg)) {
    return {
      ok: false,
      reason: "Dreaming run unavailable because mempalace-memory is not the active memory slot.",
    };
  }
  const [{ resolveAgentWorkspaceDir, resolveDefaultAgentId }, { resolveAgentIdFromSessionKey }] =
    await Promise.all([
      import("openclaw/plugin-sdk/memory-core"),
      import("openclaw/plugin-sdk/routing"),
    ]);
  const agentId =
    resolveAgentIdFromSessionKey(params.sessionKey) || resolveDefaultAgentId(params.cfg);
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, agentId);
  if (!workspaceDir) {
    return {
      ok: false,
      reason: `Dreaming run skipped: no workspace found for ${agentId}.`,
    };
  }
  return {
    ok: true,
    agentId,
    workspaceDir,
  };
}

export function registerMempalaceDreamingCommand(api: OpenClawPluginApi): void {
  api.registerCommand({
    name: "dreaming",
    description: "Enable or disable MemPalace-native dreaming.",
    acceptsArgs: true,
    handler: async (ctx) => {
      const args = (ctx.args ?? "").trim().toLowerCase();
      const currentConfig = api.runtime.config.loadConfig();
      if (!args || args === "status" || args === "help") {
        return {
          text: [
            "Usage: /dreaming status",
            "Usage: /dreaming run",
            "Usage: /dreaming on|off",
            "",
            formatDreamingStatus(currentConfig),
          ].join("\n"),
        };
      }
      if (args === "run") {
        const target = await resolveDreamingRunTarget({
          cfg: currentConfig,
          sessionKey: ctx.sessionKey,
        });
        if (!target.ok) {
          return { text: target.reason };
        }
        const { runMempalaceDreamingNow } = await import("./dreaming.js");
        await runMempalaceDreamingNow({
          cfg: currentConfig,
          agentId: target.agentId,
        });
        return {
          text: `Dreaming run complete for ${target.agentId}.\n\n${formatDreamingStatus(currentConfig)}`,
        };
      }
      if (args === "on" || args === "off") {
        const nextConfig = updateDreamingEnabledInConfig(currentConfig, args === "on");
        await api.runtime.config.writeConfigFile(nextConfig);
        return {
          text: `Dreaming ${args === "on" ? "enabled" : "disabled"}.\n\n${formatDreamingStatus(nextConfig)}`,
        };
      }
      return { text: formatDreamingStatus(currentConfig) };
    },
  });
}
