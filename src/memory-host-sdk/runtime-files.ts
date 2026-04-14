// Focused runtime contract for memory file/backend access.

export { listMemoryFiles, normalizeExtraMemoryPaths } from "./host/internal.js";
export { readAgentMemoryFile } from "./host/read-file.js";
export { resolveMemoryBackendConfig } from "./host/backend-config.js";
export type {
  MemoryEmbeddingProbeResult,
  MemoryProviderStatus,
  MemorySearchManager,
  MemorySearchResult,
  MemorySyncProgressUpdate,
} from "./host/types.js";
