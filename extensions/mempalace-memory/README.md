# @openclaw/mempalace-memory

MemPalace-backed OpenClaw memory plugin for active runtime recall and tool-driven
memory flush.

Current state:

- active-memory primary path for this deployment when `plugins.slots.memory = "mempalace-memory"`
- explicit `kind: "memory"` plugin with slot-ready runtime registration
- config surface for per-agent private palaces and a shared-user palace
- working MemPalace-backed `memory_search`
- working `memory_get` for stable synthetic paths returned by `memory_search`
- shared compatibility aliases for CRUD/batch workflows:
  `memory_write`, `memory_kg_query`, `memory_stats`,
  `memory_update`, `memory_delete`, `memory_export`, `memory_import`
- native MemPalace tool passthroughs for advanced workflows:
  `mempalace_status`, `mempalace_search`, `mempalace_check_duplicate`,
  `mempalace_add_drawer`, `mempalace_kg_query`, `mempalace_kg_add`,
  `mempalace_kg_invalidate`, `mempalace_kg_timeline`,
  `mempalace_diary_read`, `mempalace_diary_write`
- working active memory runtime status/probe shell
- generic status/doctor support for non-`memory-core` active memory slots
- tool-driven pre-compaction memory flush routed through MemPalace tools
- session-memory hook writes to MemPalace first, then falls back to workspace files only if needed
- MemPalace-native dreaming writes diary + drawer + KG outputs and exposes `openclaw memory dream status|run`
- automatic `agent_end` memory extraction: rule-based extractor captures user preferences, constraints,
  goals, explicit remember instructions, and project continuity notes without explicit tool calls
- auto-extract shared/private routing: user-level facts route to the shared palace; agent continuity
  notes route to the private palace
- auto-extract deduplication, cooldown, and FTS write for each extracted drawer entry
- optional direct KG writes for high-confidence candidates (`autoExtract.allowKgWrite`)
- project continuity extracted to diary, with drawer fallback when diary is unavailable
- dreaming integration: auto-extracted entries that recur across sessions are promoted to KG
  during the scheduled dreaming pass (`dreaming.autoExtractPromotion`)

Still missing before production cutover:

- richer upstream drawer-id contract for even cheaper direct lookups
- polishing of the remaining `openclaw memory ...` legacy subcommands
- final cleanup of `memory-core` legacy docs/help surfaces and compatibility paths
- broader migration/cleanup of legacy file-memory docs and optional hooks
