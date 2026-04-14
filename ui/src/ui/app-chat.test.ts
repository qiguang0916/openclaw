/* @vitest-environment jsdom */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatHost } from "./app-chat.ts";

const { setLastActiveSessionKeyMock } = vi.hoisted(() => ({
  setLastActiveSessionKeyMock: vi.fn(),
}));

vi.mock("./app-settings.ts", () => ({
  setLastActiveSessionKey: (...args: unknown[]) => setLastActiveSessionKeyMock(...args),
}));

let handleSendChat: typeof import("./app-chat.ts").handleSendChat;
let handleAbortChat: typeof import("./app-chat.ts").handleAbortChat;
let resetChatSession: typeof import("./app-chat.ts").resetChatSession;
let refreshChatAvatar: typeof import("./app-chat.ts").refreshChatAvatar;
let clearPendingQueueItemsForRun: typeof import("./app-chat.ts").clearPendingQueueItemsForRun;

async function loadChatHelpers(params?: { reload?: boolean }): Promise<void> {
  if (params?.reload) {
    vi.resetModules();
  }
  ({
    handleSendChat,
    handleAbortChat,
    resetChatSession,
    refreshChatAvatar,
    clearPendingQueueItemsForRun,
  } = await import("./app-chat.ts"));
}

function makeHost(overrides?: Partial<ChatHost>): ChatHost {
  return {
    client: null,
    chatLastActivityAt: 2_000,
    chatLastActivityKind: null,
    chatMessages: [],
    chatProgressTick: 2_000,
    chatRunStartedAt: 1_000,
    chatStream: null,
    connected: true,
    chatMessage: "",
    chatAttachments: [],
    chatQueue: [],
    chatRunId: null,
    chatSending: false,
    lastError: null,
    sessionKey: "agent:main",
    basePath: "",
    hello: null,
    chatAvatarUrl: null,
    chatModelOverrides: {},
    chatModelsLoading: false,
    chatModelCatalog: [],
    refreshSessionsAfterChat: new Set<string>(),
    updateComplete: Promise.resolve(),
    ...overrides,
  };
}

describe("refreshChatAvatar", () => {
  beforeAll(async () => {
    await loadChatHelpers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a route-relative avatar endpoint before basePath bootstrap finishes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ avatarUrl: "/avatar/main" }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const host = makeHost({ basePath: "", sessionKey: "agent:main" });
    await refreshChatAvatar(host);

    expect(fetchMock).toHaveBeenCalledWith(
      "avatar/main?meta=1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(host.chatAvatarUrl).toBe("/avatar/main");
  });

  it("keeps mounted dashboard avatar endpoints under the normalized base path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const host = makeHost({ basePath: "/openclaw/", sessionKey: "agent:ops:main" });
    await refreshChatAvatar(host);

    expect(fetchMock).toHaveBeenCalledWith(
      "/openclaw/avatar/ops?meta=1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(host.chatAvatarUrl).toBeNull();
  });
});

describe("handleSendChat", () => {
  beforeAll(async () => {
    await loadChatHelpers();
  });

  beforeEach(() => {
    setLastActiveSessionKeyMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("./chat/slash-command-executor.ts");
  });

  it("keeps slash-command model changes in sync with the chat header cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      }) as unknown as typeof fetch,
    );
    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "sessions.patch") {
        return {
          ok: true,
          key: "main",
          resolved: {
            modelProvider: "openai",
            model: "gpt-5-mini",
          },
        };
      }
      if (method === "chat.history") {
        return { messages: [], thinkingLevel: null };
      }
      if (method === "sessions.list") {
        return {
          ts: 0,
          path: "",
          count: 0,
          defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
          sessions: [],
        };
      }
      if (method === "models.list") {
        return {
          models: [{ id: "gpt-5-mini", name: "GPT-5 Mini", provider: "openai" }],
        };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const onSlashAction = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "main",
      chatMessage: "/model gpt-5-mini",
      onSlashAction,
    });

    await handleSendChat(host);

    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "main",
      model: "gpt-5-mini",
    });
    expect(host.chatModelOverrides.main).toEqual({
      kind: "qualified",
      value: "openai/gpt-5-mini",
    });
    expect(onSlashAction).toHaveBeenCalledWith("refresh-tools-effective");
  });

  it("shows a visible pending item for /steer on the active run", async () => {
    vi.doMock("./chat/slash-command-executor.ts", async () => {
      const actual = await vi.importActual<typeof import("./chat/slash-command-executor.ts")>(
        "./chat/slash-command-executor.ts",
      );
      return {
        ...actual,
        executeSlashCommand: vi.fn(async () => ({
          content: "Steered.",
          pendingCurrentRun: true,
        })),
      };
    });
    await loadChatHelpers({ reload: true });

    const host = makeHost({
      client: { request: vi.fn() } as unknown as ChatHost["client"],
      chatRunId: "run-1",
      chatMessage: "/steer tighten the plan",
    });

    await handleSendChat(host);

    expect(host.chatQueue).toEqual([
      expect.objectContaining({
        text: "/steer tighten the plan",
        pendingRunId: "run-1",
      }),
    ]);
  });

  it("removes pending steer indicators when the run finishes", async () => {
    const host = makeHost({
      chatQueue: [
        {
          id: "pending",
          text: "/steer tighten the plan",
          createdAt: 1,
          pendingRunId: "run-1",
        },
        {
          id: "queued",
          text: "follow up",
          createdAt: 2,
        },
      ],
    });

    clearPendingQueueItemsForRun(host, "run-1");

    expect(host.chatQueue).toEqual([
      expect.objectContaining({
        id: "queued",
        text: "follow up",
      }),
    ]);
  });

  it("removes pending queue indicators when abort recovers a stale run", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, aborted: false, runIds: [] });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatRunId: "run-1",
      chatQueue: [
        {
          id: "pending",
          text: "/steer tighten the plan",
          createdAt: 1,
          pendingRunId: "run-1",
        },
        {
          id: "queued",
          text: "follow up",
          createdAt: 2,
        },
      ],
    });

    await handleAbortChat(host);

    expect(request).toHaveBeenCalledWith("chat.abort", {
      sessionKey: "agent:main",
      runId: "run-1",
    });
    expect(host.chatRunId).toBeNull();
    expect(host.chatQueue).toEqual([
      expect.objectContaining({
        id: "queued",
        text: "follow up",
      }),
    ]);
  });

  it("resets the current chat without starting a model turn", async () => {
    const request = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({
      messages: [],
      thinkingLevel: null,
    });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatRunId: "run-1",
      chatSending: true,
      chatStream: "thinking",
      chatMessages: [{ role: "user", content: "old" }],
      chatQueue: [{ id: "queued", text: "later", createdAt: 1 }],
    });

    const ok = await resetChatSession(host);

    expect(ok).toBe(true);
    expect(request).toHaveBeenCalledWith("sessions.reset", {
      key: "agent:main",
      emitLifecycleHooks: false,
    });
    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "agent:main",
      limit: 200,
    });
    expect(request).not.toHaveBeenCalledWith("chat.send", expect.anything());
    expect(host.chatRunId).toBeNull();
    expect(host.chatSending).toBe(false);
    expect(host.chatStream).toBeNull();
    expect(host.chatMessages).toEqual([]);
    expect(host.chatQueue).toEqual([]);
  });
});

afterAll(() => {
  vi.doUnmock("./app-settings.ts");
  vi.resetModules();
});
