import { resetToolStream } from "../app-tool-stream.ts";
import { extractText } from "../chat/message-extract.ts";
import { formatConnectError } from "../connect-error.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { ChatAttachment } from "../ui-types.ts";
import { generateUUID } from "../uuid.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

const SILENT_REPLY_PATTERN = /^\s*NO_REPLY\s*$/;

function isSilentReplyStream(text: string): boolean {
  return SILENT_REPLY_PATTERN.test(text);
}
/** Client-side defense-in-depth: detect assistant messages whose text is purely NO_REPLY. */
function isAssistantSilentReply(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as Record<string, unknown>;
  const role = typeof entry.role === "string" ? entry.role.toLowerCase() : "";
  if (role !== "assistant") {
    return false;
  }
  // entry.text takes precedence — matches gateway extractAssistantTextForSilentCheck
  if (typeof entry.text === "string") {
    return isSilentReplyStream(entry.text);
  }
  const text = extractText(message);
  return typeof text === "string" && isSilentReplyStream(text);
}

function isUserMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" && role.toLowerCase() === "user";
}

function optimisticRunId(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const runId = (message as { optimisticRunId?: unknown }).optimisticRunId;
  return typeof runId === "string" && runId.trim() ? runId : null;
}

function historyHasUserMessage(history: unknown[], optimisticMessage: unknown): boolean {
  const optimisticText = extractText(optimisticMessage)?.trim();
  if (!optimisticText) {
    return false;
  }
  return history.some((message) => {
    if (!isUserMessage(message)) {
      return false;
    }
    const text = extractText(message)?.trim();
    return Boolean(text && text.includes(optimisticText));
  });
}

const assistantRunIds = new WeakMap<object, string>();

function isAssistantMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" && role.toLowerCase() === "assistant";
}

function rememberAssistantRunId(message: unknown, runId: string | null | undefined) {
  if (!runId || !message || typeof message !== "object") {
    return;
  }
  assistantRunIds.set(message, runId);
}

function resolveOpenClawMeta(message: unknown): Record<string, unknown> | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const meta = (message as { __openclaw?: unknown }).__openclaw;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }
  return meta as Record<string, unknown>;
}

function resolveStringRecordField(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveNumericRecordField(
  record: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveAssistantStableKey(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const record = message as Record<string, unknown>;
  const meta = resolveOpenClawMeta(message);
  const id =
    resolveStringRecordField(record, "id") ??
    resolveStringRecordField(record, "messageId") ??
    resolveStringRecordField(meta, "id");
  if (id) {
    return `id:${id}`;
  }
  const seq = resolveNumericRecordField(meta, "seq");
  if (seq != null) {
    return `seq:${seq}`;
  }
  return null;
}

function withAssistantRunId(
  message: Record<string, unknown>,
  runId: string | null | undefined,
): Record<string, unknown> {
  if (!runId) {
    return message;
  }
  const meta = resolveOpenClawMeta(message);
  if (resolveStringRecordField(meta, "clientRunId") === runId) {
    rememberAssistantRunId(message, runId);
    return message;
  }
  const nextMessage = {
    ...message,
    __openclaw: {
      ...meta,
      clientRunId: runId,
    },
  };
  rememberAssistantRunId(nextMessage, runId);
  return nextMessage;
}

function resolveAssistantRunId(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const meta = resolveOpenClawMeta(message);
  return resolveStringRecordField(meta, "clientRunId") ?? assistantRunIds.get(message) ?? null;
}

function shouldMergeAdjacentAssistantMessages(previous: unknown, next: unknown): boolean {
  if (!isAssistantMessage(previous) || !isAssistantMessage(next)) {
    return false;
  }
  const previousStableKey = resolveAssistantStableKey(previous);
  const nextStableKey = resolveAssistantStableKey(next);
  if (previousStableKey && nextStableKey && previousStableKey === nextStableKey) {
    return true;
  }
  const previousRunId = resolveAssistantRunId(previous);
  const nextRunId = resolveAssistantRunId(next);
  if (previousRunId && nextRunId && previousRunId === nextRunId) {
    return true;
  }
  const previousText = extractText(previous)?.trim();
  const nextText = extractText(next)?.trim();
  if (!previousText || !nextText) {
    return false;
  }
  if (previousText === nextText) {
    return true;
  }
  return nextText.startsWith(previousText) || previousText.startsWith(nextText);
}

function pickPreferredAssistantMessage(previous: unknown, next: unknown): unknown {
  const previousText = extractText(previous)?.trim() ?? "";
  const nextText = extractText(next)?.trim() ?? "";
  if (!previousText) {
    return next;
  }
  if (!nextText) {
    return previous;
  }
  if (nextText.startsWith(previousText) && nextText.length >= previousText.length) {
    return next;
  }
  if (previousText.startsWith(nextText) && previousText.length >= nextText.length) {
    return previous;
  }
  return nextText.length >= previousText.length ? next : previous;
}

function dedupeAssistantHistory(messages: unknown[]): unknown[] {
  const deduped: unknown[] = [];
  for (const message of messages) {
    if (!isAssistantMessage(message)) {
      deduped.push(message);
      continue;
    }
    const text = extractText(message)?.trim();
    const previous = deduped[deduped.length - 1];
    if (!text || !isAssistantMessage(previous)) {
      deduped.push(message);
      continue;
    }
    if (shouldMergeAdjacentAssistantMessages(previous, message)) {
      deduped[deduped.length - 1] = pickPreferredAssistantMessage(previous, message);
      continue;
    }
    deduped.push(message);
  }
  return deduped;
}

function upsertAssistantMessage(
  state: ChatState,
  message: Record<string, unknown>,
  runId?: string | null,
) {
  const candidate = withAssistantRunId(message, runId);
  const nextText = extractText(candidate)?.trim() ?? "";
  const nextMessages = [...state.chatMessages];
  const nextStableKey = resolveAssistantStableKey(candidate);

  if (nextStableKey || runId) {
    for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
      const existing = nextMessages[index];
      if (!isAssistantMessage(existing)) {
        continue;
      }
      const existingStableKey = resolveAssistantStableKey(existing);
      if (nextStableKey && existingStableKey && existingStableKey === nextStableKey) {
        nextMessages[index] = candidate;
        state.chatMessages = nextMessages;
        return;
      }
      if (runId && resolveAssistantRunId(existing) === runId) {
        nextMessages[index] = candidate;
        state.chatMessages = nextMessages;
        return;
      }
    }
  }

  if (nextText) {
    for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
      const existing = nextMessages[index];
      if (!isAssistantMessage(existing)) {
        continue;
      }
      if (shouldMergeAdjacentAssistantMessages(existing, candidate)) {
        nextMessages[index] = pickPreferredAssistantMessage(existing, candidate);
        state.chatMessages = nextMessages;
        return;
      }
      break;
    }
  }

  nextMessages.push(candidate);
  state.chatMessages = nextMessages;
}

export type ChatState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  chatLoading: boolean;
  chatMessages: unknown[];
  chatThinkingLevel: string | null;
  chatSending: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  lastError: string | null;
};

export type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;
  errorMessage?: string;
};

function maybeResetToolStream(state: ChatState) {
  const toolHost = state as ChatState & Partial<Parameters<typeof resetToolStream>[0]>;
  if (
    toolHost.toolStreamById instanceof Map &&
    Array.isArray(toolHost.toolStreamOrder) &&
    Array.isArray(toolHost.chatToolMessages) &&
    Array.isArray(toolHost.chatStreamSegments)
  ) {
    resetToolStream(toolHost as Parameters<typeof resetToolStream>[0]);
  }
}

export async function loadChatHistory(state: ChatState) {
  if (!state.client || !state.connected) {
    return;
  }
  const activeRunId = state.chatRunId;
  const optimisticMessages = activeRunId
    ? state.chatMessages.filter((message) => optimisticRunId(message) === activeRunId)
    : [];
  state.chatLoading = true;
  state.lastError = null;
  try {
    const res = await state.client.request<{ messages?: Array<unknown>; thinkingLevel?: string }>(
      "chat.history",
      {
        sessionKey: state.sessionKey,
        limit: 200,
      },
    );
    const messages = Array.isArray(res.messages) ? res.messages : [];
    const nextMessages = dedupeAssistantHistory(
      messages.filter((message) => !isAssistantSilentReply(message)),
    );
    const preservedOptimisticMessages = optimisticMessages.filter(
      (message) => !historyHasUserMessage(nextMessages, message),
    );
    state.chatMessages = [...nextMessages, ...preservedOptimisticMessages];
    state.chatThinkingLevel = res.thinkingLevel ?? null;
    // Clear all streaming state — history includes tool results and text
    // inline, so keeping streaming artifacts would cause duplicates.
    maybeResetToolStream(state);
    state.chatStream = null;
    state.chatStreamStartedAt = null;
  } catch (err) {
    if (isMissingOperatorReadScopeError(err)) {
      state.chatMessages = [];
      state.chatThinkingLevel = null;
      state.lastError = formatMissingOperatorReadScopeMessage("existing chat history");
    } else {
      state.lastError = String(err);
    }
  } finally {
    state.chatLoading = false;
  }
}

function dataUrlToBase64(dataUrl: string): { content: string; mimeType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return null;
  }
  return { mimeType: match[1], content: match[2] };
}

type AssistantMessageNormalizationOptions = {
  roleRequirement: "required" | "optional";
  roleCaseSensitive?: boolean;
  requireContentArray?: boolean;
  allowTextField?: boolean;
};

function normalizeAssistantMessage(
  message: unknown,
  options: AssistantMessageNormalizationOptions,
): Record<string, unknown> | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const candidate = message as Record<string, unknown>;
  const roleValue = candidate.role;
  if (typeof roleValue === "string") {
    const role = options.roleCaseSensitive ? roleValue : roleValue.toLowerCase();
    if (role !== "assistant") {
      return null;
    }
  } else if (options.roleRequirement === "required") {
    return null;
  }

  if (options.requireContentArray) {
    return Array.isArray(candidate.content) ? candidate : null;
  }
  if (!("content" in candidate) && !(options.allowTextField && "text" in candidate)) {
    return null;
  }
  return candidate;
}

function normalizeAbortedAssistantMessage(message: unknown): Record<string, unknown> | null {
  return normalizeAssistantMessage(message, {
    roleRequirement: "required",
    roleCaseSensitive: true,
    requireContentArray: true,
  });
}

function normalizeFinalAssistantMessage(message: unknown): Record<string, unknown> | null {
  return normalizeAssistantMessage(message, {
    roleRequirement: "optional",
    allowTextField: true,
  });
}

export async function sendChatMessage(
  state: ChatState,
  message: string,
  attachments?: ChatAttachment[],
): Promise<string | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const msg = message.trim();
  const hasAttachments = attachments && attachments.length > 0;
  if (!msg && !hasAttachments) {
    return null;
  }

  const now = Date.now();
  const runId = generateUUID();

  // Build user message content blocks
  const contentBlocks: Array<{ type: string; text?: string; source?: unknown }> = [];
  if (msg) {
    contentBlocks.push({ type: "text", text: msg });
  }
  // Add image previews to the message for display
  if (hasAttachments) {
    for (const att of attachments) {
      contentBlocks.push({
        type: "image",
        source: { type: "base64", media_type: att.mimeType, data: att.dataUrl },
      });
    }
  }

  state.chatMessages = [
    ...state.chatMessages,
    {
      role: "user",
      content: contentBlocks,
      timestamp: now,
      optimisticRunId: runId,
    },
  ];

  state.chatSending = true;
  state.lastError = null;
  state.chatRunId = runId;
  state.chatStream = "";
  state.chatStreamStartedAt = now;

  // Convert attachments to API format
  const apiAttachments = hasAttachments
    ? attachments
        .map((att) => {
          const parsed = dataUrlToBase64(att.dataUrl);
          if (!parsed) {
            return null;
          }
          return {
            type: "image",
            mimeType: parsed.mimeType,
            content: parsed.content,
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null)
    : undefined;

  try {
    await state.client.request("chat.send", {
      sessionKey: state.sessionKey,
      message: msg,
      deliver: false,
      idempotencyKey: runId,
      attachments: apiAttachments,
    });
    return runId;
  } catch (err) {
    const error = formatConnectError(err);
    state.chatRunId = null;
    state.chatStream = null;
    state.chatStreamStartedAt = null;
    state.lastError = error;
    state.chatMessages = [
      ...state.chatMessages,
      {
        role: "assistant",
        content: [{ type: "text", text: "Error: " + error }],
        timestamp: Date.now(),
      },
    ];
    return null;
  } finally {
    state.chatSending = false;
  }
}

export async function abortChatRun(state: ChatState): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  const runId = state.chatRunId;
  try {
    await state.client.request(
      "chat.abort",
      runId ? { sessionKey: state.sessionKey, runId } : { sessionKey: state.sessionKey },
    );
    if (runId && state.chatRunId === runId) {
      state.chatRunId = null;
      state.chatStreamStartedAt = null;
    }
    state.chatSending = false;
    return true;
  } catch (err) {
    state.lastError = formatConnectError(err);
    return false;
  }
}

export function handleChatEvent(state: ChatState, payload?: ChatEventPayload) {
  if (!payload) {
    return null;
  }
  if (payload.sessionKey !== state.sessionKey) {
    return null;
  }

  // Final from another run (e.g. sub-agent announce): refresh history to show new message.
  // See https://github.com/openclaw/openclaw/issues/1909
  if (payload.runId && state.chatRunId && payload.runId !== state.chatRunId) {
    if (payload.state === "final") {
      const finalMessage = normalizeFinalAssistantMessage(payload.message);
      if (finalMessage && !isAssistantSilentReply(finalMessage)) {
        upsertAssistantMessage(state, finalMessage, payload.runId);
        return null;
      }
      return "final";
    }
    return null;
  }

  if (payload.state === "delta") {
    const next = extractText(payload.message);
    if (typeof next === "string" && !isSilentReplyStream(next)) {
      state.chatStream = next;
    }
  } else if (payload.state === "final") {
    const finalMessage = normalizeFinalAssistantMessage(payload.message);
    if (finalMessage && !isAssistantSilentReply(finalMessage)) {
      upsertAssistantMessage(state, finalMessage, payload.runId);
    } else if (state.chatStream?.trim() && !isSilentReplyStream(state.chatStream)) {
      upsertAssistantMessage(
        state,
        {
          role: "assistant",
          content: [{ type: "text", text: state.chatStream }],
          timestamp: Date.now(),
        },
        payload.runId,
      );
    }
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
  } else if (payload.state === "aborted") {
    const normalizedMessage = normalizeAbortedAssistantMessage(payload.message);
    if (normalizedMessage && !isAssistantSilentReply(normalizedMessage)) {
      upsertAssistantMessage(state, normalizedMessage, payload.runId);
    } else {
      const streamedText = state.chatStream ?? "";
      if (streamedText.trim() && !isSilentReplyStream(streamedText)) {
        upsertAssistantMessage(
          state,
          {
            role: "assistant",
            content: [{ type: "text", text: streamedText }],
            timestamp: Date.now(),
          },
          payload.runId,
        );
      }
    }
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
  } else if (payload.state === "error") {
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
    state.lastError = payload.errorMessage ?? "chat error";
  }
  return payload.state;
}
