import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/plugins/plugin-api.js";
import plugin from "./index.js";
import { MEMPALACE_COMPAT_TOOL_NAMES, MEMPALACE_NATIVE_TOOL_NAMES } from "./src/tools.js";

// Prevent openclaw/plugin-sdk/memory-core → memory-core-engine-runtime →
// facade-runtime → jiti from running during import. Without this mock, jiti
// synchronously compiles the full memory-core TypeScript bundle (~255 s).
vi.mock("openclaw/plugin-sdk/memory-core", () => ({
  jsonResult: (data: unknown) => ({ details: data }),
  readNumberParam: (params: Record<string, unknown>, key: string) =>
    typeof params[key] === "number" ? params[key] : undefined,
  readStringParam: (
    params: Record<string, unknown>,
    key: string,
    opts?: { required?: boolean },
  ) => {
    const v = params[key];
    if (typeof v === "string") {
      return v;
    }
    if (opts?.required) {
      throw new Error(`Missing required param: ${key}`);
    }
    return undefined;
  },
  resolveAgentWorkspaceDir: () => null,
  resolveSessionAgentId: (p: { sessionKey?: string }) =>
    p.sessionKey?.split(":").at(-1) ?? "default",
  emptyPluginConfigSchema: {},
  type: {},
}));
vi.mock("./src/bridge.js", () => ({
  callMempalaceTool: vi.fn(),
  searchDrawerMemories: vi.fn(),
  writeDrawerDirect: vi.fn(),
  writeFtsEntry: vi.fn(),
}));
vi.mock("./src/config.js", () => ({
  resolveMempalacePluginConfig: () => ({
    enabled: true,
    privatePalacePath: "/tmp/private",
    sharedPalacePath: null,
    writeShared: false,
    readShared: false,
    compatSinglePalaceMode: false,
    server: { command: "python", args: [], env: {}, enabled: true, serverName: "mempalace" },
  }),
}));
vi.mock("./src/manager.js", () => ({ getMempalaceMemorySearchManager: vi.fn() }));
vi.mock("./src/recall-events.js", () => ({ queueRecallEvent: vi.fn() }));
// Block cli.ts and flush-plan.ts host-runtime imports that trigger jiti compilation.
vi.mock("openclaw/plugin-sdk/memory-core-host-runtime-cli", () => ({
  defaultRuntime: null,
  formatDocsLink: () => "",
  formatHelpExamples: () => "",
  isRich: () => false,
  theme: {
    dim: (s: string) => s,
    bold: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
  },
}));
vi.mock("openclaw/plugin-sdk/memory-core-host-runtime-core", () => ({
  DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR: 0,
  parseNonNegativeByteSize: () => undefined,
  resolveCronStyleNow: () => new Date(),
  SILENT_REPLY_TOKEN: "__SILENT__",
  loadConfig: async () => ({}),
  resolveDefaultAgentId: () => undefined,
}));

describe("mempalace-memory plugin tool registration", () => {
  it("registers recall and native MemPalace mutation/query tools", () => {
    const registeredNames: string[] = [];
    const registeredHooks: string[] = [];
    const api = createTestPluginApi({
      registerTool(_tool, meta) {
        registeredNames.push(...(meta?.names ?? []));
      },
      on(hookName) {
        registeredHooks.push(hookName);
      },
    });

    plugin.register?.(api);

    expect(registeredNames).toEqual(
      expect.arrayContaining([
        "memory_search",
        "memory_get",
        ...MEMPALACE_COMPAT_TOOL_NAMES,
        ...MEMPALACE_NATIVE_TOOL_NAMES,
      ]),
    );
    expect(registeredHooks).toEqual(expect.arrayContaining(["before_agent_reply", "agent_end"]));
  });
});
