import { describe, expect, test, vi } from "vitest";
import { buildSessionHistorySnapshot, SessionHistorySseState } from "./session-history-state.js";
import * as sessionUtils from "./session-utils.js";

describe("SessionHistorySseState", () => {
  test("uses the initial raw snapshot for both first history and seq seeding", () => {
    const readSpy = vi.spyOn(sessionUtils, "readSessionMessages").mockReturnValue([
      {
        role: "assistant",
        content: [{ type: "text", text: "stale disk message" }],
        __openclaw: { seq: 1 },
      },
    ]);
    try {
      const state = SessionHistorySseState.fromRawSnapshot({
        target: { sessionId: "sess-main" },
        rawMessages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "fresh snapshot message" }],
            __openclaw: { seq: 2 },
          },
        ],
      });

      expect(state.snapshot().messages).toHaveLength(1);
      expect(
        (
          state.snapshot().messages[0] as {
            content?: Array<{ text?: string }>;
            __openclaw?: { seq?: number };
          }
        ).content?.[0]?.text,
      ).toBe("fresh snapshot message");
      expect(
        (
          state.snapshot().messages[0] as {
            __openclaw?: { seq?: number };
          }
        ).__openclaw?.seq,
      ).toBe(2);

      const appended = state.appendInlineMessage({
        message: {
          role: "assistant",
          content: [{ type: "text", text: "next message" }],
        },
      });

      expect(appended?.messageSeq).toBe(3);
      expect(readSpy).not.toHaveBeenCalled();
    } finally {
      readSpy.mockRestore();
    }
  });

  test("reuses one canonical array for items and messages", () => {
    const snapshot = buildSessionHistorySnapshot({
      rawMessages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "first" }],
          __openclaw: { seq: 1 },
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "second" }],
          __openclaw: { seq: 2 },
        },
      ],
      limit: 1,
    });

    expect(snapshot.history.items).toBe(snapshot.history.messages);
    expect(snapshot.history.messages[0]?.__openclaw?.seq).toBe(2);
    expect(snapshot.rawTranscriptSeq).toBe(2);
  });

  test("collapses progressive assistant snapshots separated by tool results in history snapshots", () => {
    const snapshot = buildSessionHistorySnapshot({
      rawMessages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "先检查配置。" }],
          __openclaw: { seq: 1 },
        },
        {
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "read",
          content: [{ type: "text", text: "MEMORY.md" }],
          __openclaw: { seq: 2 },
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "先检查配置。再检查 MCP 服务状态。" }],
          __openclaw: { seq: 3 },
        },
      ],
    });

    expect(snapshot.history.messages).toEqual([
      expect.objectContaining({
        role: "toolResult",
      }),
      expect.objectContaining({
        role: "assistant",
        content: [{ type: "text", text: "先检查配置。再检查 MCP 服务状态。" }],
      }),
    ]);
  });

  test("collapses progressive assistant snapshots during inline SSE appends", () => {
    const state = SessionHistorySseState.fromRawSnapshot({
      target: { sessionId: "sess-main" },
      rawMessages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "先检查配置。" }],
          __openclaw: { seq: 1 },
        },
        {
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "read",
          content: [{ type: "text", text: "MEMORY.md" }],
          __openclaw: { seq: 2 },
        },
      ],
    });

    const appended = state.appendInlineMessage({
      message: {
        role: "assistant",
        content: [{ type: "text", text: "先检查配置。再检查 MCP 服务状态。" }],
      },
      messageId: "msg-3",
    });

    expect(state.snapshot().messages).toEqual([
      expect.objectContaining({
        role: "toolResult",
      }),
      expect.objectContaining({
        role: "assistant",
        __openclaw: { id: "msg-3", seq: 3 },
      }),
    ]);
    expect(appended?.message).toMatchObject({
      role: "assistant",
      __openclaw: { id: "msg-3", seq: 3 },
    });
  });
});
