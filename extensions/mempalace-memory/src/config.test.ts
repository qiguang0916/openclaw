import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMempalacePluginConfig } from "./config.js";

const realHomeDir = os.homedir();
const homedirSpy = vi.spyOn(os, "homedir");
const tempDirs: string[] = [];

afterEach(async () => {
  homedirSpy.mockReset();
  homedirSpy.mockReturnValue(realHomeDir);
  await Promise.all(
    tempDirs.map(async (dir) => await fs.rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

async function createTempHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-mempalace-home-"));
  tempDirs.push(dir);
  homedirSpy.mockReturnValue(dir);
  return dir;
}

describe("resolveMempalacePluginConfig", () => {
  it("defaults the shared knowledge graph to the .mempalace-data convention", async () => {
    const homeDir = await createTempHome();

    const resolved = resolveMempalacePluginConfig(
      {
        mcp: {
          servers: {
            mempalace: {
              command: "python",
            },
          },
        },
      } as never,
      "main",
    );

    expect(resolved.sharedKnowledgeGraphPath).toBe(
      path.join(homeDir, ".mempalace-data", "knowledge_graph.sqlite3"),
    );
  });

  it("replaces an empty .mempalace-data KG file with a symlink to the populated legacy KG", async () => {
    const homeDir = await createTempHome();
    const legacyPath = path.join(homeDir, ".mempalace", "knowledge_graph.sqlite3");
    const canonicalPath = path.join(homeDir, ".mempalace-data", "knowledge_graph.sqlite3");
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.mkdir(path.dirname(canonicalPath), { recursive: true });
    await fs.writeFile(legacyPath, "legacy triples", "utf-8");
    await fs.writeFile(canonicalPath, "", "utf-8");

    const resolved = resolveMempalacePluginConfig(
      {
        plugins: {
          entries: {
            "mempalace-memory": {
              config: {
                sharedKnowledgeGraphPath: "~/.mempalace/knowledge_graph.sqlite3",
              },
            },
          },
        },
        mcp: {
          servers: {
            mempalace: {
              command: "python",
            },
          },
        },
      } as never,
      "main",
    );

    expect(resolved.sharedKnowledgeGraphPath).toBe(canonicalPath);
    const stat = await fs.lstat(canonicalPath);
    expect(stat.isSymbolicLink()).toBe(true);
    await expect(fs.readlink(canonicalPath)).resolves.toBe(legacyPath);
  });
});
