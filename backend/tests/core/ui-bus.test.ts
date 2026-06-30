import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkspaceUIBus, getWorkspaceUIBus } from "../../src/runtime/ui-bus";

describe("WorkspaceUIBus", () => {
  let bus: WorkspaceUIBus;

  beforeEach(() => {
    bus = new WorkspaceUIBus();
  });

  describe("constructor", () => {
    it("creates an instance with default maxBuffer", () => {
      expect(bus).toBeInstanceOf(WorkspaceUIBus);
    });

    it("creates an instance with custom maxBuffer", () => {
      const custom = new WorkspaceUIBus(10);
      expect(custom).toBeInstanceOf(WorkspaceUIBus);
    });
  });

  describe("emit", () => {
    it("emits an event with auto-assigned id and timestamp", () => {
      const listener = vi.fn();
      bus.subscribe("ws1", listener);
      bus.emit("ws1", {
        event: "ui.agent.created",
        data: { workspaceId: "ws1", agent: { id: "a1", role: "dev", parentId: null } },
      });

      expect(listener).toHaveBeenCalledTimes(1);
      const evt = listener.mock.calls[0][0];
      expect(evt.id).toBe(1);
      expect(evt.at).toBeTypeOf("number");
      expect(evt.event).toBe("ui.agent.created");
    });

    it("increments id per channel", () => {
      const listener = vi.fn();
      bus.subscribe("ws1", listener);
      bus.emit("ws1", { event: "ui.agent.created", data: { workspaceId: "ws1", agent: { id: "a1", role: "dev", parentId: null } } });
      bus.emit("ws1", { event: "ui.agent.deleted", data: { workspaceId: "ws1", agentId: "a1", role: "dev" } });

      expect(listener.mock.calls[0][0].id).toBe(1);
      expect(listener.mock.calls[1][0].id).toBe(2);
    });

    it("emits to the correct channel only", () => {
      const l1 = vi.fn();
      const l2 = vi.fn();
      bus.subscribe("ws1", l1);
      bus.subscribe("ws2", l2);

      bus.emit("ws1", { event: "ui.agent.created", data: { workspaceId: "ws1", agent: { id: "a1", role: "dev", parentId: null } } });

      expect(l1).toHaveBeenCalledTimes(1);
      expect(l2).not.toHaveBeenCalled();
    });

    it("notifies multiple listeners on the same channel", () => {
      const l1 = vi.fn();
      const l2 = vi.fn();
      bus.subscribe("ws1", l1);
      bus.subscribe("ws1", l2);

      bus.emit("ws1", { event: "ui.db.write", data: { workspaceId: "ws1", table: "agents", action: "insert" } });

      expect(l1).toHaveBeenCalledTimes(1);
      expect(l2).toHaveBeenCalledTimes(1);
    });
  });

  describe("subscribe / unsubscribe", () => {
    it("returns an unsubscribe function", () => {
      const unsub = bus.subscribe("ws1", vi.fn());
      expect(typeof unsub).toBe("function");
    });

    it("stops receiving events after unsubscribe", () => {
      const listener = vi.fn();
      const unsub = bus.subscribe("ws1", listener);

      bus.emit("ws1", { event: "ui.agent.created", data: { workspaceId: "ws1", agent: { id: "a1", role: "dev", parentId: null } } });
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      bus.emit("ws1", { event: "ui.agent.deleted", data: { workspaceId: "ws1", agentId: "a1", role: "dev" } });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("does not affect other listeners when one unsubscribes", () => {
      const l1 = vi.fn();
      const l2 = vi.fn();
      const unsub1 = bus.subscribe("ws1", l1);
      bus.subscribe("ws1", l2);

      unsub1();
      bus.emit("ws1", { event: "ui.agent.created", data: { workspaceId: "ws1", agent: { id: "a1", role: "dev", parentId: null } } });

      expect(l1).not.toHaveBeenCalled();
      expect(l2).toHaveBeenCalledTimes(1);
    });
  });

  describe("buffer management", () => {
    it("trims buffer when exceeding maxBuffer", () => {
      const smallBus = new WorkspaceUIBus(3);
      for (let i = 0; i < 5; i++) {
        smallBus.emit("ws1", {
          event: "ui.agent.created",
          data: { workspaceId: "ws1", agent: { id: `a${i}`, role: "dev", parentId: null } },
        });
      }

      const events = smallBus.getSince("ws1", 0);
      expect(events.length).toBe(3);
      expect(events[0].id).toBe(3); // first two were trimmed
    });

    it("keeps all events when under maxBuffer", () => {
      for (let i = 0; i < 3; i++) {
        bus.emit("ws1", {
          event: "ui.agent.created",
          data: { workspaceId: "ws1", agent: { id: `a${i}`, role: "dev", parentId: null } },
        });
      }
      const events = bus.getSince("ws1", 0);
      expect(events.length).toBe(3);
    });
  });

  describe("getSince", () => {
    it("returns events after the given id", () => {
      bus.emit("ws1", { event: "ui.agent.created", data: { workspaceId: "ws1", agent: { id: "a1", role: "dev", parentId: null } } });
      bus.emit("ws1", { event: "ui.agent.created", data: { workspaceId: "ws1", agent: { id: "a2", role: "dev", parentId: null } } });
      bus.emit("ws1", { event: "ui.agent.created", data: { workspaceId: "ws1", agent: { id: "a3", role: "dev", parentId: null } } });

      const events = bus.getSince("ws1", 1);
      expect(events.length).toBe(2);
      expect(events[0].id).toBe(2);
      expect(events[1].id).toBe(3);
    });

    it("returns empty array for unknown channel", () => {
      const events = bus.getSince("unknown", 0);
      expect(events).toEqual([]);
    });

    it("returns empty array when sinceId is beyond all events", () => {
      bus.emit("ws1", { event: "ui.agent.created", data: { workspaceId: "ws1", agent: { id: "a1", role: "dev", parentId: null } } });
      const events = bus.getSince("ws1", 100);
      expect(events).toEqual([]);
    });
  });

  describe("getAgentEventsSince", () => {
    it("returns events matching agentId across all channels", () => {
      bus.emit("ws1", {
        event: "ui.agent.llm.start",
        data: { workspaceId: "ws1", agentId: "agent-x", groupId: "g1", round: 1 },
      });
      bus.emit("ws1", {
        event: "ui.agent.llm.done",
        data: { workspaceId: "ws1", agentId: "agent-y", groupId: "g1", round: 1 },
      });
      bus.emit("ws2", {
        event: "ui.agent.llm.start",
        data: { workspaceId: "ws2", agentId: "agent-x", groupId: "g2", round: 1 },
      });

      const events = bus.getAgentEventsSince("agent-x", 0);
      expect(events.length).toBe(2);
    });

    it("returns empty array when no events match agentId", () => {
      bus.emit("ws1", {
        event: "ui.agent.llm.start",
        data: { workspaceId: "ws1", agentId: "agent-x", groupId: "g1", round: 1 },
      });
      const events = bus.getAgentEventsSince("agent-z", 0);
      expect(events).toEqual([]);
    });

    it("respects sinceId filter", () => {
      bus.emit("ws1", {
        event: "ui.agent.llm.start",
        data: { workspaceId: "ws1", agentId: "agent-x", groupId: "g1", round: 1 },
      });
      bus.emit("ws1", {
        event: "ui.agent.llm.done",
        data: { workspaceId: "ws1", agentId: "agent-x", groupId: "g1", round: 1 },
      });

      const events = bus.getAgentEventsSince("agent-x", 1);
      expect(events.length).toBe(1);
      expect(events[0].event).toBe("ui.agent.llm.done");
    });
  });

  describe("multiple workspace isolation", () => {
    it("maintains separate buffers per workspace", () => {
      bus.emit("ws1", { event: "ui.agent.created", data: { workspaceId: "ws1", agent: { id: "a1", role: "dev", parentId: null } } });
      bus.emit("ws2", { event: "ui.agent.created", data: { workspaceId: "ws2", agent: { id: "a2", role: "pm", parentId: null } } });
      bus.emit("ws2", { event: "ui.agent.created", data: { workspaceId: "ws2", agent: { id: "a3", role: "qa", parentId: null } } });

      expect(bus.getSince("ws1", 0).length).toBe(1);
      expect(bus.getSince("ws2", 0).length).toBe(2);
    });

    it("maintains separate ids per workspace channel", () => {
      bus.emit("ws1", { event: "ui.agent.created", data: { workspaceId: "ws1", agent: { id: "a1", role: "dev", parentId: null } } });
      bus.emit("ws2", { event: "ui.agent.created", data: { workspaceId: "ws2", agent: { id: "a2", role: "pm", parentId: null } } });

      const ws1Events = bus.getSince("ws1", 0);
      const ws2Events = bus.getSince("ws2", 0);
      expect(ws1Events[0].id).toBe(1);
      expect(ws2Events[0].id).toBe(1);
    });
  });

  describe("various event types", () => {
    it("handles ui.message.created events", () => {
      const listener = vi.fn();
      bus.subscribe("ws1", listener);
      bus.emit("ws1", {
        event: "ui.message.created",
        data: {
          workspaceId: "ws1",
          groupId: "g1",
          message: { id: "m1", senderId: "a1", sendTime: "2024-01-01T00:00:00Z" },
        },
      });
      expect(listener.mock.calls[0][0].event).toBe("ui.message.created");
    });

    it("handles pipeline events", () => {
      const listener = vi.fn();
      bus.subscribe("ws1", listener);
      bus.emit("ws1", {
        event: "pipeline.start",
        data: { pipelineId: "p1", workflowId: "w1", groupId: "g1", stageCount: 2 },
      });
      expect(listener.mock.calls[0][0].event).toBe("pipeline.start");
    });

    it("handles ui.agent.interrupt_all events", () => {
      const listener = vi.fn();
      bus.subscribe("ws1", listener);
      bus.emit("ws1", {
        event: "ui.agent.interrupt_all",
        data: { workspaceId: "ws1", interrupted: 2, agentIds: ["a1", "a2"] },
      });
      expect(listener.mock.calls[0][0].data.interrupted).toBe(2);
    });
  });
});

describe("getWorkspaceUIBus", () => {
  it("returns a WorkspaceUIBus instance", () => {
    const bus = getWorkspaceUIBus();
    expect(bus).toBeInstanceOf(WorkspaceUIBus);
  });

  it("returns the same singleton instance on subsequent calls", () => {
    const bus1 = getWorkspaceUIBus();
    const bus2 = getWorkspaceUIBus();
    expect(bus1).toBe(bus2);
  });
});
