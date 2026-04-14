import { clearPendingQueueItemsForRun, flushChatQueueForEvent } from "./app-chat.ts";
import { resetToolStream } from "./app-tool-stream.ts";
import type { OpenClawApp } from "./app.ts";
import { extractText } from "./chat/message-extract.ts";
import { loadChatHistory } from "./controllers/chat.ts";
import { loadDebug } from "./controllers/debug.ts";
import { loadLogs } from "./controllers/logs.ts";
import { loadNodes } from "./controllers/nodes.ts";

const CHAT_STALE_CHECK_INTERVAL_MS = 5000;
const CHAT_STALE_IDLE_MS = 30000;
const CHAT_STALE_ACTIVE_MS = 45000;
const CHAT_STALE_AFTER_VISIBLE_REPLY_MS = 12000;

type PollingHost = {
  nodesPollInterval: number | null;
  logsPollInterval: number | null;
  debugPollInterval: number | null;
  chatWatchdogInterval: number | null;
  tab: string;
};

type ChatWatchdogHost = PollingHost & {
  client?: unknown;
  connected: boolean;
  chatLastActivityAt: number;
  chatLastActivityKind: string | null;
  chatLoading: boolean;
  chatManualRefreshInFlight: boolean;
  chatMessages: unknown[];
  chatProgressTick: number;
  chatRunId: string | null;
  chatRunStartedAt: number;
  chatSending: boolean;
  chatStaleRecoveryInFlight: boolean;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatToolMessages: unknown[];
  sessionKey: string;
};

export async function checkForStaleChatRun(host: ChatWatchdogHost, now = Date.now()) {
  if (
    host.tab !== "chat" ||
    !host.connected ||
    !host.client ||
    !host.chatRunId ||
    host.chatLoading ||
    host.chatSending ||
    host.chatManualRefreshInFlight ||
    host.chatStaleRecoveryInFlight
  ) {
    return false;
  }

  const startedAt = host.chatRunStartedAt || host.chatStreamStartedAt || 0;
  if (startedAt <= 0) {
    return false;
  }

  const hasStreamText = typeof host.chatStream === "string" && host.chatStream.trim().length > 0;
  const hasToolActivity = Array.isArray(host.chatToolMessages) && host.chatToolMessages.length > 0;
  const lastActivityAt = Math.max(host.chatLastActivityAt || 0, startedAt);
  const hasVisibleAssistantReply = host.chatMessages.some((message) => {
    if (!message || typeof message !== "object") {
      return false;
    }
    const role = (message as { role?: unknown }).role;
    const timestamp =
      typeof (message as { timestamp?: unknown }).timestamp === "number"
        ? ((message as { timestamp: number }).timestamp ?? 0)
        : 0;
    return (
      typeof role === "string" &&
      role.toLowerCase() === "assistant" &&
      timestamp >= startedAt &&
      Boolean(extractText(message)?.trim())
    );
  });
  const idleThresholdMs =
    hasVisibleAssistantReply && !hasStreamText && !hasToolActivity
      ? CHAT_STALE_AFTER_VISIBLE_REPLY_MS
      : hasStreamText || hasToolActivity
        ? CHAT_STALE_ACTIVE_MS
        : CHAT_STALE_IDLE_MS;
  if (now - lastActivityAt < idleThresholdMs) {
    return false;
  }

  const staleRunId = host.chatRunId;
  host.chatStaleRecoveryInFlight = true;
  host.chatLastActivityKind = "长时间无新活动，正在自动恢复";
  host.chatProgressTick = now;
  host.chatManualRefreshInFlight = true;
  try {
    resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
    clearPendingQueueItemsForRun(
      host as unknown as Parameters<typeof clearPendingQueueItemsForRun>[0],
      staleRunId,
    );
    host.chatRunId = null;
    host.chatRunStartedAt = 0;
    host.chatStream = null;
    host.chatStreamStartedAt = null;
    await loadChatHistory(host as unknown as OpenClawApp);
    void flushChatQueueForEvent(host as unknown as Parameters<typeof flushChatQueueForEvent>[0]);
    return true;
  } finally {
    host.chatManualRefreshInFlight = false;
    host.chatStaleRecoveryInFlight = false;
  }
}

export function startNodesPolling(host: PollingHost) {
  if (host.nodesPollInterval != null) {
    return;
  }
  host.nodesPollInterval = window.setInterval(
    () => void loadNodes(host as unknown as OpenClawApp, { quiet: true }),
    5000,
  );
}

export function stopNodesPolling(host: PollingHost) {
  if (host.nodesPollInterval == null) {
    return;
  }
  clearInterval(host.nodesPollInterval);
  host.nodesPollInterval = null;
}

export function startLogsPolling(host: PollingHost) {
  if (host.logsPollInterval != null) {
    return;
  }
  host.logsPollInterval = window.setInterval(() => {
    if (host.tab !== "logs") {
      return;
    }
    void loadLogs(host as unknown as OpenClawApp, { quiet: true });
  }, 2000);
}

export function stopLogsPolling(host: PollingHost) {
  if (host.logsPollInterval == null) {
    return;
  }
  clearInterval(host.logsPollInterval);
  host.logsPollInterval = null;
}

export function startDebugPolling(host: PollingHost) {
  if (host.debugPollInterval != null) {
    return;
  }
  host.debugPollInterval = window.setInterval(() => {
    if (host.tab !== "debug") {
      return;
    }
    void loadDebug(host as unknown as OpenClawApp);
  }, 3000);
}

export function stopDebugPolling(host: PollingHost) {
  if (host.debugPollInterval == null) {
    return;
  }
  clearInterval(host.debugPollInterval);
  host.debugPollInterval = null;
}

export function startChatWatchdog(host: ChatWatchdogHost) {
  if (host.chatWatchdogInterval != null) {
    return;
  }
  host.chatWatchdogInterval = window.setInterval(() => {
    if (host.chatRunId) {
      host.chatProgressTick = Date.now();
    }
    void checkForStaleChatRun(host);
  }, CHAT_STALE_CHECK_INTERVAL_MS);
}

export function stopChatWatchdog(host: PollingHost) {
  if (host.chatWatchdogInterval == null) {
    return;
  }
  clearInterval(host.chatWatchdogInterval);
  host.chatWatchdogInterval = null;
}
