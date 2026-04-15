import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerMempalaceAutoExtract } from "./src/auto-extract.js";
import { registerMempalaceMemoryCli } from "./src/cli.js";
import { registerMempalaceDreamingCommand } from "./src/dreaming-command.js";
import { registerMempalaceDreaming } from "./src/dreaming.js";
import { buildMempalaceMemoryFlushPlan } from "./src/flush-plan.js";
import { buildPromptSection } from "./src/prompt-section.js";
import { mempalaceMemoryRuntime } from "./src/runtime-provider.js";
import {
  createMemoryDeleteTool,
  createMemoryExportTool,
  createMemoryImportTool,
  createMemoryKgQueryTool,
  createMemoryUpdateTool,
  createMempalaceAddDrawerTool,
  createMempalaceCheckDuplicateTool,
  createMempalaceDiaryReadTool,
  createMempalaceDiaryWriteTool,
  createMempalaceKgAddTool,
  createMempalaceKgInvalidateTool,
  createMempalaceKgQueryTool,
  createMempalaceKgTimelineTool,
  createMempalaceSearchTool,
  createMempalaceStatusTool,
  createMemoryGetTool,
  createMemorySearchTool,
  createMemoryStatsTool,
  createMemoryWriteTool,
} from "./src/tools.js";

export default definePluginEntry({
  id: "mempalace-memory",
  name: "MemPalace Memory",
  description:
    "MemPalace-backed active memory plugin replacement for OpenClaw memory tooling and flush paths.",
  kind: "memory",
  register(api) {
    api.registerCli(
      ({ program }) => {
        registerMempalaceMemoryCli(program);
      },
      {
        descriptors: [
          {
            name: "memory",
            description: "Search and inspect active memory",
            hasSubcommands: true,
          },
        ],
      },
    );
    registerMempalaceDreamingCommand(api);
    registerMempalaceDreaming(api);
    registerMempalaceAutoExtract(api);
    api.registerMemoryPromptSection(buildPromptSection);
    api.registerMemoryFlushPlan(buildMempalaceMemoryFlushPlan);
    api.registerMemoryRuntime(mempalaceMemoryRuntime);

    api.registerTool(
      (ctx) =>
        createMemorySearchTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["memory_search"],
      },
    );

    api.registerTool(
      (ctx) =>
        createMemoryGetTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["memory_get"],
      },
    );

    api.registerTool(
      (ctx) =>
        createMemoryWriteTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["memory_write"],
      },
    );

    api.registerTool(
      (ctx) =>
        createMemoryKgQueryTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["memory_kg_query"],
      },
    );

    api.registerTool(
      (ctx) =>
        createMemoryStatsTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["memory_stats"],
      },
    );

    api.registerTool(
      (ctx) =>
        createMemoryUpdateTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["memory_update"],
      },
    );

    api.registerTool(
      (ctx) =>
        createMemoryDeleteTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["memory_delete"],
      },
    );

    api.registerTool(
      (ctx) =>
        createMemoryExportTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["memory_export"],
      },
    );

    api.registerTool(
      (ctx) =>
        createMemoryImportTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["memory_import"],
      },
    );

    api.registerTool(
      (ctx) =>
        createMempalaceStatusTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["mempalace_status"],
      },
    );

    api.registerTool(
      (ctx) =>
        createMempalaceSearchTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["mempalace_search"],
      },
    );

    api.registerTool(
      (ctx) =>
        createMempalaceCheckDuplicateTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["mempalace_check_duplicate"],
      },
    );

    api.registerTool(
      (ctx) =>
        createMempalaceAddDrawerTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["mempalace_add_drawer"],
      },
    );

    api.registerTool(
      (ctx) =>
        createMempalaceKgQueryTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["mempalace_kg_query"],
      },
    );

    api.registerTool(
      (ctx) =>
        createMempalaceKgAddTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["mempalace_kg_add"],
      },
    );

    api.registerTool(
      (ctx) =>
        createMempalaceKgInvalidateTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["mempalace_kg_invalidate"],
      },
    );

    api.registerTool(
      (ctx) =>
        createMempalaceKgTimelineTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["mempalace_kg_timeline"],
      },
    );

    api.registerTool(
      (ctx) =>
        createMempalaceDiaryReadTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["mempalace_diary_read"],
      },
    );

    api.registerTool(
      (ctx) =>
        createMempalaceDiaryWriteTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      {
        names: ["mempalace_diary_write"],
      },
    );
  },
});
