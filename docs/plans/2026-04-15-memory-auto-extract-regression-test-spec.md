---
title: test-spec: MemPalace memory auto-extract and regression coverage
type: test-spec
status: proposed
date: 2026-04-15
---

# test-spec: MemPalace memory auto-extract and regression coverage

## Purpose

This document defines a complete test suite for the OpenClaw memory system with
special focus on:

- the new automatic memory extraction flow in `mempalace-memory`
- regression coverage for pre-existing memory features
- compatibility behavior across active-memory, shared/private, and legacy
  compatibility surfaces
- performance and stability expectations

Each test case includes:

- test case ID
- objective
- preconditions
- test data
- steps
- expected results

## Scope

### In Scope

- MemPalace-backed active memory:
  - `memory_search`
  - `memory_get`
  - `memory_write`
  - `memory_update`
  - `memory_delete`
  - `memory_export`
  - `memory_import`
- auto-extract:
  - `agent_end` extraction
  - conservative vs balanced modes
  - shared/private routing
  - dedupe
  - cooldown
  - minimum-confidence filter
  - optional direct KG writes
  - continuity diary write with drawer fallback
  - event emission
- session-memory hook
- pre-compaction memory flush
- MemPalace-native dreaming
- auto-extract promotion into dreaming/KG

### Out of Scope

- deep evaluation of embedding-model semantic quality
- end-user UI design or styling
- non-MemPalace third-party memory plugins
- full legacy `memory-core` promotion correctness beyond compatibility checks

## References

- `extensions/mempalace-memory/src/auto-extract.ts`
- `extensions/mempalace-memory/src/auto-extract-config.ts`
- `extensions/mempalace-memory/src/dreaming.ts`
- `extensions/mempalace-memory/src/dreaming-helpers.ts`
- `extensions/mempalace-memory/src/flush-plan.ts`
- `extensions/mempalace-memory/src/tools.ts`
- `src/hooks/bundled/session-memory/handler.ts`
- `src/memory-host-sdk/events.ts`
- `docs/reference/memory-config.md`

## Test Environment

### Required Environment

- Node 22+
- OpenClaw repo with `plugins.slots.memory = "mempalace-memory"`
- working MemPalace MCP server
- one test agent with workspace and private palace
- optional shared palace enabled for shared-routing cases
- isolated temp workspace for destructive CRUD tests

### Suggested Agent Fixtures

| Fixture ID | Purpose                         | Key config                          |
| ---------- | ------------------------------- | ----------------------------------- |
| `A1`       | default MemPalace agent         | private palace only                 |
| `A2`       | shared-memory agent             | private + shared palace enabled     |
| `A3`       | single-palace compat mode agent | compat single palace mode           |
| `A4`       | auto-extract conservative       | `autoExtract.mode = "conservative"` |
| `A5`       | auto-extract balanced           | `autoExtract.mode = "balanced"`     |

## Reusable Test Data

### Message Dataset

| Data ID | Purpose                        | Input                                                            |
| ------- | ------------------------------ | ---------------------------------------------------------------- |
| `M1`    | explicit preference            | `从现在开始请用中文回复，尽量简洁。`                             |
| `M2`    | explicit remember              | `记住这个：以后先给结论，再给细节。`                             |
| `M3`    | standing constraint            | `以后不要用表情，回答里不要太花。`                               |
| `M4`    | long-term goal                 | `我的长期目标是把 Jarvis 的记忆系统做稳定，而且不能太耗 token。` |
| `M5`    | continuity                     | `下次继续优化记忆系统。`                                         |
| `M6`    | balanced-only implicit brevity | `你刚才回复太长了，后面短一点。`                                 |
| `M7`    | balanced-only implicit detail  | `你刚才太简略了，下次说详细一点。`                               |
| `M8`    | non-durable task request       | `帮我把这个报错看一下。`                                         |
| `M9`    | question only                  | `你觉得要不要用中文回复？`                                       |
| `M10`   | duplicate restatement          | `从现在开始请用中文回复，尽量简洁。`                             |

### Manual CRUD Content Dataset

| Data ID | Purpose               | Content                                        |
| ------- | --------------------- | ---------------------------------------------- |
| `C1`    | searchable drawer     | `Jarvis prefers concise Chinese replies.`      |
| `C2`    | update target         | `Initial durable note for memory_update test.` |
| `C3`    | delete target         | `Delete me after verification.`                |
| `C4`    | import drawer payload | `Imported memory drawer example.`              |
| `C5`    | KG fact payload       | `User -> prefers -> Chinese concise replies`   |

### Expected Category Mapping

| Message data | Expected category                                                         | Scope   | Default storage |
| ------------ | ------------------------------------------------------------------------- | ------- | --------------- |
| `M1`         | `standing_preference`                                                     | shared  | drawer          |
| `M2`         | `standing_preference` or `explicit_remember` depending on cleaned summary | shared  | drawer          |
| `M3`         | `standing_constraint`                                                     | shared  | drawer          |
| `M4`         | `long_term_goal`                                                          | shared  | drawer          |
| `M5`         | `project_continuity`                                                      | private | diary           |
| `M6`         | `standing_preference` in balanced mode only                               | shared  | drawer          |
| `M7`         | `standing_preference` in balanced mode only                               | shared  | drawer          |
| `M8`         | none                                                                      | n/a     | none            |
| `M9`         | none                                                                      | n/a     | none            |

## Test Execution Levels

| Level       | Purpose                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| Unit        | validate extraction heuristics, config parsing, promotion candidate logic |
| Integration | validate MemPalace write/search/get/event flows                           |
| End-to-end  | validate chat/session lifecycle behavior                                  |
| Performance | validate latency and throughput budgets                                   |
| Stability   | validate error handling and fallback behavior                             |

## Functional Test Cases

### F-01 Auto-extract explicit preference in conservative mode

| Field            | Value                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test ID          | `F-01`                                                                                                                                                   |
| Objective        | Verify that a durable preference is auto-extracted after reply completion                                                                                |
| Preconditions    | `A4` active; shared palace enabled                                                                                                                       |
| Test data        | `M1`                                                                                                                                                     |
| Steps            | 1. Send `M1` in a normal user session. 2. Wait for assistant reply and `agent_end` hook completion. 3. Query memory via `memory_search "中文 简洁 回复"` |
| Expected results | 1. One durable entry is written. 2. Entry category is preference-like. 3. Search returns the new entry. 4. Entry is stored in shared drawer space.       |

### F-02 Auto-extract explicit remember instruction

| Field            | Value                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Test ID          | `F-02`                                                                                                                                           |
| Objective        | Verify explicit "remember this" instructions are captured                                                                                        |
| Preconditions    | `A4` active                                                                                                                                      |
| Test data        | `M2`                                                                                                                                             |
| Steps            | 1. Send `M2`. 2. Inspect event log `memory/.dreams/events.jsonl`. 3. Search memory for `先给结论`                                                |
| Expected results | 1. Exactly one auto-extract write event appears. 2. Event contains one written entry. 3. Summary reflects the durable instruction after cleanup. |

### F-03 Auto-extract standing constraint

| Field            | Value                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Test ID          | `F-03`                                                                                                                 |
| Objective        | Verify standing constraints are captured                                                                               |
| Preconditions    | `A4` active                                                                                                            |
| Test data        | `M3`                                                                                                                   |
| Steps            | 1. Send `M3`. 2. Search for `不要 表情` or `no emojis` semantic equivalent.                                            |
| Expected results | 1. One constraint entry is persisted. 2. Search returns the constraint. 3. Category in event is `standing_constraint`. |

### F-04 Auto-extract long-term goal

| Field            | Value                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Test ID          | `F-04`                                                                                         |
| Objective        | Verify explicit long-term goals are captured                                                   |
| Preconditions    | `A4` active                                                                                    |
| Test data        | `M4`                                                                                           |
| Steps            | 1. Send `M4`. 2. Search for `长期目标 token 稳定`                                              |
| Expected results | 1. One `long_term_goal` entry is persisted. 2. Entry is shared when shared writes are enabled. |

### F-05 Auto-extract continuity note to diary

| Field            | Value                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Test ID          | `F-05`                                                                                                                     |
| Objective        | Verify project continuity notes are routed to diary first                                                                  |
| Preconditions    | `A4` active; MemPalace diary write available                                                                               |
| Test data        | `M5`                                                                                                                       |
| Steps            | 1. Send `M5`. 2. Inspect emitted auto-extract event. 3. Read diary for the current agent.                                  |
| Expected results | 1. Written entry exists. 2. Event `storage` is `diary`. 3. Scope is `private`. 4. Continuity note appears in diary output. |

### F-06 Diary fallback to drawer when diary write fails

| Field            | Value                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| Test ID          | `F-06`                                                                                                              |
| Objective        | Verify continuity notes are not lost when diary write fails                                                         |
| Preconditions    | Inject failure for `mempalace_diary_write`                                                                          |
| Test data        | `M5`                                                                                                                |
| Steps            | 1. Mock diary write failure. 2. Send `M5`. 3. Search private memory for `继续优化记忆系统`                          |
| Expected results | 1. No fatal turn failure. 2. Continuity note is written as private drawer fallback. 3. Event `storage` is `drawer`. |

### F-07 Conservative mode ignores non-durable task request

| Field            | Value                                                                   |
| ---------------- | ----------------------------------------------------------------------- |
| Test ID          | `F-07`                                                                  |
| Objective        | Verify one-off task requests are ignored                                |
| Preconditions    | `A4` active                                                             |
| Test data        | `M8`                                                                    |
| Steps            | 1. Send `M8`. 2. Inspect event log. 3. Search memory for the task text. |
| Expected results | 1. No auto-extract write event. 2. No new memory entry.                 |

### F-08 Conservative mode ignores question-only text

| Field            | Value                                  |
| ---------------- | -------------------------------------- |
| Test ID          | `F-08`                                 |
| Objective        | Verify bare questions are not captured |
| Preconditions    | `A4` active                            |
| Test data        | `M9`                                   |
| Steps            | 1. Send `M9`. 2. Inspect event log.    |
| Expected results | No durable memory write occurs.        |

### F-09 Balanced mode captures implicit brevity feedback

| Field            | Value                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| Test ID          | `F-09`                                                                                                    |
| Objective        | Verify balanced mode captures implicit style feedback                                                     |
| Preconditions    | `A5` active                                                                                               |
| Test data        | `M6`                                                                                                      |
| Steps            | 1. Send `M6`. 2. Search for `prefer concise replies` or Chinese equivalent.                               |
| Expected results | 1. One preference entry is written in balanced mode. 2. Same input in conservative mode should not write. |

### F-10 Balanced mode captures implicit detail feedback

| Field            | Value                                                                               |
| ---------------- | ----------------------------------------------------------------------------------- |
| Test ID          | `F-10`                                                                              |
| Objective        | Verify balanced mode captures implicit request for more detail                      |
| Preconditions    | `A5` active                                                                         |
| Test data        | `M7`                                                                                |
| Steps            | 1. Send `M7`. 2. Search for detail preference memory.                               |
| Expected results | 1. One preference entry is written. 2. Summary reflects preference for more detail. |

### F-11 Duplicate suppression on repeated durable signal

| Field            | Value                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Test ID          | `F-11`                                                                                                                                          |
| Objective        | Verify repeated statements do not create duplicate memory spam                                                                                  |
| Preconditions    | `A4` active; previous `M1` already persisted                                                                                                    |
| Test data        | `M10`                                                                                                                                           |
| Steps            | 1. Send `M10` again. 2. Inspect auto-extract event counts. 3. Search result count for the exact preference.                                     |
| Expected results | 1. Entry is suppressed as duplicate. 2. Search result count does not increase by more than one canonical hit. 3. Event records duplicate count. |

### F-12 Min-confidence filter prevents low-priority candidates

| Field            | Value                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------- |
| Test ID          | `F-12`                                                                                        |
| Objective        | Verify `minConfidence` blocks weaker candidates                                               |
| Preconditions    | `autoExtract.minConfidence = 80`                                                              |
| Test data        | `M5`                                                                                          |
| Steps            | 1. Send `M5`. 2. Inspect results.                                                             |
| Expected results | `project_continuity` is not written because its default priority is lower than the threshold. |

### F-13 Cooldown prevents repeated writes within same session

| Field            | Value                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Test ID          | `F-13`                                                                                                                     |
| Objective        | Verify `cooldownTurns` suppresses writes only within the same session                                                      |
| Preconditions    | `autoExtract.cooldownTurns = 2`                                                                                            |
| Test data        | `M1`, `M3`                                                                                                                 |
| Steps            | 1. Send `M1` in session `S1`. 2. Immediately send `M3` in the same session. 3. Start session `S2`. 4. Send `M3` in `S2`.   |
| Expected results | 1. `S1` second write is suppressed by cooldown. 2. `S2` write is allowed. 3. Cooldown behavior is per session, not global. |

### F-14 Shared routing when shared palace is enabled

| Field            | Value                                                             |
| ---------------- | ----------------------------------------------------------------- |
| Test ID          | `F-14`                                                            |
| Objective        | Verify shared user facts route to shared palace                   |
| Preconditions    | `A2` active with shared writes enabled                            |
| Test data        | `M1`                                                              |
| Steps            | 1. Send `M1`. 2. Inspect written drawer location and event scope. |
| Expected results | 1. Scope is `shared`. 2. Entry lands in shared palace.            |

### F-15 Private fallback when shared palace is unavailable

| Field            | Value                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Test ID          | `F-15`                                                                                   |
| Objective        | Verify graceful fallback when shared writes are disabled                                 |
| Preconditions    | same as `A1`; shared writes disabled                                                     |
| Test data        | `M1`                                                                                     |
| Steps            | 1. Send `M1`. 2. Inspect storage location.                                               |
| Expected results | 1. No failure. 2. Entry is stored privately. 3. Event scope reflects actual write scope. |

### F-16 Optional direct KG write for high-confidence candidates

| Field            | Value                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| Test ID          | `F-16`                                                                                                          |
| Objective        | Verify direct KG writes happen only when allowed                                                                |
| Preconditions    | `allowKgWrite = true`, `kgWriteMinConfidence = 95`                                                              |
| Test data        | `M2` or another high-priority explicit instruction                                                              |
| Steps            | 1. Send high-confidence durable signal. 2. Query KG.                                                            |
| Expected results | 1. Drawer write still occurs. 2. KG write also occurs. 3. If `allowKgWrite = false`, no direct KG write occurs. |

### F-17 Auto-extract event emission

| Field            | Value                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Test ID          | `F-17`                                                                                                                                     |
| Objective        | Verify `memory.auto_extract.written` event is appended correctly                                                                           |
| Preconditions    | `A4` active                                                                                                                                |
| Test data        | `M1`                                                                                                                                       |
| Steps            | 1. Send `M1`. 2. Inspect `memory/.dreams/events.jsonl`.                                                                                    |
| Expected results | Event contains `agentId`, `sessionId`, `written`, `duplicates`, `skipped`, and `entries[]` with `category`, `scope`, `summary`, `storage`. |

### F-18 Search/Get regression after auto-extract write

| Field            | Value                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Test ID          | `F-18`                                                                                     |
| Objective        | Verify extracted drawers remain readable through canonical memory interfaces               |
| Preconditions    | One auto-extracted drawer exists                                                           |
| Test data        | any written auto-extract entry                                                             |
| Steps            | 1. Run `memory_search`. 2. Take returned synthetic path. 3. Run `memory_get` on that path. |
| Expected results | 1. Search finds the entry. 2. Get returns exact stored text.                               |

### F-19 Session-memory hook regression

| Field            | Value                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| Test ID          | `F-19`                                                                                                   |
| Objective        | Verify `/new` or `/reset` still stores session summaries correctly                                       |
| Preconditions    | `session-memory` hook enabled                                                                            |
| Test data        | one short session conversation                                                                           |
| Steps            | 1. Have a short chat. 2. Issue `/new`. 3. Inspect MemPalace or fallback file output.                     |
| Expected results | Session summary is persisted to active memory backend; fallback file path is used only on write failure. |

### F-20 Pre-compaction memory flush regression

| Field            | Value                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| Test ID          | `F-20`                                                                                                              |
| Objective        | Verify memory flush still works alongside auto-extract                                                              |
| Preconditions    | long conversation near compaction threshold                                                                         |
| Test data        | include one durable instruction late in the transcript                                                              |
| Steps            | 1. Drive conversation near compaction threshold. 2. Trigger compaction. 3. Inspect memory writes and recallability. |
| Expected results | Durable note is preserved even if it was not captured earlier by normal-turn extraction.                            |

### F-21 Dreaming promotion of repeated auto-extract facts

| Field            | Value                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| Test ID          | `F-21`                                                                                                        |
| Objective        | Verify recurring auto-extract entries become promotion candidates                                             |
| Preconditions    | `dreaming.autoExtractPromotion.enabled = true`, `minHits = 2`                                                 |
| Test data        | send `M1` or equivalent durable signal in at least 2 eligible sessions                                        |
| Steps            | 1. Produce repeated shared auto-extract events. 2. Run `openclaw memory dream run --agent <id>`. 3. Query KG. |
| Expected results | 1. Candidate appears in promotion input. 2. Dreaming promotes it to KG when threshold met.                    |

### F-22 Dreaming ignores non-promotable continuity notes

| Field            | Value                                                                         |
| ---------------- | ----------------------------------------------------------------------------- |
| Test ID          | `F-22`                                                                        |
| Objective        | Verify `project_continuity` entries do not get promoted as durable user facts |
| Preconditions    | multiple continuity events exist                                              |
| Test data        | repeated `M5`                                                                 |
| Steps            | 1. Produce multiple continuity writes. 2. Run dreaming promotion logic.       |
| Expected results | No promotion candidate is created for `project_continuity`.                   |

### F-23 Manual CRUD regression

| Field            | Value                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Test ID          | `F-23`                                                                                                                                          |
| Objective        | Verify pre-existing manual memory workflows still work                                                                                          |
| Preconditions    | `A1` active                                                                                                                                     |
| Test data        | `C1`, `C2`, `C3`, `C4`, `C5`                                                                                                                    |
| Steps            | 1. `memory_write` with `C1/C2/C3`. 2. `memory_update` on `C2`. 3. `memory_delete` on `C3`. 4. `memory_export`. 5. `memory_import` with `C4/C5`. |
| Expected results | All CRUD and batch flows work unchanged and remain compatible with auto-extracted entries.                                                      |

## Compatibility Test Cases

### C-01 Active-memory slot compatibility

| Field            | Value                                                                           |
| ---------------- | ------------------------------------------------------------------------------- |
| Test ID          | `C-01`                                                                          |
| Objective        | Verify auto-extract only runs when `mempalace-memory` is the active memory slot |
| Preconditions    | compare `plugins.slots.memory = "mempalace-memory"` vs `"memory-core"`          |
| Test data        | `M1`                                                                            |
| Steps            | 1. Run same conversation in both configs.                                       |
| Expected results | Auto-extract runs only in MemPalace-active config.                              |

### C-02 Single-palace compat mode

| Field            | Value                                                    |
| ---------------- | -------------------------------------------------------- |
| Test ID          | `C-02`                                                   |
| Objective        | Verify writes still succeed in compat single-palace mode |
| Preconditions    | `A3` active                                              |
| Test data        | `M1`, `M5`                                               |
| Steps            | 1. Send durable signals. 2. Search and read them back.   |
| Expected results | Writes succeed, search/get work, no routing crash.       |

### C-03 Shared/private isolation across agents

| Field            | Value                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------- |
| Test ID          | `C-03`                                                                                        |
| Objective        | Verify private continuity stays agent-local while shared user facts are cross-agent visible   |
| Preconditions    | agents `A2-main` and `A2-helper` share user palace but have different private palaces         |
| Test data        | `M1`, `M5`                                                                                    |
| Steps            | 1. Extract shared preference and private continuity in `A2-main`. 2. Search from `A2-helper`. |
| Expected results | Shared preference is recallable by helper agent; private continuity is not.                   |

### C-04 Event-log compatibility

| Field            | Value                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Test ID          | `C-04`                                                                                          |
| Objective        | Verify event consumers handle `memory.auto_extract.written` cleanly                             |
| Preconditions    | event log contains recall, dream, promotion, and auto-extract events                            |
| Test data        | mixed event log                                                                                 |
| Steps            | 1. Run event readers and dreaming candidate collection.                                         |
| Expected results | Existing readers do not break; auto-extract events are parsed and consumed only where relevant. |

### C-05 Legacy memory command compatibility

| Field            | Value                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test ID          | `C-05`                                                                                                                                                         |
| Objective        | Verify legacy-compatible CLI surfaces still behave as documented                                                                                               |
| Preconditions    | MemPalace active                                                                                                                                               |
| Test data        | existing memory entries                                                                                                                                        |
| Steps            | 1. Run `openclaw memory status`, `search`, `dream status`, `dream run`. 2. Confirm legacy-only commands remain explicitly unsupported or compatibility-scoped. |
| Expected results | CLI help and behavior remain consistent with docs.                                                                                                             |

## Performance Test Cases

### P-01 Reply latency overhead from auto-extract

| Field            | Value                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Test ID          | `P-01`                                                                                                                                                             |
| Objective        | Quantify user-visible latency impact                                                                                                                               |
| Preconditions    | compare with `autoExtract.enabled = false` and `true`                                                                                                              |
| Test data        | `M1`, `M4`, `M8`                                                                                                                                                   |
| Steps            | 1. Measure end-to-end reply latency over 30 turns in each mode. 2. Record median and p95.                                                                          |
| Expected results | Auto-extract should not materially increase reply latency because it runs fire-and-forget after reply. Suggested budget: p95 increase <= 150 ms user-visible path. |

### P-02 Search latency after many auto-extracted entries

| Field            | Value                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Test ID          | `P-02`                                                                                     |
| Objective        | Verify retrieval remains fast after growth in extracted memory volume                      |
| Preconditions    | seed 1k, 5k, and 10k mixed drawer entries                                                  |
| Test data        | repeated synthetic durable preferences/goals/constraints                                   |
| Steps            | 1. Run representative searches at each corpus size.                                        |
| Expected results | Search remains within acceptable SLA for target environment; no pathological growth trend. |

### P-03 Dreaming promotion throughput

| Field            | Value                                                                            |
| ---------------- | -------------------------------------------------------------------------------- |
| Test ID          | `P-03`                                                                           |
| Objective        | Verify dreaming promotion can process recurring auto-extract events at scale     |
| Preconditions    | event log with 500+ auto-extract events                                          |
| Test data        | repeated `standing_preference` and `standing_constraint` entries across sessions |
| Steps            | 1. Run dreaming. 2. Measure total duration and memory usage.                     |
| Expected results | Dreaming completes without timeouts or unbounded memory growth.                  |

### P-04 Duplicate suppression cost

| Field            | Value                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| Test ID          | `P-04`                                                                                              |
| Objective        | Verify dedupe search cost stays bounded                                                             |
| Preconditions    | large shared/private palace                                                                         |
| Test data        | repeated `M10`                                                                                      |
| Steps            | 1. Repeat duplicate statements across 100 turns. 2. Measure hook time and write count.              |
| Expected results | Duplicate writes remain near zero after first insert; dedupe search does not cause runaway latency. |

## Stability and Error-Handling Test Cases

### S-01 MemPalace MCP unavailable

| Field            | Value                                                                         |
| ---------------- | ----------------------------------------------------------------------------- |
| Test ID          | `S-01`                                                                        |
| Objective        | Verify turn does not fail when MemPalace is unavailable                       |
| Preconditions    | disable or break MCP server                                                   |
| Test data        | `M1`                                                                          |
| Steps            | 1. Send `M1`.                                                                 |
| Expected results | 1. User reply still succeeds. 2. Auto-extract logs warning only. 3. No crash. |

### S-02 Search error during dedupe

| Field            | Value                                                       |
| ---------------- | ----------------------------------------------------------- |
| Test ID          | `S-02`                                                      |
| Objective        | Verify write path is not blocked by duplicate-check failure |
| Preconditions    | inject `searchDrawerMemories` failure                       |
| Test data        | `M1`                                                        |
| Steps            | 1. Send `M1`.                                               |
| Expected results | Write still proceeds best-effort; warning logged.           |

### S-03 FTS update failure after successful write

| Field            | Value                                               |
| ---------------- | --------------------------------------------------- |
| Test ID          | `S-03`                                              |
| Objective        | Verify FTS sync failure does not fail durable write |
| Preconditions    | inject `writeFtsEntry` failure                      |
| Test data        | `M1`                                                |
| Steps            | 1. Send `M1`. 2. Inspect drawer existence and logs. |
| Expected results | Drawer write succeeds; warning logged for FTS only. |

### S-04 KG write failure in direct KG mode

| Field            | Value                                                      |
| ---------------- | ---------------------------------------------------------- |
| Test ID          | `S-04`                                                     |
| Objective        | Verify direct KG failure does not break drawer persistence |
| Preconditions    | `allowKgWrite = true`; inject KG tool failure              |
| Test data        | `M2`                                                       |
| Steps            | 1. Send `M2`.                                              |
| Expected results | Drawer write still succeeds; KG warning logged.            |

### S-05 Event-log write failure

| Field            | Value                                                    |
| ---------------- | -------------------------------------------------------- |
| Test ID          | `S-05`                                                   |
| Objective        | Verify event persistence is best-effort                  |
| Preconditions    | make event log path unwritable                           |
| Test data        | `M1`                                                     |
| Steps            | 1. Send `M1`.                                            |
| Expected results | Memory extraction still succeeds; no user-visible error. |

## Regression Matrix

| Area                     | Must still work after auto-extract changes                      |
| ------------------------ | --------------------------------------------------------------- |
| Recall                   | `memory_search`, `memory_get`, prompt-section guidance          |
| Manual writes            | `memory_write`, `memory_update`, `memory_delete`, import/export |
| Session lifecycle        | `/new`, `/reset`, session-memory hook                           |
| Compaction               | pre-compaction memory flush                                     |
| Dreaming                 | light/REM/deep outputs and verify command                       |
| CLI                      | `openclaw memory status/search/dream ...`                       |
| Shared/private isolation | unchanged semantics                                             |

## Recommended Automation Split

### Unit or mocked integration

- `F-01` to `F-17`
- `S-02` to `S-05`

### Real MemPalace integration

- `F-18` to `F-23`
- `C-01` to `C-05`

### Load/performance bench

- `P-01` to `P-04`

## Exit Criteria

The memory optimization and regression lane is considered test-complete when:

1. All functional cases pass.
2. Shared/private routing is verified across at least two agents.
3. Auto-extract event emission and dreaming promotion both pass with real event
   logs.
4. No regression is observed in manual memory CRUD, search/get, session-memory,
   or compaction flush.
5. Performance budgets stay within agreed thresholds.
6. Error-injection cases confirm that memory failures do not break the user
   reply path.

## Reviewer Notes

- This spec is intentionally broader than the current automated test files. It
  includes cases not yet fully automated, especially around performance,
  end-to-end session lifecycle, and real MemPalace behavior.
- If another model reviews implementation completeness, it should compare actual
  automated coverage against this spec and identify which cases are still manual
  or missing.
