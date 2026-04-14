import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { buildSyntheticPath, parseSyntheticPath, readKnowledgeGraphFact } from "./bridge.js";

describe("MemPalace synthetic paths", () => {
  it("round-trips drawer paths with exact wing and room metadata", () => {
    const relPath = buildSyntheticPath({
      scope: "private",
      kind: "drawer",
      wing: "wing_openclaw/产品",
      room: "decisions & plans",
      text: "Remember this exact drawer content.",
    });

    expect(parseSyntheticPath(relPath)).toEqual({
      scope: "private",
      kind: "drawer",
      version: "v1",
      wing: "wing_openclaw/产品",
      room: "decisions & plans",
      digest: expect.any(String),
    });
  });

  it("round-trips KG paths with exact fact metadata", () => {
    const relPath = buildSyntheticPath({
      scope: "shared",
      kind: "kg",
      subject: "贾维斯",
      predicate: "prefers",
      object: "low-token recall",
      validFrom: "2026-04-11",
      validTo: null,
      text: "贾维斯 -> prefers -> low-token recall\nvalid_from: 2026-04-11\nvalid_to: current",
    });

    expect(parseSyntheticPath(relPath)).toEqual({
      scope: "shared",
      kind: "kg",
      version: "v1",
      subject: "贾维斯",
      predicate: "prefers",
      object: "low-token recall",
      validFrom: "2026-04-11",
      validTo: undefined,
      digest: expect.any(String),
    });
  });
});

describe("readKnowledgeGraphFact", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map(async (dir) => await fs.rm(dir, { recursive: true, force: true })),
    );
    tempDirs.length = 0;
  });

  it("reads an exact KG fact directly from sqlite using synthetic path metadata", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mempalace-kg-read-"));
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
      db.prepare("INSERT INTO entities (id, name) VALUES (?, ?)").run(1, "Jarvis");
      db.prepare("INSERT INTO entities (id, name) VALUES (?, ?)").run(
        2,
        "mempalace unified memory works",
      );
      db.prepare(
        "INSERT INTO triples (subject, predicate, object, valid_from, valid_to, source_file) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(1, "equals", 2, "2026-04-11", null, "memory://kg");
    } finally {
      db.close();
    }

    const expectedText =
      "Jarvis -> equals -> mempalace unified memory works\nvalid_from: 2026-04-11\nvalid_to: current\nsource_file: memory://kg";
    const relPath = buildSyntheticPath({
      scope: "private",
      kind: "kg",
      subject: "Jarvis",
      predicate: "equals",
      object: "mempalace unified memory works",
      validFrom: "2026-04-11",
      validTo: null,
      text: expectedText,
    });
    const parsed = parseSyntheticPath(relPath);
    expect(parsed?.kind).toBe("kg");
    if (!parsed || parsed.kind !== "kg") {
      throw new Error("Expected a parsed KG synthetic path");
    }

    const fact = readKnowledgeGraphFact({
      dbPath,
      subject: parsed.subject,
      predicate: parsed.predicate,
      object: parsed.object,
      validFrom: parsed.validFrom,
      validTo: parsed.validTo,
      digest: parsed.digest,
    });

    expect(fact?.text).toBe(expectedText);
    expect(fact?.subject).toBe("Jarvis");
    expect(fact?.predicate).toBe("equals");
  });
});
