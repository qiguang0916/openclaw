import { describe, expect, it } from "vitest";
import { createTestPluginApi } from "../../test/helpers/plugins/plugin-api.js";
import plugin from "./index.js";
import { MEMPALACE_COMPAT_TOOL_NAMES, MEMPALACE_NATIVE_TOOL_NAMES } from "./src/tools.js";

describe("mempalace-memory plugin tool registration", () => {
  it("registers recall and native MemPalace mutation/query tools", () => {
    const registeredNames: string[] = [];
    const registeredHooks: string[] = [];
    const api = createTestPluginApi({
      registerTool(_tool, meta) {
        registeredNames.push(...(meta?.names ?? []));
      },
      on(hookName) {
        registeredHooks.push(hookName);
      },
    });

    plugin.register?.(api);

    expect(registeredNames).toEqual(
      expect.arrayContaining([
        "memory_search",
        "memory_get",
        ...MEMPALACE_COMPAT_TOOL_NAMES,
        ...MEMPALACE_NATIVE_TOOL_NAMES,
      ]),
    );
    expect(registeredHooks).toEqual(expect.arrayContaining(["before_agent_reply", "agent_end"]));
  });
});
