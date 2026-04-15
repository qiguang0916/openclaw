---
title: "Memory Overview"
summary: "How OpenClaw remembers things across sessions"
read_when:
  - You want to understand how memory works
  - You want to know what memory files to write
---

# Memory Overview

OpenClaw remembers things through the **active memory plugin**. In this
deployment, the practical primary path is MemPalace-backed memory via
`mempalace-memory`, while `memory-core` remains as a legacy file-backed
compatibility lane.

The model only "remembers" what gets saved to a durable substrate -- there is
no hidden state.

## How it works

Legacy file-backed memory uses three memory-related files:

- **`MEMORY.md`** -- long-term memory. Durable facts, preferences, and
  decisions. Loaded at the start of every DM session.
- **`memory/YYYY-MM-DD.md`** -- daily notes. Running context and observations.
  Today and yesterday's notes are loaded automatically.
- **`DREAMS.md`** (experimental, optional) -- Dream Diary and dreaming sweep
  summaries for human review.

Those files live in the agent workspace (default `~/.openclaw/workspace`) and
remain relevant for the legacy `memory-core` lane.

MemPalace-backed memory separates the same ideas into:

- **drawers** for verbatim evidence
- **knowledge graph** for durable facts and relationships
- **diary** for agent reflection and continuity

<Tip>
If you want your agent to remember something, just ask it: "Remember that I
prefer TypeScript." It will write it to the appropriate file.
</Tip>

## Memory tools

The agent has two canonical tools for working with memory:

- **`memory_search`** -- finds relevant notes using semantic search, even when
  the wording differs from the original.
- **`memory_get`** -- reads a specific memory file or line range.

Both tools are provided by the active memory plugin. When
`mempalace-memory` owns the slot, the same `memory_search` and `memory_get`
interface runs on top of MemPalace instead of legacy file memory.

## Memory search

When an embedding provider is configured, `memory_search` uses **hybrid
search** -- combining vector similarity (semantic meaning) with keyword matching
(exact terms like IDs and code symbols). This works out of the box once you have
an API key for any supported provider.

<Info>
OpenClaw auto-detects your embedding provider from available API keys. If you
have an OpenAI, Gemini, Voyage, or Mistral key configured, memory search is
enabled automatically.
</Info>

For details on how search works, tuning options, and provider setup, see
[Memory Search](/concepts/memory-search).

## Memory backends

<CardGroup cols={3}>
<Card title="Builtin (legacy default)" icon="database" href="/concepts/memory-builtin">
SQLite-based compatibility backend for the legacy file-backed `memory-core`
lane. Works out of the box with keyword search, vector similarity, and hybrid
search.
</Card>
<Card title="QMD (legacy sidecar)" icon="search" href="/concepts/memory-qmd">
Optional local-first sidecar for the legacy `memory-core` lane, with reranking,
query expansion, and the ability to index directories outside the workspace.
</Card>
<Card title="Honcho" icon="brain" href="/concepts/memory-honcho">
AI-native cross-session memory with user modeling, semantic search, and
multi-agent awareness. Plugin install.
</Card>
</CardGroup>

## Automatic memory extraction

When `mempalace-memory` is the active memory plugin, OpenClaw silently captures
durable facts from every conversation turn without the agent calling tools
explicitly. After each reply, a background hook scans the user turn for:

- stated preferences and constraints
- explicit "remember this" instructions
- long-term goals
- session handoff and continuity notes

Extracted entries are written to MemPalace drawers or diary. Before each write,
a vector similarity check suppresses near-duplicate entries so the same
preference is not stored repeatedly.

For full details on how extraction works, the dedup mechanism, storage format
design, and observability, see [Automatic Memory Extraction](/concepts/memory-auto-extract).

## Automatic memory flush

Before [compaction](/concepts/compaction) summarizes your conversation, OpenClaw
runs a silent turn that reminds the agent to save important context to the
active memory backend. This is on by default.

<Tip>
The memory flush prevents context loss during compaction. If your agent has
important facts in the conversation that are not yet persisted, they will be
saved automatically before the summary happens.
</Tip>

## Dreaming (experimental)

Dreaming is an optional background consolidation pass for memory.

- In the active MemPalace path, dreaming writes diary + drawer + KG outputs.
- In the legacy `memory-core` path, dreaming writes file-backed artifacts such
  as `MEMORY.md` and `DREAMS.md`.

It is designed to keep long-term memory high signal:

- **Opt-in**: disabled by default.
- **Scheduled**: when enabled, the active memory plugin auto-manages the
  recurring dreaming sweep.
- **Thresholded**: promotions must pass score, recall frequency, and query
  diversity gates.
- **Reviewable**: both the MemPalace path and the legacy file-backed path keep
  auditable outputs and event traces.

For phase behavior, scoring signals, and Dream Diary details, see
[Dreaming (experimental)](/concepts/dreaming).

## CLI

```bash
openclaw memory status          # Check index status and provider
openclaw memory search "query"  # Search from the command line
openclaw memory index --force   # Rebuild the index
```

## Further reading

- [Automatic Memory Extraction](/concepts/memory-auto-extract) -- how passive per-turn extraction, dedup, and diary routing work
- [Builtin Memory Engine](/concepts/memory-builtin) -- legacy SQLite compatibility backend
- [QMD Memory Engine](/concepts/memory-qmd) -- optional sidecar for the legacy `memory-core` lane
- [Honcho Memory](/concepts/memory-honcho) -- AI-native cross-session memory
- [Memory Search](/concepts/memory-search) -- search pipeline, providers, and
  tuning
- [Dreaming (experimental)](/concepts/dreaming) -- background promotion
  from short-term recall to long-term memory
- [Memory configuration reference](/reference/memory-config) -- all config knobs
- [Compaction](/concepts/compaction) -- how compaction interacts with memory
