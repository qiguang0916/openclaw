import { describe, expect, test } from "vitest";
import { resolveAutoChatToolsAllowForMessage } from "./chat.js";

describe("resolveAutoChatToolsAllowForMessage", () => {
  test.each(["你好", "你是哪个模型", "谢谢", "写一句简短祝福"])(
    "uses no tools for short plain chat: %s",
    (message) => {
      expect(resolveAutoChatToolsAllowForMessage({ message })).toEqual([]);
    },
  );

  test.each([
    "看下日志",
    "帮我搜索一下 MiniMax 文档",
    "读取 AGENTS.md",
    "运行 pnpm test",
    "修复 OpenClaw 配置",
    "查一下 MemPalace 状态",
    "/status",
  ])("keeps the full toolset for tool-like requests: %s", (message) => {
    expect(resolveAutoChatToolsAllowForMessage({ message })).toBeUndefined();
  });

  test("keeps the full toolset for short follow-ups when recent transcript used tools", () => {
    expect(
      resolveAutoChatToolsAllowForMessage({
        message: "不会丢了吧",
        hasRecentToolActivity: true,
      }),
    ).toBeUndefined();
  });

  test("keeps the full toolset when attachments or delivery are involved", () => {
    expect(
      resolveAutoChatToolsAllowForMessage({ message: "描述这张图", attachmentCount: 1 }),
    ).toBeUndefined();
    expect(resolveAutoChatToolsAllowForMessage({ message: "你好", deliver: true })).toBeUndefined();
  });
});
