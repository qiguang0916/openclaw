import { beforeEach, describe, expect, it, vi } from "vitest";
import { appendChatDiagnostic, readRecentChatDiagnostics } from "./chat-diagnostics.ts";

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("chat diagnostics", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorageMock());
  });

  it("persists recent chat diagnostics entries", () => {
    appendChatDiagnostic({
      ts: 1000,
      sessionKey: "main",
      runId: "run-1",
      kind: "activity",
      summary: "后台会话已启动",
    });

    expect(readRecentChatDiagnostics()).toEqual([
      {
        ts: 1000,
        sessionKey: "main",
        runId: "run-1",
        kind: "activity",
        summary: "后台会话已启动",
      },
    ]);
  });

  it("dedupes identical adjacent diagnostics within the time window", () => {
    appendChatDiagnostic({
      ts: 1000,
      sessionKey: "main",
      runId: "run-1",
      kind: "activity",
      summary: "模型正在流式回复",
    });
    appendChatDiagnostic({
      ts: 2000,
      sessionKey: "main",
      runId: "run-1",
      kind: "activity",
      summary: "模型正在流式回复",
    });

    expect(readRecentChatDiagnostics()).toHaveLength(1);
  });
});
