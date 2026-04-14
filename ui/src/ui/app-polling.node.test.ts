import { beforeAll, describe, expect, it, vi } from "vitest";
import { checkForStaleChatRun } from "./app-polling.ts";

const loadChatHistoryMock = vi.hoisted(() => vi.fn(async () => undefined));
const flushChatQueueForEventMock = vi.hoisted(() => vi.fn());
const clearPendingQueueItemsForRunMock = vi.hoisted(() => vi.fn());
const resetToolStreamMock = vi.hoisted(() => vi.fn());

vi.mock("./controllers/chat.ts", () => ({
  loadChatHistory: loadChatHistoryMock,
}));

vi.mock("./app-chat.ts", () => ({
  clearPendingQueueItemsForRun: (...args: unknown[]) => clearPendingQueueItemsForRunMock(...args),
  flushChatQueueForEvent: (...args: unknown[]) => flushChatQueueForEventMock(...args),
}));

vi.mock("./app-tool-stream.ts", () => ({
  resetToolStream: (...args: unknown[]) => resetToolStreamMock(...args),
}));

function createHost(overrides: Record<string, unknown> = {}) {
  return {
    tab: "chat",
    connected: true,
    client: {},
    chatWatchdogInterval: null,
    chatLastActivityAt: 0,
    chatLoading: false,
    chatManualRefreshInFlight: false,
    chatMessages: [],
    chatRunId: "run-1",
    chatRunStartedAt: 1_000,
    chatSending: false,
    chatStaleRecoveryInFlight: false,
    chatStream: "",
    chatStreamStartedAt: 1_000,
    chatToolMessages: [],
    sessionKey: "main",
    ...overrides,
  };
}

describe("checkForStaleChatRun", () => {
  beforeAll(() => {
    const globalWithWindow = globalThis as typeof globalThis & {
      window?: Window & typeof globalThis;
    };
    if (!globalWithWindow.window) {
      globalWithWindow.window = globalThis as unknown as Window & typeof globalThis;
    }
  });

  it("recovers a stale chat run with no observable activity", async () => {
    loadChatHistoryMock.mockClear();
    flushChatQueueForEventMock.mockClear();
    clearPendingQueueItemsForRunMock.mockClear();
    resetToolStreamMock.mockClear();

    const host = createHost();
    const recovered = await checkForStaleChatRun(host as never, 31_500);

    expect(recovered).toBe(true);
    expect(host.chatRunId).toBeNull();
    expect(host.chatRunStartedAt).toBe(0);
    expect(host.chatStream).toBeNull();
    expect(host.chatStreamStartedAt).toBeNull();
    expect(clearPendingQueueItemsForRunMock).toHaveBeenCalledWith(host, "run-1");
    expect(resetToolStreamMock).toHaveBeenCalledWith(host);
    expect(loadChatHistoryMock).toHaveBeenCalledWith(host);
    expect(flushChatQueueForEventMock).toHaveBeenCalledWith(host);
    expect(host.chatManualRefreshInFlight).toBe(false);
    expect(host.chatStaleRecoveryInFlight).toBe(false);
  });

  it("does not recover a fresh chat run", async () => {
    loadChatHistoryMock.mockClear();
    const host = createHost();

    const recovered = await checkForStaleChatRun(host as never, 20_000);

    expect(recovered).toBe(false);
    expect(loadChatHistoryMock).not.toHaveBeenCalled();
    expect(host.chatRunId).toBe("run-1");
  });

  it("uses a longer timeout after visible tool activity", async () => {
    loadChatHistoryMock.mockClear();
    const host = createHost({
      chatLastActivityAt: 10_000,
      chatToolMessages: [{ role: "assistant" }],
    });

    const recovered = await checkForStaleChatRun(host as never, 50_000);

    expect(recovered).toBe(false);
    expect(loadChatHistoryMock).not.toHaveBeenCalled();
  });

  it("recovers a stale chat run even when streamStartedAt is already cleared", async () => {
    loadChatHistoryMock.mockClear();
    const host = createHost({
      chatRunStartedAt: 1_000,
      chatStream: null,
      chatStreamStartedAt: null,
    });

    const recovered = await checkForStaleChatRun(host as never, 31_500);

    expect(recovered).toBe(true);
    expect(loadChatHistoryMock).toHaveBeenCalledWith(host);
    expect(host.chatRunId).toBeNull();
  });

  it("recovers an orphaned run soon after a visible assistant reply when no new activity follows", async () => {
    loadChatHistoryMock.mockClear();
    const host = createHost({
      chatRunStartedAt: 1_000,
      chatLastActivityAt: 1_000,
      chatStream: null,
      chatStreamStartedAt: null,
      chatMessages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "我正在收集测试数据。" }],
          timestamp: 2_000,
        },
      ],
    });

    const recovered = await checkForStaleChatRun(host as never, 14_500);

    expect(recovered).toBe(true);
    expect(loadChatHistoryMock).toHaveBeenCalledWith(host);
    expect(host.chatRunId).toBeNull();
  });
});
