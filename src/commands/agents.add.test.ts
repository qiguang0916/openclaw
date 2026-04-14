import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseConfigSnapshot, createTestRuntime } from "./test-runtime-config-helpers.js";

const readConfigFileSnapshotMock = vi.hoisted(() => vi.fn());
const writeConfigFileMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const replaceConfigFileMock = vi.hoisted(() =>
  vi.fn(async (params: { nextConfig: unknown }) => await writeConfigFileMock(params.nextConfig)),
);

const wizardMocks = vi.hoisted(() => ({
  createClackPrompter: vi.fn(),
}));
const ensureWorkspaceAndSessionsMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mempalaceInitMocks = vi.hoisted(() => ({
  shouldUse: vi.fn(() => false),
  init: vi.fn().mockResolvedValue({
    privatePalacePath: "/tmp/mempalace/agents/work",
    privateKnowledgeGraphPath: "/tmp/mempalace/agents/work/knowledge_graph.sqlite3",
  }),
}));

vi.mock("../config/config.js", async () => ({
  ...(await vi.importActual<typeof import("../config/config.js")>("../config/config.js")),
  readConfigFileSnapshot: readConfigFileSnapshotMock,
  writeConfigFile: writeConfigFileMock,
  replaceConfigFile: replaceConfigFileMock,
}));

vi.mock("../wizard/clack-prompter.js", () => ({
  createClackPrompter: wizardMocks.createClackPrompter,
}));
vi.mock("./onboard-helpers.js", async () => ({
  ...(await vi.importActual<typeof import("./onboard-helpers.js")>("./onboard-helpers.js")),
  ensureWorkspaceAndSessions: ensureWorkspaceAndSessionsMock,
}));
vi.mock("../../extensions/mempalace-memory/api.js", () => ({
  shouldUseMempalaceSessionMemory: mempalaceInitMocks.shouldUse,
  initializeAgentMempalaceSpace: mempalaceInitMocks.init,
}));

import { WizardCancelledError } from "../wizard/prompts.js";
import { agentsAddCommand } from "./agents.js";

const runtime = createTestRuntime();

describe("agents add command", () => {
  beforeEach(() => {
    readConfigFileSnapshotMock.mockClear();
    writeConfigFileMock.mockClear();
    replaceConfigFileMock.mockClear();
    wizardMocks.createClackPrompter.mockClear();
    ensureWorkspaceAndSessionsMock.mockClear();
    mempalaceInitMocks.shouldUse.mockReset();
    mempalaceInitMocks.shouldUse.mockReturnValue(false);
    mempalaceInitMocks.init.mockClear();
    runtime.log.mockClear();
    runtime.error.mockClear();
    runtime.exit.mockClear();
  });

  it("requires --workspace when flags are present", async () => {
    readConfigFileSnapshotMock.mockResolvedValue({ ...baseConfigSnapshot });

    await agentsAddCommand({ name: "Work" }, runtime, { hasFlags: true });

    expect(runtime.error).toHaveBeenCalledWith(expect.stringContaining("--workspace"));
    expect(runtime.exit).toHaveBeenCalledWith(1);
    expect(writeConfigFileMock).not.toHaveBeenCalled();
  });

  it("requires --workspace in non-interactive mode", async () => {
    readConfigFileSnapshotMock.mockResolvedValue({ ...baseConfigSnapshot });

    await agentsAddCommand({ name: "Work", nonInteractive: true }, runtime, {
      hasFlags: false,
    });

    expect(runtime.error).toHaveBeenCalledWith(expect.stringContaining("--workspace"));
    expect(runtime.exit).toHaveBeenCalledWith(1);
    expect(writeConfigFileMock).not.toHaveBeenCalled();
  });

  it("exits with code 1 when the interactive wizard is cancelled", async () => {
    readConfigFileSnapshotMock.mockResolvedValue({ ...baseConfigSnapshot });
    wizardMocks.createClackPrompter.mockReturnValue({
      intro: vi.fn().mockRejectedValue(new WizardCancelledError()),
      text: vi.fn(),
      confirm: vi.fn(),
      note: vi.fn(),
      outro: vi.fn(),
    });

    await agentsAddCommand({}, runtime);

    expect(runtime.exit).toHaveBeenCalledWith(1);
    expect(writeConfigFileMock).not.toHaveBeenCalled();
  });

  it("initializes a private MemPalace space when mempalace-memory owns the slot", async () => {
    readConfigFileSnapshotMock.mockResolvedValue({
      ...baseConfigSnapshot,
      config: {
        plugins: {
          slots: { memory: "mempalace-memory" },
          entries: { "mempalace-memory": { enabled: true, config: {} } },
        },
        agents: { defaults: {} },
      },
      sourceConfig: {
        plugins: {
          slots: { memory: "mempalace-memory" },
          entries: { "mempalace-memory": { enabled: true, config: {} } },
        },
        agents: { defaults: {} },
      },
    });
    mempalaceInitMocks.shouldUse.mockReturnValue(true);

    await agentsAddCommand(
      {
        name: "Work",
        workspace: "/tmp/workspace-work",
        nonInteractive: true,
      },
      runtime,
    );

    expect(mempalaceInitMocks.init).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "work",
        displayName: "Work",
        workspaceDir: "/tmp/workspace-work",
      }),
    );
    expect(replaceConfigFileMock).toHaveBeenCalled();
    expect(ensureWorkspaceAndSessionsMock).toHaveBeenCalled();
  });
});
