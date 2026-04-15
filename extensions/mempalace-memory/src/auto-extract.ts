import crypto from "node:crypto";
import type {
  OpenClawPluginApi,
  PluginHookAgentContext,
  PluginHookAgentEndEvent,
} from "openclaw/plugin-sdk/plugin-runtime";
import {
  humanizeAgentId,
  normalizeMempalaceSafeName,
  shouldUseMempalaceSessionMemory,
} from "../api.js";
import {
  resolveMempalaceAutoExtractConfig,
  type ResolvedMempalaceAutoExtractConfig,
} from "./auto-extract-config.js";
import {
  callMempalaceTool,
  searchDrawerMemories,
  writeDrawerDirect,
  writeFtsEntry,
} from "./bridge.js";
import { resolveMempalacePluginConfig } from "./config.js";

type AutoMemoryCategory =
  | "explicit_remember"
  | "standing_preference"
  | "standing_constraint"
  | "long_term_goal"
  | "project_continuity";

type AutoMemoryScope = "private" | "shared";

type AutoMemoryCandidate = {
  key: string;
  category: AutoMemoryCategory;
  priority: number;
  scope: AutoMemoryScope;
  summary: string;
  evidence: string;
  sourceText: string;
};

type AutoMemoryStorage = "drawer" | "diary" | "kg";

type AutoMemoryWriteResult =
  | {
      status: "written";
      category: AutoMemoryCategory;
      scope: AutoMemoryScope;
      summary: string;
      storage: AutoMemoryStorage;
    }
  | { status: "duplicate"; category: AutoMemoryCategory; scope: AutoMemoryScope; summary: string }
  | { status: "skipped"; reason: string };

const EXPLICIT_REMEMBER_RE =
  /(记住(?:这个)?|记一下|帮我记住|请记住|保存到记忆|记到记忆里|别忘了|备忘|remember that|remember this|keep in mind|make a note|don't forget)/i;
const PERSISTENCE_RE =
  /(从现在开始|以后|默认|长期|长期目标|总是|每次|下次|稍后|明天|今后|始终|一直|一律|from now on|going forward|by default|long-term|next time|always|consistently)/i;
const QUESTION_RE = /[?？]/;
const PREFERENCE_RE =
  /(偏好|更喜欢|喜欢|不喜欢|请用中文|中文回复|英文回复|简洁|详细|先给结论|直接给结论|回复风格|语气|格式|风格|请回复|prefer|reply in|please reply|please use|please write|concise|detailed|tone|format|style)/i;
const CONSTRAINT_RE =
  /(不要|别|不能|必须|务必|一定要|禁止|避免|must|should not|don't|never|avoid)/i;
const LONG_TERM_GOAL_RE =
  /(长期目标|目标是|最终想要|最终希望|长期希望|我想长期|我希望长期|my goal|long-term goal|eventually want)/i;
const BALANCED_GOAL_RE = /(我想要|我希望|I want|I'm trying to)/i;
const IMPLICIT_BREVITY_RE =
  /(太长了|太啰嗦|回复太长|说太多|废话太多|讲太多|too long|too verbose|too wordy|overly detailed)/i;
const IMPLICIT_DETAIL_RE =
  /(太短了|太简单|太简略|说详细|展开说|能具体点|more detail|too brief|too simple|elaborate more)/i;
const ASSISTANT_CONFIRM_RE =
  /(好的|收到|明白了|我记住了|我会记住|记下来了|noted|got it|understood|i'll remember|i'll keep that in mind)/i;
const PROJECT_CONTINUITY_RE =
  /(下次继续|稍后继续|明天继续|记得继续|回头继续|next time continue|continue this later|pick this up later)/i;
const STRIP_LEADING_RE =
  /^(?:请)?(?:帮我)?(?:记住(?:这个)?|记一下|帮我记住|保存到记忆(?:里)?|remember that|remember this|keep in mind)[:：,\s-]*/i;
const STRIP_LABEL_RE = /^(?:偏好|喜好|约束|限制|目标|goal|preference|constraint)[:：]\s*/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readMessageText(message: unknown): string | null {
  const record = asRecord(message);
  if (!record) {
    return null;
  }
  const content = record.content;
  if (typeof content === "string") {
    const text = normalizeWhitespace(content);
    return text.length > 0 ? text : null;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const blocks = content
    .flatMap((block) => {
      const blockRecord = asRecord(block);
      if (!blockRecord || blockRecord.type !== "text" || typeof blockRecord.text !== "string") {
        return [];
      }
      const text = normalizeWhitespace(blockRecord.text);
      return text.length > 0 ? [text] : [];
    })
    .filter(Boolean);
  if (blocks.length === 0) {
    return null;
  }
  return blocks.join("\n");
}

function collectCurrentTurnUserTexts(messages: unknown[], maxSourceChars: number): string[] {
  const collected: string[] = [];
  let sawAssistant = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const record = asRecord(messages[index]);
    if (!record) {
      continue;
    }
    const role = record.role;
    if (role === "assistant") {
      if (collected.length > 0) {
        break;
      }
      sawAssistant = true;
      continue;
    }
    if (role !== "user") {
      continue;
    }
    const text = readMessageText(record);
    if (!text) {
      continue;
    }
    collected.unshift(text.slice(0, maxSourceChars));
    if (sawAssistant) {
      break;
    }
  }
  return collected;
}

function splitCandidateUnits(sourceText: string, maxCandidateChars: number): string[] {
  const normalized = sourceText.replace(/\r/g, "");
  return normalized
    .split(/\n+/)
    .flatMap((line) => line.match(/[^。！？!?；;]+[。！？!?；;]?/gu) ?? [])
    .map((unit) => normalizeWhitespace(unit))
    .filter((unit) => unit.length >= 8 && unit.length <= maxCandidateChars);
}

function cleanupCandidateText(value: string): string {
  return normalizeWhitespace(value.replace(STRIP_LEADING_RE, "").replace(STRIP_LABEL_RE, ""));
}

function buildCandidateKey(category: AutoMemoryCategory, summary: string): string {
  return crypto.createHash("sha256").update(`${category}\n${summary}`).digest("hex");
}

function classifyCandidate(params: {
  unit: string;
  mode: ResolvedMempalaceAutoExtractConfig["mode"];
  writePrivateContinuity: boolean;
  assistantConfirmed?: boolean;
}): AutoMemoryCandidate | null {
  const explicitRemember = EXPLICIT_REMEMBER_RE.test(params.unit);
  const persistence = explicitRemember || PERSISTENCE_RE.test(params.unit);
  const isQuestion = QUESTION_RE.test(params.unit);
  const cleaned = cleanupCandidateText(params.unit);
  if (!cleaned || (isQuestion && !explicitRemember)) {
    return null;
  }
  // In balanced mode, assistant confirmation boosts priority of implicit signals.
  const confirmBoost = params.mode === "balanced" && params.assistantConfirmed ? 10 : 0;

  if (params.writePrivateContinuity && PROJECT_CONTINUITY_RE.test(params.unit)) {
    return {
      key: buildCandidateKey("project_continuity", cleaned),
      category: "project_continuity",
      priority: explicitRemember ? 95 : 60,
      scope: "private",
      summary: cleaned,
      evidence: params.unit,
      sourceText: params.unit,
    };
  }

  if (PREFERENCE_RE.test(params.unit) && (persistence || params.mode === "balanced")) {
    return {
      key: buildCandidateKey("standing_preference", cleaned),
      category: "standing_preference",
      priority: explicitRemember ? 100 : 90 + confirmBoost,
      scope: "shared",
      summary: cleaned,
      evidence: params.unit,
      sourceText: params.unit,
    };
  }

  if (CONSTRAINT_RE.test(params.unit) && persistence) {
    return {
      key: buildCandidateKey("standing_constraint", cleaned),
      category: "standing_constraint",
      priority: explicitRemember ? 98 : 85,
      scope: "shared",
      summary: cleaned,
      evidence: params.unit,
      sourceText: params.unit,
    };
  }

  if (
    LONG_TERM_GOAL_RE.test(params.unit) ||
    (params.mode === "balanced" && persistence && BALANCED_GOAL_RE.test(params.unit))
  ) {
    return {
      key: buildCandidateKey("long_term_goal", cleaned),
      category: "long_term_goal",
      priority: explicitRemember ? 96 : 80,
      scope: "shared",
      summary: cleaned,
      evidence: params.unit,
      sourceText: params.unit,
    };
  }

  if (params.mode === "balanced" && !isQuestion) {
    // Implicit style feedback: complaints about reply length/depth → infer standing preference.
    // Use a normalized summary so near-duplicates collapse in the deduplication step.
    if (IMPLICIT_BREVITY_RE.test(params.unit)) {
      const summary = "prefer concise replies";
      return {
        key: buildCandidateKey("standing_preference", summary),
        category: "standing_preference",
        priority: 55 + confirmBoost,
        scope: "shared",
        summary,
        evidence: params.unit,
        sourceText: params.unit,
      };
    }
    if (IMPLICIT_DETAIL_RE.test(params.unit)) {
      const summary = "prefer detailed replies";
      return {
        key: buildCandidateKey("standing_preference", summary),
        category: "standing_preference",
        priority: 55 + confirmBoost,
        scope: "shared",
        summary,
        evidence: params.unit,
        sourceText: params.unit,
      };
    }
    // Soft constraint: CONSTRAINT_RE without persistence marker — capture at lower priority.
    // Require a minimum cleaned length to filter out fragment phrases like "不要".
    if (CONSTRAINT_RE.test(params.unit) && cleaned.length >= 10) {
      return {
        key: buildCandidateKey("standing_constraint", cleaned),
        category: "standing_constraint",
        priority: 60 + confirmBoost,
        scope: "shared",
        summary: cleaned,
        evidence: params.unit,
        sourceText: params.unit,
      };
    }
  }

  if (explicitRemember) {
    return {
      key: buildCandidateKey("explicit_remember", cleaned),
      category: "explicit_remember",
      priority: 70,
      scope: "shared",
      summary: cleaned,
      evidence: params.unit,
      sourceText: params.unit,
    };
  }

  return null;
}

function detectAssistantConfirmed(messages: unknown[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const record = asRecord(messages[index]);
    if (!record) {
      continue;
    }
    if (record.role === "user") {
      break;
    }
    if (record.role === "assistant") {
      const text = readMessageText(record);
      if (text && ASSISTANT_CONFIRM_RE.test(text)) {
        return true;
      }
    }
  }
  return false;
}

export function extractAutoMemoryCandidates(params: {
  messages: unknown[];
  autoExtract: ResolvedMempalaceAutoExtractConfig;
}): AutoMemoryCandidate[] {
  const sourceTexts = collectCurrentTurnUserTexts(
    params.messages,
    params.autoExtract.maxSourceChars,
  );
  if (sourceTexts.length === 0) {
    return [];
  }
  const assistantConfirmed =
    params.autoExtract.mode === "balanced" ? detectAssistantConfirmed(params.messages) : false;
  const deduped = new Map<string, AutoMemoryCandidate>();
  for (const sourceText of sourceTexts) {
    for (const unit of splitCandidateUnits(sourceText, params.autoExtract.maxCandidateChars)) {
      const candidate = classifyCandidate({
        unit,
        mode: params.autoExtract.mode,
        writePrivateContinuity: params.autoExtract.writePrivateContinuity,
        assistantConfirmed,
      });
      if (!candidate) {
        continue;
      }
      const previous = deduped.get(candidate.key);
      if (!previous || previous.priority < candidate.priority) {
        deduped.set(candidate.key, candidate);
      }
    }
  }
  return [...deduped.values()]
    .toSorted((left, right) => right.priority - left.priority)
    .slice(0, params.autoExtract.maxWritesPerTurn);
}

function resolveTargetScope(params: {
  candidate: AutoMemoryCandidate;
  autoExtract: ResolvedMempalaceAutoExtractConfig;
  resolved: ReturnType<typeof resolveMempalacePluginConfig>;
}): AutoMemoryScope {
  if (
    params.candidate.scope === "shared" &&
    params.autoExtract.writeSharedUserMemory &&
    params.resolved.writeShared &&
    params.resolved.sharedPalacePath
  ) {
    return "shared";
  }
  return "private";
}

function resolveWingAndRoom(params: {
  candidate: AutoMemoryCandidate;
  agentId: string;
  resolved: ReturnType<typeof resolveMempalacePluginConfig>;
  scope: AutoMemoryScope;
}): { wing: string; room: string } {
  if (params.scope === "private") {
    return {
      wing: "OpenClaw Continuity",
      room: normalizeMempalaceSafeName(
        params.resolved.defaultRoom ?? humanizeAgentId(params.agentId),
        humanizeAgentId(params.agentId),
      ),
    };
  }
  const wingByCategory: Record<Exclude<AutoMemoryCategory, "project_continuity">, string> = {
    explicit_remember: "Jarvis User Notes",
    standing_preference: "Jarvis User Preferences",
    standing_constraint: "Jarvis User Constraints",
    long_term_goal: "Jarvis User Goals",
  };
  return {
    wing: wingByCategory[
      params.candidate.category as Exclude<AutoMemoryCategory, "project_continuity">
    ],
    room: "User Profile",
  };
}

function buildStoredEntry(params: {
  candidate: AutoMemoryCandidate;
  sessionId?: string;
  channelId?: string;
  scope: AutoMemoryScope;
}): string {
  const capturedAt = new Date().toISOString();
  const lines = [
    "[AUTO MEMORY]",
    `type: ${params.candidate.category}`,
    `scope: ${params.scope}`,
    `captured_at: ${capturedAt}`,
    ...(params.sessionId ? [`session_id: ${params.sessionId}`] : []),
    ...(params.channelId ? [`channel: ${params.channelId}`] : []),
    `summary: ${params.candidate.summary}`,
    `evidence: ${params.candidate.evidence}`,
  ];
  return lines.join("\n");
}

async function persistCandidate(params: {
  api: OpenClawPluginApi;
  ctx: PluginHookAgentContext;
  agentId: string;
  candidate: AutoMemoryCandidate;
  autoExtract: ResolvedMempalaceAutoExtractConfig;
}): Promise<AutoMemoryWriteResult> {
  // Route project_continuity to diary first for timestamped chronicle semantics.
  if (params.candidate.category === "project_continuity") {
    return persistContinuityToDiary(params);
  }
  const resolved = resolveMempalacePluginConfig(params.api.config, params.agentId);
  if (!resolved.enabled || !resolved.server) {
    return { status: "skipped", reason: "mempalace unavailable" };
  }
  const scope = resolveTargetScope({
    candidate: params.candidate,
    autoExtract: params.autoExtract,
    resolved,
  });
  const palacePath =
    scope === "shared" && resolved.sharedPalacePath
      ? resolved.sharedPalacePath
      : resolved.privatePalacePath;
  const { wing, room } = resolveWingAndRoom({
    candidate: params.candidate,
    agentId: params.agentId,
    resolved,
    scope,
  });

  try {
    const top = (
      await searchDrawerMemories({
        cfg: params.api.config,
        agentId: params.agentId,
        palacePath,
        query: params.candidate.summary.slice(0, 300),
        maxResults: 1,
        wing,
        room,
      })
    )[0];
    if (
      top &&
      typeof top.similarity === "number" &&
      top.similarity >= params.autoExtract.dedupeSimilarity
    ) {
      return {
        status: "duplicate",
        category: params.candidate.category,
        scope,
        summary: params.candidate.summary,
      };
    }
  } catch (error) {
    params.api.logger.warn(
      `mempalace-memory: auto-extract duplicate check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const content = buildStoredEntry({
    candidate: params.candidate,
    sessionId: params.ctx.sessionId,
    channelId: params.ctx.channelId,
    scope,
  });
  const dateStamp = new Date().toISOString().slice(0, 10);
  const sourceFile = `auto-memory://${scope}/${params.candidate.category}/${dateStamp}`;

  const writeResult = resolved.compatSinglePalaceMode
    ? ((await callMempalaceTool({
        cfg: params.api.config,
        agentId: params.agentId,
        toolName: "mempalace_add_drawer",
        palacePath,
        arguments: {
          wing,
          room,
          content,
          source_file: sourceFile,
          added_by: "openclaw-auto-memory",
        },
      })) as { success?: boolean; drawer_id?: string; error?: string })
    : await writeDrawerDirect({
        cfg: params.api.config,
        agentId: params.agentId,
        palacePath,
        wing,
        room,
        content,
        sourceFile,
      });
  if (writeResult.success !== true) {
    return { status: "skipped", reason: writeResult.error ?? "write failed" };
  }
  if (writeResult.drawer_id) {
    void writeFtsEntry({
      cfg: params.api.config,
      agentId: params.agentId,
      palacePath,
      drawerId: writeResult.drawer_id,
      wing,
      room,
      content,
      sourceFile,
    }).catch((ftsError: unknown) => {
      params.api.logger.warn(
        `mempalace-memory: auto-extract FTS write failed: ${ftsError instanceof Error ? ftsError.message : String(ftsError)}`,
      );
    });
  }
  const writtenResult = {
    status: "written" as const,
    category: params.candidate.category,
    scope,
    summary: params.candidate.summary,
    storage: "drawer" as AutoMemoryStorage,
  };

  // Secondary KG write for high-confidence facts (fire-and-forget, non-blocking).
  // project_continuity is handled earlier via diary, so only drawer-routed categories reach here.
  if (
    params.autoExtract.allowKgWrite &&
    params.candidate.priority >= params.autoExtract.kgWriteMinConfidence
  ) {
    void tryWriteToKg({
      api: params.api,
      agentId: params.agentId,
      candidate: params.candidate,
      scope,
      palacePath,
    }).catch((kgError: unknown) => {
      params.api.logger.warn(
        `mempalace-memory: auto-extract KG write failed: ${kgError instanceof Error ? kgError.message : String(kgError)}`,
      );
    });
  }

  return writtenResult;
}

async function tryWriteToKg(params: {
  api: OpenClawPluginApi;
  agentId: string;
  candidate: AutoMemoryCandidate;
  scope: AutoMemoryScope;
  palacePath: string;
}): Promise<void> {
  const predicateByCategory: Record<Exclude<AutoMemoryCategory, "project_continuity">, string> = {
    explicit_remember: "remembers",
    standing_preference: "prefers",
    standing_constraint: "avoids",
    long_term_goal: "has goal",
  };
  const predicate =
    predicateByCategory[
      params.candidate.category as Exclude<AutoMemoryCategory, "project_continuity">
    ];
  if (!predicate) {
    return;
  }
  const dateStamp = new Date().toISOString().slice(0, 10);
  const result = (await callMempalaceTool({
    cfg: params.api.config,
    agentId: params.agentId,
    toolName: "mempalace_kg_add",
    palacePath: params.palacePath,
    arguments: {
      subject: "User",
      predicate,
      object: params.candidate.summary.slice(0, 200),
      source_file: `auto-memory://${params.scope}/${params.candidate.category}/${dateStamp}`,
    },
  })) as { success?: boolean; error?: string };
  if (result.success !== true) {
    throw new Error(result.error ?? "KG write failed");
  }
}

async function persistContinuityToDiary(params: {
  api: OpenClawPluginApi;
  ctx: PluginHookAgentContext;
  agentId: string;
  candidate: AutoMemoryCandidate;
  autoExtract: ResolvedMempalaceAutoExtractConfig;
}): Promise<AutoMemoryWriteResult> {
  const resolved = resolveMempalacePluginConfig(params.api.config, params.agentId);
  if (!resolved.enabled || !resolved.server) {
    return { status: "skipped", reason: "mempalace unavailable" };
  }
  const capturedAt = new Date().toISOString();
  const content = [
    `[AUTO CONTINUITY] ${params.candidate.summary}`,
    `captured_at: ${capturedAt}`,
    ...(params.ctx.sessionId ? [`session_id: ${params.ctx.sessionId}`] : []),
    `evidence: ${params.candidate.evidence}`,
  ].join("\n");
  const dateStamp = capturedAt.slice(0, 10);
  const sourceFile = `auto-memory://private/project_continuity/${dateStamp}`;
  try {
    const result = (await callMempalaceTool({
      cfg: params.api.config,
      agentId: params.agentId,
      toolName: "mempalace_diary_write",
      palacePath: resolved.privatePalacePath,
      arguments: {
        content,
        topic: params.candidate.summary.slice(0, 80),
        source_file: sourceFile,
      },
    })) as { success?: boolean; error?: string };
    if (result.success === true) {
      return {
        status: "written",
        category: params.candidate.category,
        scope: "private",
        summary: params.candidate.summary,
        storage: "diary",
      };
    }
  } catch {
    // Fall through to drawer fallback below.
  }
  // Diary unavailable — fall back to drawer so continuity is not lost.
  // Write directly to avoid re-entering the diary routing path.
  const wing = "OpenClaw Continuity";
  const room = normalizeMempalaceSafeName(
    resolved.defaultRoom ?? humanizeAgentId(params.agentId),
    humanizeAgentId(params.agentId),
  );
  const drawerContent = buildStoredEntry({
    candidate: params.candidate,
    sessionId: params.ctx.sessionId,
    channelId: params.ctx.channelId,
    scope: "private",
  });
  const drawerResult = resolved.compatSinglePalaceMode
    ? ((await callMempalaceTool({
        cfg: params.api.config,
        agentId: params.agentId,
        toolName: "mempalace_add_drawer",
        palacePath: resolved.privatePalacePath,
        arguments: {
          wing,
          room,
          content: drawerContent,
          source_file: sourceFile,
          added_by: "openclaw-auto-memory",
        },
      })) as { success?: boolean; drawer_id?: string; error?: string })
    : await writeDrawerDirect({
        cfg: params.api.config,
        agentId: params.agentId,
        palacePath: resolved.privatePalacePath,
        wing,
        room,
        content: drawerContent,
        sourceFile,
      });
  if (drawerResult.success !== true) {
    return { status: "skipped", reason: drawerResult.error ?? "write failed" };
  }
  if (drawerResult.drawer_id) {
    void writeFtsEntry({
      cfg: params.api.config,
      agentId: params.agentId,
      palacePath: resolved.privatePalacePath,
      drawerId: drawerResult.drawer_id,
      wing,
      room,
      content: drawerContent,
      sourceFile,
    }).catch(() => undefined);
  }
  return {
    status: "written",
    category: params.candidate.category,
    scope: "private",
    summary: params.candidate.summary,
    storage: "drawer",
  };
}

export async function runMempalaceAutoExtract(params: {
  api: OpenClawPluginApi;
  event: PluginHookAgentEndEvent;
  ctx: PluginHookAgentContext;
}): Promise<AutoMemoryWriteResult[]> {
  const autoExtract = resolveMempalaceAutoExtractConfig(params.api.config);
  if (!autoExtract.enabled || !params.event.success || !params.ctx.agentId) {
    return [];
  }
  const trigger = params.ctx.trigger?.trim();
  if (trigger === "heartbeat" || trigger === "memory" || trigger === "cron") {
    return [];
  }
  const allCandidates = extractAutoMemoryCandidates({
    messages: params.event.messages,
    autoExtract,
  });
  // Apply minConfidence threshold after extraction so the filter is visible in tests.
  const candidates =
    autoExtract.minConfidence > 0
      ? allCandidates.filter((c) => c.priority >= autoExtract.minConfidence)
      : allCandidates;
  if (candidates.length === 0) {
    return [];
  }
  const results: AutoMemoryWriteResult[] = [];
  for (const candidate of candidates) {
    results.push(
      await persistCandidate({
        api: params.api,
        ctx: params.ctx,
        agentId: params.ctx.agentId,
        candidate,
        autoExtract,
      }),
    );
  }
  return results;
}

function emitAutoExtractEvent(params: {
  api: OpenClawPluginApi;
  agentId: string;
  sessionId?: string;
  results: AutoMemoryWriteResult[];
}): void {
  const written = params.results.filter(
    (r): r is Extract<AutoMemoryWriteResult, { status: "written" }> => r.status === "written",
  );
  if (written.length === 0) {
    return;
  }
  // Lazy-import to avoid top-level side effects from memory-core during test loading.
  void Promise.all([
    import("openclaw/plugin-sdk/memory-core"),
    import("openclaw/plugin-sdk/memory-host-events"),
  ])
    .then(([{ resolveAgentWorkspaceDir }, { appendMemoryHostEvent }]) => {
      const workspaceDir = resolveAgentWorkspaceDir(params.api.config, params.agentId)?.trim();
      if (!workspaceDir) {
        return;
      }
      return appendMemoryHostEvent(workspaceDir, {
        type: "memory.auto_extract.written",
        timestamp: new Date().toISOString(),
        agentId: params.agentId,
        sessionId: params.sessionId,
        written: written.length,
        duplicates: params.results.filter((r) => r.status === "duplicate").length,
        skipped: params.results.filter((r) => r.status === "skipped").length,
        entries: written.map((r) => ({
          category: r.category,
          scope: r.scope,
          summary: r.summary,
          storage: r.storage,
        })),
      });
    })
    .catch(() => {
      // Best-effort only. Event persistence must never block memory extraction.
    });
}

export function registerMempalaceAutoExtract(api: OpenClawPluginApi): void {
  let turnCount = 0;
  let lastWrittenTurn = -Infinity;

  api.on("agent_end", async (event, ctx) => {
    if (!shouldUseMempalaceSessionMemory(api.config)) {
      return;
    }
    turnCount += 1;
    const autoExtract = resolveMempalaceAutoExtractConfig(api.config);
    if (autoExtract.cooldownTurns > 0 && turnCount - lastWrittenTurn < autoExtract.cooldownTurns) {
      return;
    }
    try {
      const results = await runMempalaceAutoExtract({ api, event, ctx });
      const written = results.filter((result) => result.status === "written");
      const duplicates = results.filter((result) => result.status === "duplicate");
      const skipped = results.filter((result) => result.status === "skipped");
      if (written.length > 0) {
        lastWrittenTurn = turnCount;
        api.logger.info(
          `mempalace-memory: auto-extracted ${written.length} durable memory entr${written.length === 1 ? "y" : "ies"}${duplicates.length > 0 ? `, ${duplicates.length} suppressed as duplicate` : ""}.`,
        );
        emitAutoExtractEvent({
          api,
          agentId: ctx.agentId ?? "",
          sessionId: ctx.sessionId,
          results,
        });
      } else if (duplicates.length > 0) {
        api.logger.info(
          `mempalace-memory: auto-extract: ${duplicates.length} candidate${duplicates.length === 1 ? "" : "s"} suppressed as duplicate.`,
        );
      } else if (skipped.length > 0) {
        api.logger.warn(
          `mempalace-memory: auto-extract: ${skipped.length} candidate${skipped.length === 1 ? "" : "s"} skipped (write failed).`,
        );
      }
    } catch (error) {
      api.logger.warn(
        `mempalace-memory: auto-extract failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

export const __testing = {
  cleanupCandidateText,
  classifyCandidate,
  collectCurrentTurnUserTexts,
  detectAssistantConfirmed,
  extractAutoMemoryCandidates,
  readMessageText,
  splitCandidateUnits,
};
