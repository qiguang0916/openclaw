import type { MemoryPluginRuntime } from "openclaw/plugin-sdk/memory-core";
import {
  closeAllMempalaceMemorySearchManagers,
  getMempalaceMemorySearchManager,
} from "./manager.js";

export const mempalaceMemoryRuntime: MemoryPluginRuntime = {
  async getMemorySearchManager(params) {
    return await getMempalaceMemorySearchManager(params);
  },
  resolveMemoryBackendConfig() {
    return { backend: "builtin" };
  },
  async closeAllMemorySearchManagers() {
    await closeAllMempalaceMemorySearchManagers();
  },
};
