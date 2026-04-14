---
title: "Dreaming (experimental)"
summary: "Background memory consolidation with light, deep, and REM phases plus a Dream Diary"
read_when:
  - You want memory promotion to run automatically
  - You want to understand what each dreaming phase does
  - You want to tune consolidation without polluting MEMORY.md
---

# Dreaming (experimental)

Dreaming is the background memory consolidation system for the active memory
plugin.

Current deployment note:

- **MemPalace-native dreaming** is now the practical primary path.
- **Legacy `memory-core` dreaming** remains as a file-backed compatibility lane.

Both paths keep the same broad phase ideas, but they write to different storage
substrates.

Dreaming is **opt-in** and disabled by default.

## What dreaming writes

MemPalace-native dreaming writes:

- **recall and dreaming events** in `memory/.dreams/events.jsonl`
- **light output** to MemPalace diary
- **REM output** to MemPalace drawers
- **deep output** to MemPalace KG facts

Legacy file-backed `memory-core` dreaming keeps the older outputs:

- machine state in `memory/.dreams/`
- human-readable output in `DREAMS.md`
- durable promotion into `MEMORY.md`

## Phase model

Dreaming uses three cooperative phases:

| Phase | Purpose                                   | Primary MemPalace output |
| ----- | ----------------------------------------- | ------------------------ |
| Light | Sort and stage recent short-term material | Diary                    |
| Deep  | Score and reinforce durable candidates    | KG facts                 |
| REM   | Reflect on themes and recurring ideas     | Drawer synthesis         |

These phases are internal implementation details, not separate user-configured
"modes."

### Light phase

Light phase ingests recent recall signals, compresses them into continuity
patterns, and writes the result into MemPalace diary output.

### Deep phase

Deep phase decides what becomes durable memory reinforcement.

- In the MemPalace path, it reinforces durable KG facts.
- In the legacy file-backed path, it promotes entries into `MEMORY.md`.

### REM phase

REM phase extracts patterns and reflective signals.

- In the MemPalace path, it writes associative drawer summaries.
- In the legacy file-backed path, it writes managed REM markdown output.

## Dream Diary

MemPalace-native dreaming keeps diary continuity inside MemPalace diary output.
Legacy file-backed dreaming keeps a narrative **Dream Diary** in `DREAMS.md`.

## Deep ranking signals

Deep ranking uses six weighted base signals plus phase reinforcement:

| Signal              | Weight | Description                                       |
| ------------------- | ------ | ------------------------------------------------- |
| Frequency           | 0.24   | How many short-term signals the entry accumulated |
| Relevance           | 0.30   | Average retrieval quality for the entry           |
| Query diversity     | 0.15   | Distinct query/day contexts that surfaced it      |
| Recency             | 0.15   | Time-decayed freshness score                      |
| Consolidation       | 0.10   | Multi-day recurrence strength                     |
| Conceptual richness | 0.06   | Concept-tag density from snippet/path             |

Light and REM phase hits add a small recency-decayed boost from
`memory/.dreams/phase-signals.json`.

## Scheduling

When enabled, the active memory plugin auto-manages one cron job for a full
dreaming sweep. Each sweep runs phases in order: light -> REM -> deep.

Default cadence behavior:

| Setting              | Default     |
| -------------------- | ----------- |
| `dreaming.frequency` | `0 3 * * *` |

## Quick start

Enable legacy file-backed dreaming:

```json
{
  "plugins": {
    "entries": {
      "memory-core": {
        "config": {
          "dreaming": {
            "enabled": true
          }
        }
      }
    }
  }
}
```

Enable legacy file-backed dreaming with a custom sweep cadence:

```json
{
  "plugins": {
    "entries": {
      "memory-core": {
        "config": {
          "dreaming": {
            "enabled": true,
            "timezone": "America/Los_Angeles",
            "frequency": "0 */6 * * *"
          }
        }
      }
    }
  }
}
```

## Command surfaces

```
/dreaming status
/dreaming on
/dreaming off
/dreaming help
```

For the active MemPalace path, prefer:

```bash
openclaw memory dream status
openclaw memory dream run
openclaw memory dream run --json
```

## CLI workflow

Use legacy file-backed CLI promotion for preview or manual apply:

```bash
openclaw memory promote
openclaw memory promote --apply
openclaw memory promote --limit 5
openclaw memory status --deep
```

Manual `memory promote` is the legacy `memory-core` path and uses deep-phase
thresholds by default unless overridden with CLI flags.

Explain why a specific candidate would or would not promote:

```bash
openclaw memory promote-explain "router vlan"
openclaw memory promote-explain "router vlan" --json
```

Preview REM reflections, candidate truths, and deep promotion output without
writing anything:

```bash
openclaw memory rem-harness
openclaw memory rem-harness --json
```

## Key defaults

Legacy file-backed settings live under `plugins.entries.memory-core.config.dreaming`.
MemPalace-native dreaming settings live under `plugins.entries.mempalace-memory.config.dreaming`.

| Key         | Default     |
| ----------- | ----------- |
| `enabled`   | `false`     |
| `frequency` | `0 3 * * *` |

Phase policy, thresholds, and storage behavior are internal implementation
details (not user-facing config).

See [Memory configuration reference](/reference/memory-config#dreaming-experimental)
for the full key list.

## Dreams UI

When enabled, the Gateway **Dreams** tab shows:

- current dreaming enabled state
- phase-level status and managed-sweep presence
- short-term, long-term, and promoted-today counts
- next scheduled run timing
- an expandable Dream Diary reader backed by `doctor.memory.dreamDiary`

## Related

- [Memory](/concepts/memory)
- [Memory Search](/concepts/memory-search)
- [memory CLI](/cli/memory)
- [Memory configuration reference](/reference/memory-config)
