import type { MemoryPromptSectionBuilder } from "openclaw/plugin-sdk/memory-core";

export const buildPromptSection: MemoryPromptSectionBuilder = ({ availableTools }) => {
  if (!availableTools.has("memory_search") && !availableTools.has("memory_get")) {
    return [];
  }

  return [
    "## MemPalace Memory",
    "For prior decisions, user preferences, project history, and continuity questions: use memory_search before answering from memory.",
    "Use memory_get only for paths returned by memory_search when you need the exact stored text.",
    "Keep recall cheap: one short search first, then answer; do not perform broad multi-step memory work unless needed.",
    "",
  ];
};
