import { describe, expect, it, vi } from "vitest";
import { GatewayRequestError } from "../gateway.ts";
import {
  abortChatRun,
  handleChatEvent,
  loadChatHistory,
  sendChatMessage,
  type ChatEventPayload,
  type ChatState,
} from "./chat.ts";

function createState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    chatAttachments: [],
    chatLoading: false,
    chatMessage: "",
    chatMessages: [],
    chatRunId: null,
    chatSending: false,
    chatStream: null,
    chatStreamStartedAt: null,
    chatThinkingLevel: null,
    client: null,
    connected: true,
    lastError: null,
    sessionKey: "main",
    ...overrides,
  };
}

function createActiveStreamingState() {
  return createState({
    sessionKey: "main",
    chatRunId: "run-user",
    chatStream: "Working...",
    chatStreamStartedAt: 123,
  });
}

function createOtherRunNoReplyFinalPayload(): ChatEventPayload {
  return {
    runId: "run-announce",
    sessionKey: "main",
    state: "final",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "NO_REPLY" }],
    },
  };
}

describe("handleChatEvent", () => {
  it("returns null when payload is missing", () => {
    const state = createState();
    expect(handleChatEvent(state, undefined)).toBe(null);
  });

  it("returns null when sessionKey does not match", () => {
    const state = createState({ sessionKey: "main" });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "other",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe(null);
  });

  it("returns null for delta from another run", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Hello",
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Hello");
  });

  it("ignores NO_REPLY delta updates", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Hello",
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "NO_REPLY" }] },
    };

    expect(handleChatEvent(state, payload)).toBe("delta");
    expect(state.chatStream).toBe("Hello");
  });

  it("appends final payload from another run without clearing active stream", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Sub-agent findings" }],
      },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Working...");
    expect(state.chatStreamStartedAt).toBe(123);
    expect(state.chatMessages).toHaveLength(1);
    expect(state.chatMessages[0]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Sub-agent findings" }],
      __openclaw: { clientRunId: "run-announce" },
    });
  });

  it("drops NO_REPLY final payload from another run without clearing active stream", () => {
    const state = createActiveStreamingState();
    const payload = createOtherRunNoReplyFinalPayload();

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Working...");
    expect(state.chatStreamStartedAt).toBe(123);
    expect(state.chatMessages).toEqual([]);
  });

  it("replaces the stream when a delta snapshot gets shorter", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Alpha beta",
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "delta",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Alpha" }],
      },
    };
    expect(handleChatEvent(state, payload)).toBe("delta");
    expect(state.chatStream).toBe("Alpha");
  });

  it("returns final for another run when payload has no message", () => {
    const state = createActiveStreamingState();
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatMessages).toEqual([]);
  });

  it("persists streamed text when final event carries no message", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Here is my reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual(existingMessage);
    expect(state.chatMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Here is my reply" }],
    });
  });

  it("does not persist empty or whitespace-only stream on final", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "   ",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatMessages).toEqual([]);
  });

  it("does not persist null stream on final with no message", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: null,
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([]);
  });

  it("prefers final payload message over streamed text", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Streamed partial",
      chatStreamStartedAt: 100,
    });
    const finalMsg = {
      role: "assistant",
      content: [{ type: "text", text: "Complete reply" }],
      timestamp: 101,
    };
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: finalMsg,
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: [{ type: "text", text: "Complete reply" }],
        timestamp: 101,
        __openclaw: { clientRunId: "run-1" },
      }),
    ]);
    expect(state.chatStream).toBe(null);
  });

  it("appends final payload message from own run before clearing stream state", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Reply",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Reply" }],
        timestamp: 101,
      },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: [{ type: "text", text: "Reply" }],
        timestamp: 101,
        __openclaw: { clientRunId: "run-1" },
      }),
    ]);
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
  });

  it("does not duplicate repeated final payload messages for the same run", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Reply",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Reply" }],
        timestamp: 101,
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    state.chatRunId = "run-1";
    state.chatStream = "Reply";
    state.chatStreamStartedAt = 102;
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: [{ type: "text", text: "Reply" }],
        timestamp: 101,
        __openclaw: { clientRunId: "run-1" },
      }),
    ]);
  });

  it("replaces a recent assistant progress message when the next one extends it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T09:53:05Z"));

    const firstMessage = {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "我正在收集测试数据，还需要运行几组关键测试用例。让我继续完成测试。",
        },
      ],
      timestamp: Date.now() - 2000,
    };
    const state = createState({
      sessionKey: "main",
      chatMessages: [firstMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-progress-2",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "我正在收集测试数据，还需要运行几组关键测试用例。让我继续完成测试。数据收集完成。现在整理报告：",
          },
        ],
        timestamp: Date.now(),
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: [
          {
            type: "text",
            text: "我正在收集测试数据，还需要运行几组关键测试用例。让我继续完成测试。数据收集完成。现在整理报告：",
          },
        ],
        __openclaw: { clientRunId: "run-progress-2" },
      }),
    ]);

    vi.useRealTimers();
  });

  it("replaces an adjacent assistant duplicate even when the update arrives under a different run", () => {
    const previousMessage = {
      role: "assistant",
      content: [{ type: "text", text: "第一步：确认控制UI的显示问题" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatMessages: [previousMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-announce-2",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "第一步：确认控制UI的显示问题\n\n现在开始检查网关状态。" }],
        timestamp: 2,
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: [{ type: "text", text: "第一步：确认控制UI的显示问题\n\n现在开始检查网关状态。" }],
        __openclaw: { clientRunId: "run-announce-2" },
      }),
    ]);
  });

  it("replaces repeated final payloads that share the same __openclaw id", () => {
    const firstMessage = {
      role: "assistant",
      content: [{ type: "text", text: "短回复" }],
      timestamp: 1,
      __openclaw: { id: "msg-1" },
    };
    const state = createState({
      sessionKey: "main",
      chatMessages: [firstMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-announce-2",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "短回复，带更多细节" }],
        timestamp: 2,
        __openclaw: { id: "msg-1" },
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: [{ type: "text", text: "短回复，带更多细节" }],
        __openclaw: { id: "msg-1", clientRunId: "run-announce-2" },
      }),
    ]);
  });

  it("processes aborted from own run and keeps partial assistant message", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const partialMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
      timestamp: 2,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: partialMessage,
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toEqual([
      existingMessage,
      expect.objectContaining({
        role: "assistant",
        content: [{ type: "text", text: "Partial reply" }],
        timestamp: 2,
        __openclaw: { clientRunId: "run-1" },
      }),
    ]);
  });

  it("falls back to streamed partial when aborted payload message is invalid", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: "not-an-assistant-message",
    } as unknown as ChatEventPayload;

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual(existingMessage);
    expect(state.chatMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
    });
  });

  it("falls back to streamed partial when aborted payload has non-assistant role", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: {
        role: "user",
        content: [{ type: "text", text: "unexpected" }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
    });
  });

  it("processes aborted from own run without message and empty stream", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toEqual([existingMessage]);
  });

  it("drops NO_REPLY final payload from another run", () => {
    const state = createActiveStreamingState();
    const payload = createOtherRunNoReplyFinalPayload();

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([]);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Working...");
  });

  it("drops NO_REPLY final payload from own run", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "NO_REPLY",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "NO_REPLY" }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([]);
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
  });

  it("does not persist NO_REPLY stream text on final without message", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "NO_REPLY",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };

    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([]);
  });

  it("does not persist NO_REPLY stream text on abort", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "NO_REPLY",
      chatStreamStartedAt: 100,
    });
    const payload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: "not-an-assistant-message",
    } as unknown as ChatEventPayload;

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatMessages).toEqual([]);
  });

  it("keeps user messages containing NO_REPLY text", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
      message: {
        role: "user",
        content: [{ type: "text", text: "NO_REPLY" }],
      },
    };

    // User messages with NO_REPLY text should NOT be filtered — only assistant messages.
    // normalizeFinalAssistantMessage returns null for user role, so this falls through.
    expect(handleChatEvent(state, payload)).toBe("final");
  });

  it("keeps assistant message when text field has real reply but content is NO_REPLY", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        text: "real reply",
        content: "NO_REPLY",
      },
    };

    // entry.text takes precedence — "real reply" is NOT silent, so the message is kept.
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toHaveLength(1);
  });
});

describe("loadChatHistory", () => {
  it("filters NO_REPLY assistant messages from history", async () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: [{ type: "text", text: "NO_REPLY" }] },
      { role: "assistant", content: [{ type: "text", text: "Real answer" }] },
      { role: "assistant", text: "  NO_REPLY  " },
    ];
    const mockClient = {
      request: vi.fn().mockResolvedValue({ messages, thinkingLevel: "low" }),
    };
    const state = createState({
      client: mockClient as unknown as ChatState["client"],
      connected: true,
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual(messages[0]);
    expect(state.chatMessages[1]).toEqual(messages[2]);
    expect(state.chatThinkingLevel).toBe("low");
    expect(state.chatLoading).toBe(false);
  });

  it("preserves the optimistic user message while an active run is waiting for history", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [{ role: "assistant", content: [{ type: "text", text: "old answer" }] }],
      thinkingLevel: "off",
    });
    const optimistic = {
      role: "user",
      optimisticRunId: "run-1",
      content: [{ type: "text", text: "你是哪个模型" }],
      timestamp: 123,
    };
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatRunId: "run-1",
      chatMessages: [optimistic],
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "old answer" }] },
      optimistic,
    ]);
  });

  it("does not duplicate the optimistic user message after history already contains it", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "metadata\n\n你是哪个模型" }],
        },
      ],
      thinkingLevel: "off",
    });
    const optimistic = {
      role: "user",
      optimisticRunId: "run-1",
      content: [{ type: "text", text: "你是哪个模型" }],
      timestamp: 123,
    };
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatRunId: "run-1",
      chatMessages: [optimistic],
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "metadata\n\n你是哪个模型" }],
      },
    ]);
  });

  it("keeps assistant message when text field has real content but content is NO_REPLY", async () => {
    const messages = [{ role: "assistant", text: "real reply", content: "NO_REPLY" }];
    const mockClient = {
      request: vi.fn().mockResolvedValue({ messages }),
    };
    const state = createState({
      client: mockClient as unknown as ChatState["client"],
      connected: true,
    });

    await loadChatHistory(state);

    // text takes precedence — "real reply" is NOT silent, so message is kept.
    expect(state.chatMessages).toHaveLength(1);
  });

  it("dedupes consecutive assistant duplicates when loading history", async () => {
    const messages = [
      { role: "assistant", content: [{ type: "text", text: "same answer" }], timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "same answer" }], timestamp: 2 },
      { role: "assistant", content: [{ type: "text", text: "new answer" }], timestamp: 3 },
    ];
    const mockClient = {
      request: vi.fn().mockResolvedValue({ messages, thinkingLevel: "low" }),
    };
    const state = createState({
      client: mockClient as unknown as ChatState["client"],
      connected: true,
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([messages[1], messages[2]]);
  });

  it("merges adjacent assistant history entries when the newer one extends the older text", async () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "让我先检查控制UI的具体显示情况。" }],
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "让我先检查控制UI的具体显示情况。然后再执行相应的操作。" }],
        timestamp: 2,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "最终结论" }],
        timestamp: 3,
      },
    ];
    const mockClient = {
      request: vi.fn().mockResolvedValue({ messages, thinkingLevel: "low" }),
    };
    const state = createState({
      client: mockClient as unknown as ChatState["client"],
      connected: true,
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([messages[1], messages[2]]);
  });

  it("merges adjacent assistant history entries that share the same __openclaw id", async () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "短回复" }],
        timestamp: 1,
        __openclaw: { id: "msg-1" },
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "短回复，带更多细节" }],
        timestamp: 2,
        __openclaw: { id: "msg-1" },
      },
    ];
    const mockClient = {
      request: vi.fn().mockResolvedValue({ messages, thinkingLevel: "low" }),
    };
    const state = createState({
      client: mockClient as unknown as ChatState["client"],
      connected: true,
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([messages[1]]);
  });
});

describe("sendChatMessage", () => {
  it("formats structured non-auth connect failures for chat send", async () => {
    const request = vi.fn().mockRejectedValue(
      new GatewayRequestError({
        code: "INVALID_REQUEST",
        message: "Fetch failed",
        details: { code: "CONTROL_UI_ORIGIN_NOT_ALLOWED" },
      }),
    );
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    const result = await sendChatMessage(state, "hello");

    expect(result).toBeNull();
    expect(state.lastError).toContain("origin not allowed");
    expect(state.chatMessages.at(-1)).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "text",
          text: expect.stringContaining("origin not allowed"),
        },
      ],
    });
  });
});

describe("abortChatRun", () => {
  it("clears stale local run state after a successful abort request", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, aborted: false, runIds: [] });
    const state = createState({
      connected: true,
      chatRunId: "run-1",
      chatSending: true,
      chatStreamStartedAt: 123,
      client: { request } as unknown as ChatState["client"],
    });

    const result = await abortChatRun(state);

    expect(result).toBe(true);
    expect(request).toHaveBeenCalledWith("chat.abort", {
      sessionKey: "main",
      runId: "run-1",
    });
    expect(state.chatRunId).toBeNull();
    expect(state.chatSending).toBe(false);
    expect(state.chatStreamStartedAt).toBeNull();
  });

  it("formats structured non-auth connect failures for chat abort", async () => {
    // Abort now shares the same structured connect-error formatter as send.
    const request = vi.fn().mockRejectedValue(
      new GatewayRequestError({
        code: "INVALID_REQUEST",
        message: "Fetch failed",
        details: { code: "CONTROL_UI_DEVICE_IDENTITY_REQUIRED" },
      }),
    );
    const state = createState({
      connected: true,
      chatRunId: "run-1",
      client: { request } as unknown as ChatState["client"],
    });

    const result = await abortChatRun(state);

    expect(result).toBe(false);
    expect(request).toHaveBeenCalledWith("chat.abort", {
      sessionKey: "main",
      runId: "run-1",
    });
    expect(state.lastError).toContain("device identity required");
  });
});

describe("loadChatHistory", () => {
  it("filters assistant NO_REPLY messages and keeps user NO_REPLY messages", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [
        { role: "assistant", content: [{ type: "text", text: "NO_REPLY" }] },
        { role: "assistant", content: [{ type: "text", text: "visible answer" }] },
        { role: "user", content: [{ type: "text", text: "NO_REPLY" }] },
      ],
      thinkingLevel: "low",
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "main",
      limit: 200,
    });
    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "visible answer" }] },
      { role: "user", content: [{ type: "text", text: "NO_REPLY" }] },
    ]);
    expect(state.chatThinkingLevel).toBe("low");
    expect(state.chatLoading).toBe(false);
    expect(state.lastError).toBeNull();
  });

  it("shows a targeted message when chat history is unauthorized", async () => {
    const request = vi.fn().mockRejectedValue(
      new GatewayRequestError({
        code: "PERMISSION_DENIED",
        message: "not allowed",
        details: { code: "AUTH_UNAUTHORIZED" },
      }),
    );
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatMessages: [{ role: "assistant", content: [{ type: "text", text: "old" }] }],
      chatThinkingLevel: "high",
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([]);
    expect(state.chatThinkingLevel).toBeNull();
    expect(state.lastError).toContain("operator.read");
    expect(state.chatLoading).toBe(false);
  });
});
