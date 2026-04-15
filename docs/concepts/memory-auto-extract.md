---
title: "Automatic Memory Extraction"
summary: "How OpenClaw silently captures durable facts, preferences, and continuity notes from normal conversation"
read_when:
  - You want to understand how auto-memory extraction works
  - You want to know why duplicate preferences are suppressed
  - You want to tune or disable passive memory writes
  - You want to understand the storage format used for extracted memories
---

# Automatic Memory Extraction

OpenClaw can turn ordinary conversation into durable memory without the agent
calling memory tools explicitly. After every reply, the `mempalace-memory`
plugin scans the current user turn for high-value signals and silently writes
them to MemPalace drawers or diary entries.

This is intentionally passive and conservative. The goal is not to log every
message -- it is to capture the facts, preferences, and continuity notes that
would otherwise be forgotten when the session ends.

## How the agent knows about it

Auto-extraction is invisible to the agent during the conversation. The plugin
registers two extension points:

- **`before_agent_reply` hook** -- injects a system prompt section that tells
  the agent it has `memory_search` available and should use it for prior
  decisions. The agent uses tools consciously for read; writes happen passively.
- **`agent_end` hook** -- fires after every reply, outside the agent turn. The
  agent does not see this. The extraction pipeline reads the just-completed turn
  and writes any candidates to storage.

This separation means the agent never pays token overhead for extraction, and
extraction never delays a reply.

## Extraction pipeline

Each `agent_end` event triggers the following steps:

1. **Source selection** -- the pipeline reads only the current user messages in
   the active turn. It ignores assistant messages, prior turns, and any content
   already processed in this session (tracked per session key).

2. **Candidate extraction** -- user text is scanned for structured signals using
   rule-based heuristics. Each candidate carries:
   - `category` -- one of five fixed categories (see below)
   - `scope` -- `shared` (cross-agent user facts) or `private` (agent-only)
   - `summary` -- normalized, deduplicated statement
   - `evidence` -- the verbatim excerpt that triggered extraction
   - `priority` -- confidence score 0-100

3. **Filtering** -- candidates below `minConfidence` are dropped. Cooldown
   logic suppresses new writes if the session already wrote within
   `cooldownTurns` turns. Total writes per turn are capped at `maxWritesPerTurn`.

4. **Dedup check** -- for each surviving candidate, a pre-write similarity
   search runs against the target wing and room in MemPalace. If a stored entry
   scores at or above `dedupeSimilarity` (default 0.92), the candidate is
   suppressed as a duplicate.

5. **Write** -- surviving candidates are written to MemPalace. The target
   storage type depends on category and scope.

6. **Event emission** -- a `memory.auto_extract.written` event is appended to
   the workspace event log at
   `~/.openclaw/workspace-<agent>/memory/.dreams/events.jsonl`. The event
   records `written`, `duplicates`, and `skipped` counts along with a summary
   of each written entry.

## Extracted categories

| Category              | Description                                      | Default scope | Storage target |
| --------------------- | ------------------------------------------------ | ------------- | -------------- |
| `standing_preference` | Reply language, format, or style preferences     | shared        | drawer         |
| `standing_constraint` | Instructions to avoid or never do something      | shared        | drawer         |
| `long_term_goal`      | Explicit long-term goals and intentions          | shared        | drawer         |
| `explicit_remember`   | Direct "remember this" or "记住" instructions    | shared        | drawer         |
| `project_continuity`  | Continue-later notes and session handoff markers | private       | diary          |

Shared-scope categories are routed to the shared palace when
`writeSharedUserMemory: true`, `writeShared: true`, and a `sharedPalacePath`
is configured. Otherwise they fall back to private.

`project_continuity` is always private and targets the MemPalace diary for
timestamped chronicle semantics. If the diary write fails, the plugin falls back
to a drawer write so the continuity note is not lost.

## Storage format

Each extracted entry is stored in MemPalace with a canonical document text:

```
[AUTO MEMORY]
type: <category>
scope: <private|shared>
summary: <normalized summary>
evidence: <verbatim excerpt>
```

Volatile fields -- `captured_at`, `session_id`, and `channel` -- are
intentionally excluded from the document text. They are preserved in ChromaDB
metadata (`filed_at`, `filed_at_ts`) and encoded in the `source_file` path
(e.g. `auto-memory://private/standing_preference/2026-04-15`).

The reason for this design: ChromaDB embeds the document text to produce the
vector used for similarity search. Including timestamp and session fields in
the text shifts the embedding without adding semantic signal, which reduces
cosine similarity between the pre-write dedup query and the stored entry. By
keeping the document text to stable semantic fields only, the stored embedding
reliably matches the dedup query for identical or near-identical content.

### Diary format

Continuity entries use a separate format with the `[AUTO CONTINUITY]` header
to distinguish them from drawer entries inside MemPalace diary storage:

```
[AUTO CONTINUITY] <summary>
captured_at: <ISO timestamp>
session_id: <session key>
evidence: <verbatim excerpt>
```

## Duplicate suppression

Before writing, auto-extraction runs a semantic similarity check against the
target wing and room to detect near-duplicate entries already in storage.

The dedup query uses the same canonical form as the stored document:

```
[AUTO MEMORY]
type: <category>
scope: <scope>
summary: <summary>
evidence: <evidence>
```

The query is truncated to 300 characters. `searchDrawerMemories` runs a vector
search restricted to the exact target wing and room (no cross-room leakage).
The top result's `similarity` score (cosine similarity, range 0-1) is compared
to the `dedupeSimilarity` threshold (default 0.92).

If `similarity >= dedupeSimilarity`, the candidate is suppressed and counted in
the `duplicates` field of the event log entry.

### Why the threshold works

ChromaDB returns `similarity = round(1 - distance, 3)` for cosine distance.
For entries with identical semantic content, the stored document embedding and
the dedup query embedding are built from the same canonical text fields, so
similarity approaches 1.0. For genuinely different preferences (e.g. "use
Chinese" vs "use English"), similarity typically falls below 0.70. The 0.92
default leaves headroom for minor rephrasing while reliably blocking exact or
near-exact repetitions.

### Two-layer write identity

MemPalace uses a deterministic `drawer_id` keyed on `SHA1(wing + "/" + room)`
and `SHA1(document text)`. Because each write produces a new `[AUTO MEMORY]`
document with a different `captured_at` timestamp -- if that field were in the
text -- storage-level dedup via upsert would not catch repeated writes. The
pre-write vector similarity check is the active dedup layer. This is why the
document text must not include volatile fields that change per write.

## Knowledge graph writes

When `allowKgWrite: true` and a candidate's priority reaches
`kgWriteMinConfidence` (default 95), the plugin also writes a KG triple
alongside the drawer write:

- **subject** -- `userIdentity` config value (default `"User"`)
- **predicate** -- derived from category (`prefers`, `avoids`, `wants`,
  `remembers`)
- **object** -- the candidate summary (truncated to 200 characters)

KG writes are fire-and-forget. A failure does not prevent the drawer write from
completing.

## Observability

Every extraction run appends a structured event to the workspace event log:

```jsonc
{
  "type": "memory.auto_extract.written",
  "timestamp": "2026-04-15T10:30:00.000Z",
  "agentId": "jarvis-memory",
  "sessionId": "jarvis-memory:abc123",
  "written": 1,
  "duplicates": 0,
  "skipped": 0,
  "entries": [
    {
      "category": "standing_preference",
      "scope": "private",
      "summary": "请用中文回复，尽量简洁",
      "storage": "drawer",
    },
  ],
}
```

The log lives at:

```
~/.openclaw/workspace-<agentId>/memory/.dreams/events.jsonl
```

To inspect it:

```bash
tail -20 ~/.openclaw/workspace-jarvis-memory/memory/.dreams/events.jsonl | \
  grep auto_extract | jq .
```

## Dreaming promotion

The dreaming sweep (`memory dream run`) can promote recurring auto-extracted
drawers into the knowledge graph. This is controlled by:

- `dreaming.autoExtractPromotion.enabled` (default `true`)
- `dreaming.autoExtractPromotion.minHits` (default `2`) -- number of times a
  preference must appear in the lookback window before it is promoted

Only shared-scope entries are eligible for promotion. Private continuity entries
(`project_continuity`) are excluded.

## Configuration

All knobs live under `plugins.entries.mempalace-memory.config.autoExtract`.
See the [Memory configuration reference](/reference/memory-config#automatic-memory-extraction-mempalace)
for the full table of knobs.

Key settings to know:

| Setting                  | Default        | What it controls                                                                                              |
| ------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------- |
| `mode`                   | `conservative` | Extraction breadth. `conservative` requires explicit markers; `balanced` also captures implicit style signals |
| `dedupeSimilarity`       | `0.92`         | Cosine similarity threshold above which a candidate is suppressed as a duplicate                              |
| `maxWritesPerTurn`       | `2`            | Maximum drawer or diary writes per eligible turn                                                              |
| `writeSharedUserMemory`  | `true`         | Whether to route shared-scope entries to the shared palace                                                    |
| `writePrivateContinuity` | `true`         | Whether to capture `project_continuity` entries at all                                                        |
| `cooldownTurns`          | `0`            | Minimum turns between writes in the same session                                                              |
| `allowKgWrite`           | `false`        | Whether high-confidence entries also write a KG triple                                                        |
| `userIdentity`           | `"User"`       | Subject label for KG triples, used when a palace is shared across multiple identities                         |

To disable extraction entirely:

```json5
{
  plugins: {
    entries: {
      "mempalace-memory": {
        config: {
          autoExtract: {
            mode: "off",
          },
        },
      },
    },
  },
}
```
