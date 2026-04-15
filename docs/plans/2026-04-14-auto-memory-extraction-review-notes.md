---
title: review-notes: MemPalace automatic memory extraction MVP
type: review-notes
status: implemented
date: 2026-04-14
---

# review-notes: MemPalace automatic memory extraction MVP

## Purpose

This document explains what changed in the first automatic-memory-extraction
implementation, why each change was made, what was intentionally deferred, and
what another model or reviewer should challenge.

The goal is to make the rationale inspectable instead of forcing reviewers to
reverse-engineer intent from the diff alone.

## Summary

The implementation adds a conservative automatic memory extraction MVP to the
`mempalace-memory` plugin.

It does not use a second LLM call. It uses a rule-based extractor on
`agent_end`, targets durable user memory and explicit continuity hints, writes
only drawer entries, performs duplicate suppression, and routes shared user
memory separately from agent-private continuity memory.

## Changed Files

- [extensions/mempalace-memory/index.ts](/Users/qiguang/openclaw/extensions/mempalace-memory/index.ts:1)
- [extensions/mempalace-memory/src/auto-extract-config.ts](/Users/qiguang/openclaw/extensions/mempalace-memory/src/auto-extract-config.ts:1)
- [extensions/mempalace-memory/src/auto-extract.ts](/Users/qiguang/openclaw/extensions/mempalace-memory/src/auto-extract.ts:1)
- [extensions/mempalace-memory/src/auto-extract-config.test.ts](/Users/qiguang/openclaw/extensions/mempalace-memory/src/auto-extract-config.test.ts:1)
- [extensions/mempalace-memory/src/auto-extract.test.ts](/Users/qiguang/openclaw/extensions/mempalace-memory/src/auto-extract.test.ts:1)
- [extensions/mempalace-memory/index.test.ts](/Users/qiguang/openclaw/extensions/mempalace-memory/index.test.ts:1)
- [docs/plans/2026-04-14-auto-memory-extraction-mempalace-plan.md](/Users/qiguang/openclaw/docs/plans/2026-04-14-auto-memory-extraction-mempalace-plan.md:1)

## What Was Optimized

### 1. Added a dedicated `autoExtract` config surface

Implemented in:

- [extensions/mempalace-memory/src/auto-extract-config.ts](/Users/qiguang/openclaw/extensions/mempalace-memory/src/auto-extract-config.ts:1)

Why:

- automatic memory needs its own throttle and policy controls
- conservative defaults reduce rollout risk
- configuration keeps the behavior reviewable and reversible

Key choices:

- default mode is `conservative`
- extraction is enabled by default in that conservative mode
- config controls max writes, max source/candidate sizes, dedupe threshold, and
  shared/private behavior

Why this is reasonable:

- the heuristics are strict enough that a default-on conservative mode should
  stay quiet for normal task requests
- explicit config escape hatches still exist for disablement or future tuning

Main challenge a reviewer should raise:

- should default-on be kept, or should this ship default-off until more live
  quality data exists?

### 2. Added a post-reply `agent_end` extraction pipeline

Implemented in:

- [extensions/mempalace-memory/src/auto-extract.ts](/Users/qiguang/openclaw/extensions/mempalace-memory/src/auto-extract.ts:1)
- [extensions/mempalace-memory/index.ts](/Users/qiguang/openclaw/extensions/mempalace-memory/index.ts:1)

Why:

- `agent_end` runs after the user-visible reply path, so extraction does not
  add reply latency
- the hook already has access to session and agent metadata
- it avoids introducing a separate orchestration agent or frontend-only
  listener

Why this is reasonable:

- it aligns with existing OpenClaw lifecycle surfaces
- it keeps memory ownership inside the active memory plugin

Main challenge a reviewer should raise:

- should some extraction happen on `llm_output` instead for finer-grained reply
  visibility, or is `agent_end` the better tradeoff for stability?

### 3. Chose rule-based extraction instead of an extra LLM pass

Implemented in:

- [extensions/mempalace-memory/src/auto-extract.ts](/Users/qiguang/openclaw/extensions/mempalace-memory/src/auto-extract.ts:1)

Why:

- the user explicitly cares about token efficiency
- a rule-based MVP is easier to test and reason about
- it minimizes rollout complexity and failure coupling

What it captures now:

- explicit remember instructions
- standing preferences
- standing constraints
- long-term goals
- explicit "continue later" continuity notes

What it intentionally does not capture yet:

- generic task requests
- ambiguous preferences
- model-generated summaries
- direct KG facts from loose conversational inference

Why this is reasonable:

- it biases toward precision over recall in the first cut
- it avoids polluting durable memory with one-off task instructions

Main challenge a reviewer should raise:

- are the current regex and persistence markers too strict for real-world user
  language variation?

### 4. Limited extraction to current-turn user content

Implemented in:

- [extensions/mempalace-memory/src/auto-extract.ts](/Users/qiguang/openclaw/extensions/mempalace-memory/src/auto-extract.ts:52)

Why:

- processing the whole transcript every turn would cause duplicate work and more
  false positives
- reading only the current-turn user messages avoids self-poisoning from model
  output

Why this is reasonable:

- the feature is meant to persist durable user signals, not reinterpret old
  conversation every turn

Main challenge a reviewer should raise:

- should multi-turn aggregation happen before extraction in a future phase for
  cases where a durable fact emerges across several user messages?

### 5. Added shared vs private routing for drawer writes

Implemented in:

- [extensions/mempalace-memory/src/auto-extract.ts](/Users/qiguang/openclaw/extensions/mempalace-memory/src/auto-extract.ts:187)

Why:

- user-level preferences and durable goals should be available to multiple
  agents when shared memory is configured
- agent-specific continuity should stay private

Current routing:

- shared scope for standing user memory when shared writes are available
- private scope for continuity memory
- fallback to private when shared writes are not enabled

Why this is reasonable:

- it uses the storage topology already present in `mempalace-memory`
- it avoids blocking extraction just because shared storage is unavailable

Main challenge a reviewer should raise:

- should shared fallback to private be explicit in the stored content so later
  migration can promote those memories?

### 6. Kept the MVP drawer-only

Implemented in:

- [extensions/mempalace-memory/src/auto-extract.ts](/Users/qiguang/openclaw/extensions/mempalace-memory/src/auto-extract.ts:279)

Why:

- drawers preserve evidence without prematurely hardening facts
- direct KG writes from heuristic extraction are higher risk
- drawer-first is easier to audit and recover from

Why this is reasonable:

- it matches the principle of "evidence first, promotion later"
- it fits the existing plan to let dreaming or later higher-confidence logic
  promote stable facts

Main challenge a reviewer should raise:

- is there a small subset of facts that are safe enough for immediate KG writes
  even in MVP?

### 7. Added duplicate suppression before write

Implemented in:

- [extensions/mempalace-memory/src/auto-extract.ts](/Users/qiguang/openclaw/extensions/mempalace-memory/src/auto-extract.ts:293)

Why:

- automatic memory without dedupe becomes retrieval noise very quickly
- the same user standing instruction is likely to repeat across sessions

Current behavior:

- searches the target palace before writing
- suppresses the write when similarity exceeds the configured threshold

Why this is reasonable:

- it reuses the same broad principle already used in manual `memory_write`
- it is cheap enough for the conservative MVP

Main challenge a reviewer should raise:

- should dedupe search be scoped by wing/room only, or should it sometimes look
  across all user-memory wings?

## Simplifications Made Intentionally

- No extra LLM extraction call. _(still true — rule-based only)_
- No cross-turn synthesis beyond the current-turn user message slice. _(still true)_
- No migration or backfill of previous transcripts. _(still true)_

The following items listed as simplifications in the initial draft have since
been implemented:

- ~~No KG writes.~~ Direct KG writes are now supported via `autoExtract.allowKgWrite`
  (disabled by default). Dreaming promotion also writes KG facts for high-frequency entries.
- ~~No diary writes.~~ `project_continuity` candidates are written to diary, with drawer fallback.
- ~~No new memory-host event type yet.~~ `memory.auto_extract.written` event type added.
- ~~No shared/private routing.~~ Shared user facts route to the shared palace; continuity notes route private.

## Tradeoffs

### Benefits

- low token overhead
- low reply-latency risk
- easier deterministic testing
- safer first production step

### Costs

- lower recall than an LLM-assisted extractor
- more dependence on trigger wording
- some durable facts may be missed if the user states them indirectly

## Verification Performed

### Passed

- `pnpm test extensions/mempalace-memory/src/auto-extract-config.test.ts`
- `pnpm test extensions/mempalace-memory/src/auto-extract.test.ts`
- `pnpm test extensions/mempalace-memory/api.test.ts`
- `pnpm test extensions/mempalace-memory/src/config.test.ts`
- `pnpm tsgo`
- `pnpm check`

### Additional registration proof

Since the registry-oriented `index.test.ts` had unstable local worker shutdown
behavior in this environment, plugin registration was also validated with a
direct script that imported the plugin and asserted:

- `agent_end` hook is registered
- `before_agent_reply` hook remains registered
- `memory_search` tool remains registered

## Open Questions For Other Models

1. Is the conservative default strict enough to justify shipping as default-on,
   or should it be default-off until live data proves precision?
2. Is `agent_end` the right long-term trigger, or should extraction partially
   move to `llm_output` or another lifecycle surface?
3. Should shared user-memory fallback-to-private add explicit provenance tags to
   ease later promotion?
4. Is drawer-only the right MVP, or is there a narrow class of KG-safe facts
   worth promoting immediately?
5. Are the current persistence markers too English/Chinese specific, and if so,
   what is the lightest multilingual improvement that does not require an extra
   LLM pass?

## Implementation Status (as of 2026-04-15)

All four phases described in the plan have been delivered:

- **Phase 1** (`a7d55e5056`): conservative drawer-first MVP with `agent_end` hook,
  eligibility gate, deduplication, shared/private routing, FTS write, diary for continuity.
- **Phase 2**: shared/private routing was included in Phase 1.
- **Phase 3**: direct KG writes available via `autoExtract.allowKgWrite` (off by default).
- **Phase 4** (`e515adf4d1`): dreaming integration — `collectAutoExtractPromotionCandidates`
  promotes high-frequency shared entries to KG during the dreaming cron pass.

## Remaining Open Questions

1. Are the current persistence markers too English/Chinese specific? Lightest multilingual
   improvement without an extra LLM pass is to expand PERSISTENCE_RE and category regexes.
2. Should shared user-memory fallback-to-private add explicit provenance tags to ease
   later migration?
3. Is drawer-only the right MVP default, or is there a narrow class of KG-safe facts worth
   promoting at `minConfidence: 95` even in conservative mode out of the box?
4. Should `balanced` mode include an optional LLM-assisted extraction sub-pass for cases
   where rule coverage is too low?
