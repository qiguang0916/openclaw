import { describe, expect, it, vi } from "vitest";
import { registerMempalaceDreamingCommand } from "./dreaming-command.js";

type OpenClawPluginCommandDefinition = {
  name: string;
  description: string;
  acceptsArgs?: boolean;
  handler: (ctx: PluginCommandContext) => Promise<{ text: string }>;
};

type PluginCommandContext = {
  channel: string;
  isAuthorizedSender: boolean;
  commandBody: string;
  args?: string;
  config: Record<string, unknown>;
  sessionKey?: string;
  requestConversationBinding: () => Promise<unknown>;
  detachConversationBinding: () => Promise<unknown>;
  getCurrentConversationBinding: () => Promise<unknown>;
};

type OpenClawConfig = {
  plugins?: {
    slots?: {
      memory?: string;
    };
    entries?: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>;
  };
};

type OpenClawPluginApi = {
  runtime: {
    config: {
      loadConfig: () => OpenClawConfig;
      writeConfigFile: (nextConfig: OpenClawConfig) => Promise<void>;
    };
  };
  registerCommand: (definition: OpenClawPluginCommandDefinition) => void;
};

function createHarness(initialConfig: OpenClawConfig = {}) {
  let command: OpenClawPluginCommandDefinition | undefined;
  let runtimeConfig: OpenClawConfig = initialConfig;

  const runtime = {
    config: {
      loadConfig: vi.fn(() => runtimeConfig),
      writeConfigFile: vi.fn(async (nextConfig: OpenClawConfig) => {
        runtimeConfig = nextConfig;
      }),
    },
  } as unknown as OpenClawPluginApi["runtime"];

  const api = {
    runtime,
    registerCommand: vi.fn((definition: OpenClawPluginCommandDefinition) => {
      command = definition;
    }),
  } as unknown as OpenClawPluginApi;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerMempalaceDreamingCommand(api as any);

  if (!command) {
    throw new Error("mempalace-memory did not register /dreaming");
  }

  return {
    command,
    runtime,
    getRuntimeConfig: () => runtimeConfig,
  };
}

function createCommandContext(args?: string): PluginCommandContext {
  return {
    channel: "webchat",
    isAuthorizedSender: true,
    commandBody: args ? `/dreaming ${args}` : "/dreaming",
    args,
    config: {},
    requestConversationBinding: async () => ({ status: "error", message: "unsupported" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  };
}

describe("mempalace-memory /dreaming command", () => {
  it("registers with a MemPalace-native description", () => {
    const { command } = createHarness();
    expect(command.name).toBe("dreaming");
    expect(command.acceptsArgs).toBe(true);
    expect(command.description).toContain("MemPalace-native dreaming");
  });

  it("shows status and usage when invoked without args", async () => {
    const { command } = createHarness();
    const result = await command.handler(createCommandContext());

    expect(result.text).toContain("Usage: /dreaming status");
    expect(result.text).toContain("Usage: /dreaming run");
    expect(result.text).toContain("Dreaming status:");
    expect(result.text).toContain("MemPalace diary + dreaming drawer + dreaming_focus KG facts");
  });

  it("persists enabled state under plugins.entries.mempalace-memory.config.dreaming.enabled", async () => {
    const { command, runtime, getRuntimeConfig } = createHarness({
      plugins: {
        entries: {
          "mempalace-memory": {
            config: {
              dreaming: {
                cron: "15 4 * * *",
                limit: 4,
              },
            },
          },
        },
      },
    });

    const result = await command.handler(createCommandContext("off"));

    expect(runtime.config.writeConfigFile).toHaveBeenCalledTimes(1);
    expect(
      getRuntimeConfig().plugins?.entries?.["mempalace-memory"]?.config?.dreaming,
    ).toMatchObject({
      enabled: false,
      cron: "15 4 * * *",
      limit: 4,
    });
    expect(result.text).toContain("Dreaming disabled.");
  });

  it("returns explicit status without mutating config", async () => {
    const { command, runtime } = createHarness({
      plugins: {
        entries: {
          "mempalace-memory": {
            config: {
              dreaming: {
                enabled: true,
                cron: "15 4 * * *",
                timezone: "America/Los_Angeles",
                lookbackDays: 3,
                limit: 4,
                kgThemes: 2,
              },
            },
          },
        },
      },
    });

    const result = await command.handler(createCommandContext("status"));

    expect(result.text).toContain("- enabled: on (America/Los_Angeles)");
    expect(result.text).toContain("- cron: 15 4 * * *");
    expect(result.text).toContain("- lookbackDays: 3");
    expect(result.text).toContain("- kgThemes: 2");
    expect(runtime.config.writeConfigFile).not.toHaveBeenCalled();
  });
});
