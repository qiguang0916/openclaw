---
title: report: MemPalace memory test execution status
type: test-report
status: in-progress
date: 2026-04-15
---

# report: MemPalace memory test execution status

## Scope

This report tracks execution progress against:

- [2026-04-15-memory-auto-extract-regression-test-spec.md](/Users/qiguang/openclaw/docs/plans/2026-04-15-memory-auto-extract-regression-test-spec.md:1)

It separates:

- automated cases executed locally in this workspace
- cases that still require live MemPalace/chat-session/manual verification
- cases blocked by local runner instability rather than product failures

## Environment used

- workspace: `/Users/qiguang/openclaw`
- memory implementation under test: `extensions/mempalace-memory`
- local commands used:
  - `pnpm test extensions/mempalace-memory/src/auto-extract-config.test.ts extensions/mempalace-memory/src/auto-extract.test.ts extensions/mempalace-memory/src/dreaming.test.ts extensions/mempalace-memory/api.test.ts extensions/mempalace-memory/src/config.test.ts`
  - `pnpm test extensions/mempalace-memory/src/cli-recall.test.ts`
  - `pnpm test extensions/mempalace-memory/src/cli.dreaming.test.ts`
- previously revalidated in the current code state:
  - `pnpm tsgo`
  - `pnpm check`

## Automated execution summary

### Passed

| Area                                  | Evidence                             |
| ------------------------------------- | ------------------------------------ |
| auto-extract config                   | `auto-extract-config.test.ts` passed |
| auto-extract heuristics and routing   | `auto-extract.test.ts` passed        |
| dreaming config and promotion helpers | `dreaming.test.ts` passed            |
| API diary persistence                 | `api.test.ts` passed                 |
| MemPalace config resolution           | `config.test.ts` passed              |
| CLI recall event forwarding           | `cli-recall.test.ts` passed          |
| CLI dreaming helpers                  | `cli.dreaming.test.ts` passed        |
| typecheck                             | `pnpm tsgo` passed                   |
| lint + check chain                    | `pnpm check` passed                  |

### Blocked by local runner instability

| Area                     | Status                          | Notes                                                                                                                                                   |
| ------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| native tool tests        | blocked                         | `tools.test.ts` repeatedly hung in local Vitest worker shutdown / lock behavior                                                                         |
| plugin registration test | replaced by direct script check | direct import script confirmed `agent_end`, `before_agent_reply`, and `memory_search` registration even though `index.test.ts` remains locally unstable |

### Not yet executed because they require live/manual verification

| Area                                                            | Reason                                                |
| --------------------------------------------------------------- | ----------------------------------------------------- |
| real `memory_search` / `memory_get` against live MemPalace data | needs real MemPalace runtime and seeded palaces       |
| session-memory hook on `/new` or `/reset`                       | needs live session lifecycle                          |
| pre-compaction memory flush                                     | needs compaction-capable session runtime              |
| real shared/private cross-agent routing                         | needs at least two configured agents and live storage |
| performance budgets                                             | needs controlled timing runs and corpus scaling       |
| direct KG writes against live KG backend                        | needs live MemPalace + config toggles                 |

## Live execution summary

### Passed or partially passed live checks

| Case   | Status                  | Evidence / note                                                                                                                                                                                                                                    |
| ------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `F-01` | passed (live)           | `openclaw agent --agent jarvis-memory --message "从现在开始请用中文回复，尽量简洁。" --local --json` produced a real auto-extract write; `openclaw memory search --agent jarvis-memory --query "中文 简洁 回复" --json` returned the stored drawer |
| `F-15` | passed (live)           | current config has no `sharedWriteAgents`, and the extracted preference was correctly written as `scope: private`                                                                                                                                  |
| `F-17` | passed (live)           | `/Users/qiguang/.openclaw/workspace-jarvis-memory/memory/.dreams/events.jsonl` contains real `memory.auto_extract.written` and `memory.recall.recorded` entries                                                                                    |
| `F-18` | passed (live)           | live `memory_search` returned the newly written auto-extract drawer; after `openclaw memory dream run --agent jarvis-memory --json`, search also returned the new dreaming KG fact                                                                 |
| `F-21` | partially passed (live) | `openclaw memory dream run --agent jarvis-memory --json` completed successfully; `autoExtractPromotions` stayed `0` because the available auto-extract entries were private-scope, so they were correctly excluded from promotion                  |
| `C-05` | partially passed (live) | `openclaw memory search --agent pub-chief --query "memory" --json` and `openclaw memory dream status --agent pub-chief` both returned valid live output                                                                                            |

### Failed or inconclusive live checks

| Case   | Status                           | Evidence / note                                                                                                                                                                                      |
| ------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `F-05` | inconclusive / fallback observed | sending `下次继续优化记忆系统。` produced a real `memory.auto_extract.written` event, but `storage` was `drawer`, not `diary`; this demonstrates fallback behavior, not the ideal diary-success path |
| `F-11` | failed (live)                    | sending the same preference a second time produced another `memory.auto_extract.written` event with `duplicates: 0`, and live search returned two near-identical standing-preference drawers         |

### Live command snippets summarized

- `openclaw memory dream status --agent pub-chief` returned enabled dreaming with the configured cron and limits.
- `openclaw memory search --agent pub-chief --query "memory" --json` returned the real MemPalace identity seed for `pub-chief`.
- `openclaw memory dream run --agent jarvis-memory --json` completed successfully with one aggregate, one dreaming drawer, one dreaming KG fact, and `autoExtractPromotions: 0`.
- `openclaw agent --agent jarvis-memory --message "从现在开始请用中文回复，尽量简洁。" --local --json` triggered a real reply and a real auto-extract event.
- Repeating the same preference created a second drawer entry in live storage instead of being deduplicated.

## Test-spec mapping

### Functional cases

| Case   | Status                                         | Evidence / note                                                                                                                                                  |
| ------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `F-01` | passed (live + automated)                      | live local-agent run plus `auto-extract.test.ts`                                                                                                                 |
| `F-02` | passed (automated approximation)               | explicit remember extraction covered by `auto-extract.test.ts`                                                                                                   |
| `F-03` | passed (automated approximation)               | standing constraint extraction covered by `auto-extract.test.ts`                                                                                                 |
| `F-04` | partially covered                              | long-term goal path is covered in heuristics, but not yet separately executed as a live search/get round-trip                                                    |
| `F-05` | automated pass, live inconclusive              | `auto-extract.test.ts` covers diary routing; live environment exercised drawer fallback instead                                                                  |
| `F-06` | passed (automated)                             | diary failure fallback to drawer covered by `auto-extract.test.ts`                                                                                               |
| `F-07` | passed (automated approximation)               | conservative ignore path covered by `auto-extract.test.ts`                                                                                                       |
| `F-08` | passed (automated)                             | question-only ignore path covered by `auto-extract.test.ts`                                                                                                      |
| `F-09` | passed (automated)                             | balanced implicit brevity covered by `auto-extract.test.ts`                                                                                                      |
| `F-10` | passed (automated)                             | balanced implicit detail covered by `auto-extract.test.ts`                                                                                                       |
| `F-11` | automated pass, live failure                   | unit test passes, but live repeated preference write was not suppressed                                                                                          |
| `F-12` | passed (automated)                             | minConfidence filtering covered by `auto-extract.test.ts`                                                                                                        |
| `F-13` | not yet executed explicitly                    | current suite does not include a dedicated cooldown behavior test at the test-spec level                                                                         |
| `F-14` | passed (automated approximation)               | shared routing covered by `auto-extract.test.ts`                                                                                                                 |
| `F-15` | passed (live + automated)                      | live `jarvis-memory` run stored preference privately because shared writes are disabled                                                                          |
| `F-16` | partially covered                              | direct KG write logic exists, but no stable executed live test in this run                                                                                       |
| `F-17` | passed (live)                                  | event file inspected directly after local agent run                                                                                                              |
| `F-18` | passed (live)                                  | live write/search round-trip demonstrated for auto-extracted drawer and dreaming KG                                                                              |
| `F-19` | not yet executed                               | requires `/new` / `/reset` live hook execution                                                                                                                   |
| `F-20` | not yet executed                               | requires compaction-triggered runtime                                                                                                                            |
| `F-21` | passed (helper-level), partially passed (live) | helper mapping covered by `dreaming.test.ts`; live `dream run` succeeded but no promotion occurred because only private-scope entries were present               |
| `F-22` | passed (automated)                             | project continuity excluded from promotion in `dreaming.test.ts`                                                                                                 |
| `F-23` | partially covered                              | manual API/tool paths exist, but full CRUD/export/import execution was not completed in this run because `tools.test.ts` was blocked by local runner instability |

### Compatibility cases

| Case   | Status                | Evidence / note                                                                                                                                     |
| ------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `C-01` | not yet executed live | requires slot switching between `mempalace-memory` and `memory-core`                                                                                |
| `C-02` | not yet executed live | needs compat single-palace runtime setup                                                                                                            |
| `C-03` | not yet executed live | needs multi-agent real storage                                                                                                                      |
| `C-04` | partially covered     | `memory.auto_extract.written` consumer path covered by `dreaming.test.ts` helper-level tests                                                        |
| `C-05` | partially covered     | CLI helper tests passed; plugin registration script also confirmed key hook/tool registration. Full command-surface live verification still pending |

### Performance and stability cases

| Case   | Status                      | Evidence / note                                                                            |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------ |
| `P-01` | not yet executed            | no measured latency benchmark run yet                                                      |
| `P-02` | not yet executed            | no large corpus benchmark run yet                                                          |
| `P-03` | not yet executed            | no event-log scale run yet                                                                 |
| `P-04` | not yet executed            | no 100-turn duplicate suppression benchmark run yet                                        |
| `S-01` | partially covered           | code paths are defensive, but no live MCP-down run executed this round                     |
| `S-02` | partially covered           | duplicate-search failure path is handled in code; no dedicated executed test case recorded |
| `S-03` | not yet executed explicitly | FTS failure path exists but no explicit test run recorded                                  |
| `S-04` | not yet executed explicitly | KG failure path exists but no explicit test run recorded                                   |
| `S-05` | not yet executed explicitly | event-log write failure path is best-effort but not explicitly exercised                   |

## Current conclusion

This round achieved good automated coverage for:

- extraction heuristics
- routing
- promotion helper logic
- config parsing
- selected CLI helper behavior
- repo-level lint/typecheck health

It did **not** fully execute every case from the test spec. The biggest gaps are:

- live MemPalace integration flows
- session lifecycle hooks
- compaction-triggered memory flush
- performance benchmarking
- a few explicit error-injection cases

## Suggested next execution batches

1. Live MemPalace integration batch
   - `F-18`, `F-19`, `F-20`, `C-02`, `C-03`
2. Stability/error-injection batch
   - `S-01` to `S-05`
3. Performance batch
   - `P-01` to `P-04`
4. Runner-instability cleanup
   - re-run `tools.test.ts` and `index.test.ts` after isolating local Vitest worker shutdown behavior
