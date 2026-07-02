import { describe, it, expect } from "vitest";
import {
  fromImStatus,
  fromExecutionStatus,
  AGENT_STATUS_META,
  type AgentStatus,
} from "@/lib/agent-status";

// ─── fromImStatus ──────────────────────────────────────────────

describe("fromImStatus", () => {
  it("maps uppercase IM states to unified lowercase enum", () => {
    expect(fromImStatus("IDLE")).toBe("idle");
    expect(fromImStatus("BUSY")).toBe("working");
    expect(fromImStatus("WAKING")).toBe("waking");
    expect(fromImStatus("ERROR")).toBe("error");
    expect(fromImStatus("WAITING")).toBe("waiting");
  });

  it("maps lowercase IM states to unified enum", () => {
    expect(fromImStatus("idle")).toBe("idle");
    expect(fromImStatus("busy")).toBe("working");
    expect(fromImStatus("working")).toBe("working");
    expect(fromImStatus("waking")).toBe("waking");
    expect(fromImStatus("error")).toBe("error");
    expect(fromImStatus("waiting")).toBe("waiting");
  });

  it("maps 'paused' to 'waiting'", () => {
    expect(fromImStatus("paused")).toBe("waiting");
  });

  it("defaults unknown states to 'idle'", () => {
    expect(fromImStatus("unknown")).toBe("idle");
    expect(fromImStatus("")).toBe("idle");
    expect(fromImStatus("OFFLINE")).toBe("idle");
    expect(fromImStatus("STOPPED")).toBe("idle");
  });
});

// ─── fromExecutionStatus ───────────────────────────────────────

describe("fromExecutionStatus", () => {
  it("maps pipeline/execution states to unified agent status", () => {
    expect(fromExecutionStatus("running")).toBe("working");
    expect(fromExecutionStatus("completed")).toBe("idle");
    expect(fromExecutionStatus("done")).toBe("idle");
    expect(fromExecutionStatus("failed")).toBe("error");
    expect(fromExecutionStatus("error")).toBe("error");
    expect(fromExecutionStatus("paused")).toBe("waiting");
    expect(fromExecutionStatus("waiting")).toBe("waiting");
  });

  it("defaults unknown states to 'idle'", () => {
    expect(fromExecutionStatus("cancelled")).toBe("idle");
    expect(fromExecutionStatus("")).toBe("idle");
    expect(fromExecutionStatus("queued")).toBe("idle");
  });
});

// ─── AGENT_STATUS_META ────────────────────────────────────────

describe("AGENT_STATUS_META", () => {
  const allStatuses: AgentStatus[] = ["idle", "working", "waking", "error", "waiting"];

  it("has metadata for all 5 agent statuses", () => {
    for (const status of allStatuses) {
      expect(AGENT_STATUS_META[status]).toBeDefined();
      expect(AGENT_STATUS_META[status].color).toBeTruthy();
      expect(AGENT_STATUS_META[status].label).toBeTruthy();
      expect(AGENT_STATUS_META[status].labelZh).toBeTruthy();
      expect(typeof AGENT_STATUS_META[status].pulse).toBe("boolean");
    }
  });

  it("pulse is true only for working and waking", () => {
    expect(AGENT_STATUS_META.idle.pulse).toBe(false);
    expect(AGENT_STATUS_META.working.pulse).toBe(true);
    expect(AGENT_STATUS_META.waking.pulse).toBe(true);
    expect(AGENT_STATUS_META.error.pulse).toBe(false);
    expect(AGENT_STATUS_META.waiting.pulse).toBe(false);
  });

  it("uses CSS variable references for colors", () => {
    for (const status of allStatuses) {
      expect(AGENT_STATUS_META[status].color).toMatch(/^var\(--/);
    }
  });

  it("provides both English and Chinese labels", () => {
    expect(AGENT_STATUS_META.idle.label).toBe("Idle");
    expect(AGENT_STATUS_META.idle.labelZh).toBe("空闲");
    expect(AGENT_STATUS_META.working.label).toBe("Working");
    expect(AGENT_STATUS_META.working.labelZh).toBe("运行中");
    expect(AGENT_STATUS_META.error.label).toBe("Error");
    expect(AGENT_STATUS_META.error.labelZh).toBe("错误");
  });
});

// ─── Status resolution patterns ────────────────────────────────

describe("Status resolution integration", () => {
  it("IM → Agent status roundtrip preserves semantics", () => {
    const imStates = ["IDLE", "BUSY", "WAKING", "ERROR", "WAITING"];
    const expected: AgentStatus[] = ["idle", "working", "waking", "error", "waiting"];

    for (let i = 0; i < imStates.length; i++) {
      const unified = fromImStatus(imStates[i]);
      expect(unified).toBe(expected[i]);
      // Verify metadata is accessible
      expect(AGENT_STATUS_META[unified]).toBeDefined();
    }
  });

  it("Execution → Agent status roundtrip preserves semantics", () => {
    const execStates = ["running", "completed", "failed", "paused"];
    const expected: AgentStatus[] = ["working", "idle", "error", "waiting"];

    for (let i = 0; i < execStates.length; i++) {
      const unified = fromExecutionStatus(execStates[i]);
      expect(unified).toBe(expected[i]);
      expect(AGENT_STATUS_META[unified]).toBeDefined();
    }
  });

  it("all unified statuses have corresponding CSS dot classes", () => {
    // These match the CSS classes in globals.css: .status-dot.idle, .status-dot.working, etc.
    const cssClasses = ["idle", "working", "waking", "error", "waiting"];
    for (const status of cssClasses) {
      expect(AGENT_STATUS_META[status as AgentStatus]).toBeDefined();
    }
  });
});
