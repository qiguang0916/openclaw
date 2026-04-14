import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { searchKnowledgeGraph } from "./bridge.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map(async (dir) => await fs.rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

async function createKnowledgeGraphFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-mempalace-kg-search-"));
  tempDirs.push(dir);
  const dbPath = path.join(dir, "knowledge_graph.sqlite3");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE entities (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE triples (
        subject INTEGER NOT NULL,
        predicate TEXT NOT NULL,
        object INTEGER NOT NULL,
        valid_from TEXT,
        valid_to TEXT,
        source_file TEXT
      );
    `);
    db.prepare("INSERT INTO entities (id, name) VALUES (?, ?)").run(1, "飞书渠道配置");
    db.prepare("INSERT INTO entities (id, name) VALUES (?, ?)").run(2, "OpenClaw 工作流");
    db.prepare(
      "INSERT INTO triples (subject, predicate, object, valid_from, valid_to, source_file) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(1, "supports", 2, "2026-04-11", null, "memory://飞书/渠道/配置");
  } finally {
    db.close();
  }
  return dbPath;
}

describe("searchKnowledgeGraph", () => {
  it("expands Feishu/Lark cross-language aliases so English queries can hit Chinese facts", async () => {
    const dbPath = await createKnowledgeGraphFixture();

    const results = searchKnowledgeGraph({
      dbPath,
      query: "feishu lark channel",
      maxResults: 3,
    });

    expect(results[0]).toMatchObject({
      subject: "飞书渠道配置",
      predicate: "supports",
      object: "OpenClaw 工作流",
    });
  });
});
