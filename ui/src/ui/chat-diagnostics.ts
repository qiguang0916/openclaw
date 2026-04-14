import { getSafeLocalStorage } from "../local-storage.ts";

const CHAT_DIAGNOSTICS_KEY = "openclaw.control.chat-diagnostics.v1";
const MAX_CHAT_DIAGNOSTICS = 200;
const DEDUPE_WINDOW_MS = 1500;

export type ChatDiagnosticEntry = {
  ts: number;
  sessionKey: string;
  runId?: string | null;
  kind: string;
  summary: string;
};

function readEntries(): ChatDiagnosticEntry[] {
  try {
    const storage = getSafeLocalStorage();
    const raw = storage?.getItem(CHAT_DIAGNOSTICS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is ChatDiagnosticEntry => {
      if (!entry || typeof entry !== "object") {
        return false;
      }
      const record = entry as Record<string, unknown>;
      return (
        typeof record.ts === "number" &&
        typeof record.sessionKey === "string" &&
        typeof record.kind === "string" &&
        typeof record.summary === "string"
      );
    });
  } catch {
    return [];
  }
}

function writeEntries(entries: ChatDiagnosticEntry[]) {
  try {
    const storage = getSafeLocalStorage();
    storage?.setItem(CHAT_DIAGNOSTICS_KEY, JSON.stringify(entries));
  } catch {
    // best-effort diagnostics only
  }
}

export function appendChatDiagnostic(entry: ChatDiagnosticEntry) {
  const entries = readEntries();
  const last = entries[entries.length - 1];
  if (
    last &&
    last.sessionKey === entry.sessionKey &&
    last.runId === (entry.runId ?? null) &&
    last.kind === entry.kind &&
    last.summary === entry.summary &&
    entry.ts - last.ts <= DEDUPE_WINDOW_MS
  ) {
    return;
  }
  const next = [...entries, entry].slice(-MAX_CHAT_DIAGNOSTICS);
  writeEntries(next);
}

export function readRecentChatDiagnostics(): ChatDiagnosticEntry[] {
  return readEntries();
}
