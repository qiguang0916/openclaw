import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import {
  summarizeToolResultForPersistence,
  type ToolResultPersistenceMeta,
} from "./tool-result-persistence-summary.js";

type ToolResultMessage = Extract<AgentMessage, { role: "toolResult" }>;

function summarize(message: ToolResultMessage, meta: ToolResultPersistenceMeta) {
  return summarizeToolResultForPersistence(message, meta) as ToolResultMessage;
}

describe("summarizeToolResultForPersistence", () => {
  it("summarizes large exec output while preserving details", () => {
    const details = {
      status: "completed",
      exitCode: 0,
      durationMs: 2_345,
      aggregated: `line 1\n${"x".repeat(8_000)}\nline tail`,
      cwd: "/tmp/demo",
    };
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "call_exec",
      toolName: "exec",
      isError: false,
      timestamp: Date.now(),
      content: [{ type: "text", text: details.aggregated }],
      details,
    };

    const summarized = summarize(message, {
      toolCallId: "call_exec",
      toolName: "exec",
      isSynthetic: false,
    });

    const text = (summarized.content[0] as { text: string }).text;
    expect(text).toContain("[Exec output summarized for persisted transcript]");
    expect(text).toContain("Status: completed (exit 0), 2.3s");
    expect(text).toContain("cwd: /tmp/demo");
    expect(text).toContain("Head excerpt:");
    expect(text).toContain("Tail excerpt:");
    expect(text).toContain("omitted from persisted transcript");
    expect(text.length).toBeLessThan((message.content[0] as { text: string }).text.length);
    expect(summarized.details).toEqual(details);
  });

  it("summarizes gateway config snapshots instead of persisting full config text", () => {
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "call_gateway",
      toolName: "gateway",
      isError: false,
      timestamp: Date.now(),
      content: [
        { type: "text", text: JSON.stringify({ ok: true, result: { huge: true } }, null, 2) },
      ],
      details: {
        ok: true,
        result: {
          hash: "hash-123",
          path: "/tmp/openclaw.json",
          config: {
            agents: {},
            channels: {},
            gateway: {},
            plugins: {},
            tools: {},
            update: {},
            ui: {},
          },
        },
      },
    };

    const summarized = summarize(message, {
      toolCallId: "call_gateway",
      toolName: "gateway",
      isSynthetic: false,
    });

    const text = (summarized.content[0] as { text: string }).text;
    expect(text).toContain("[Gateway config result summarized for persisted transcript]");
    expect(text).toContain("Action: config.get");
    expect(text).toContain("Hash: hash-123");
    expect(text).toContain("Path: /tmp/openclaw.json");
    expect(text).toContain(
      "Config keys: agents, channels, gateway, plugins, tools, update (+1 more)",
    );
    expect(text).toContain("Full config payload omitted from persisted transcript");
    expect(summarized.details).toEqual(message.details);
  });

  it("leaves small exec output unchanged", () => {
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "call_small",
      toolName: "exec",
      isError: false,
      timestamp: Date.now(),
      content: [{ type: "text", text: "short output" }],
      details: {
        status: "completed",
        exitCode: 0,
      },
    };

    const summarized = summarize(message, {
      toolCallId: "call_small",
      toolName: "exec",
      isSynthetic: false,
    });
    expect(summarized).toBe(message);
  });

  it("prefers compact list summaries for oversized skills exec output", () => {
    const lines = [
      "Skills (37/61 ready)",
      "Status     Skill                 Description",
      "✓          skill-a               First skill",
      "✓          skill-b               Second skill",
      "△          skill-c               Needs setup",
      "✓          skill-d               Fourth skill",
      "✓          skill-e               Fifth skill",
      "✓          skill-f               Sixth skill",
      "✓          skill-g               Seventh skill",
      "✓          skill-h               Eighth skill",
      "✓          skill-i               Ninth skill",
      "✓          skill-j               Tenth skill",
      "✓          skill-k               Eleventh skill",
      `${"x".repeat(7_000)}`,
    ];
    const text = lines.join("\n");
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "call_skills",
      toolName: "exec",
      isError: false,
      timestamp: Date.now(),
      content: [{ type: "text", text }],
      details: {
        status: "completed",
        exitCode: 0,
        aggregated: text,
      },
    };

    const summarized = summarize(message, {
      toolCallId: "call_skills",
      toolName: "exec",
      isSynthetic: false,
    });

    const summarizedText = (summarized.content[0] as { text: string }).text;
    expect(summarizedText).toContain("[Exec skill list summarized for persisted transcript]");
    expect(summarizedText).toContain("Heading: Skills (37/61 ready)");
    expect(summarizedText).toContain("Entries parsed: 11");
    expect(summarizedText).toContain("Needs attention: skill-c");
    expect(summarizedText).toContain(
      "Sample skills: skill-a, skill-b, skill-c, skill-d, skill-e (+6 more)",
    );
    expect(summarizedText).toContain("skill-a");
    expect(summarizedText).not.toContain("Status     Skill");
    expect(summarizedText).not.toContain("First entries:");
    expect(summarizedText).toContain("omitted from persisted transcript");
  });

  it("prefers compact list summaries for oversized plugins exec output", () => {
    const lines = [
      "Plugins (46/98 loaded)",
      "Status     Plugin                Description",
      "loaded     alpha-plugin          First plugin",
      "loaded     beta-plugin           Second plugin",
      "disabled   gamma-plugin          Disabled plugin",
      "loaded     delta-plugin          Fourth plugin",
      "loaded     epsilon-plugin        Fifth plugin",
      `${"y".repeat(7_000)}`,
    ];
    const text = lines.join("\n");
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "call_plugins",
      toolName: "exec",
      isError: false,
      timestamp: Date.now(),
      content: [{ type: "text", text }],
      details: {
        status: "completed",
        exitCode: 0,
        aggregated: text,
      },
    };

    const summarized = summarize(message, {
      toolCallId: "call_plugins",
      toolName: "exec",
      isSynthetic: false,
    });

    const summarizedText = (summarized.content[0] as { text: string }).text;
    expect(summarizedText).toContain("[Exec plugin list summarized for persisted transcript]");
    expect(summarizedText).toContain("Heading: Plugins (46/98 loaded)");
    expect(summarizedText).toContain("Entries parsed: 5");
    expect(summarizedText).toContain("Non-loaded / attention: gamma-plugin");
    expect(summarizedText).toContain(
      "Sample plugins: alpha-plugin, beta-plugin, gamma-plugin, delta-plugin, epsilon-plugin",
    );
    expect(summarizedText).not.toContain("Description");
    expect(summarizedText).toContain("omitted from persisted transcript");
  });

  it("ignores wrapped continuation rows in plugins tables", () => {
    const text = [
      "Plugins (47/98 loaded)",
      "Source roots:",
      "  stock: /tmp/stock",
      "  global: /tmp/global",
      "",
      "┌──────────────┬──────────┬──────────┬──────────┬────────────────────┬──────────┐",
      "│ Name         │ ID       │ Format   │ Status   │ Source             │ Version  │",
      "├──────────────┼──────────┼──────────┼──────────┼────────────────────┼──────────┤",
      "│ MemPalace    │ mempalac │ openclaw │ loaded   │ /tmp/index.ts      │ 0.1.0    │",
      "│ OpenClaw     │ e        │          │          │ recall memory      │          │",
      "│ Integration  │          │          │          │ plugin             │          │",
      "│ ACPX Runtime │ acpx     │ openclaw │ loaded   │ stock:acpx/index.js│ 2026.4.6 │",
      "│ @openclaw/   │ alibaba  │ openclaw │ disabled │ stock:ali/index.js │ 2026.4.6 │",
      "│ alibaba-     │          │          │          │ provider plugin    │          │",
      `${"z".repeat(7_000)}`,
    ].join("\n");

    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "call_plugins_wrapped",
      toolName: "exec",
      isError: false,
      timestamp: Date.now(),
      content: [{ type: "text", text }],
      details: {
        status: "completed",
        exitCode: 0,
        aggregated: text,
      },
    };

    const summarized = summarize(message, {
      toolCallId: "call_plugins_wrapped",
      toolName: "exec",
      isSynthetic: false,
    });

    const summarizedText = (summarized.content[0] as { text: string }).text;
    expect(summarizedText).toContain("Entries parsed: 3");
    expect(summarizedText).toContain("Non-loaded / attention: alibaba");
    expect(summarizedText).toContain("Sample plugins: MemPalace, ACPX Runtime, alibaba");
    expect(summarizedText).not.toContain("mempalac");
    expect(summarizedText).not.toContain("Integration");
  });
});
