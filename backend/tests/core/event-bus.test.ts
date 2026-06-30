import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentEventBus } from "../../src/runtime/event-bus";

// Mock the upstash-realtime module so emit doesn't try to import it
vi.mock("../../src/runtime/upstash-realtime", () => ({
  isUpstashRealtimeConfigured: () => false,
  getRedisClient: vi.fn(),
  getUpstashRealtime: vi.fn(),
}));

describe("AgentEventBus", () => {
  let bus: AgentEventBus;

  beforeEach(() => {
    bus = new AgentEventBus();
  });

  describe("constructor", () => {
    it("creates an instance with default maxBuffer", () => {
      expect(bus).toBeInstanceOf(AgentEventBus);
    });

    it("creates an instance with custom maxBuffer", () => {
      const custom = new AgentEventBus(5);
      expect(custom).toBeInstanceOf(AgentEventBus);
    });
  });

  describe("emit", () => {
    it("emits an event and assigns id and timestamp", () => {
      const listener = vi.fn();
      bus.subscribe("agent1", listener);
      bus.emit("agent1", { event: "agent.wakeup", data: { agentId: "agent1" } });

      expect(listener).toHaveBeenCalledTimes(1);
      const evt = listener.mock.calls[0][0];
      expect(evt.id).toBe(1);
      expect(evt.at).toBeTypeOf("number");
      expect(evt.event).toBe("agent.wakeup");
      expect(evt.data).toEqual({ agentId: "agent1" });
    });

    it("increments id for each event on the same channel", () => {
      const listener = vi.fn();
      bus.subscribe("agent1", listener);
      bus.emit("agent1", { event: "agent.wakeup", data: { agentId: "agent1" } });
      bus.emit("agent1", { event: "agent.done", data: {} });

      expect(listener.mock.calls[0][0].id).toBe(1);
      expect(listener.mock.calls[1][0].id).toBe(2);
    });

    it("emits to correct agent channel only", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      bus.subscribe("agent1", listener1);
      bus.subscribe("agent2", listener2);

      bus.emit("agent1", { event: "agent.wakeup", data: { agentId: "agent1" } });

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).not.toHaveBeenCalled();
    });

    it("notifies multiple listeners on the same channel", () => {
      const l1 = vi.fn();
      const l2 = vi.fn();
      bus.subscribe("agent1", l1);
      bus.subscribe("agent1", l2);

      bus.emit("agent1", { event: "agent.done", data: {} });

      expect(l1).toHaveBeenCalledTimes(1);
      expect(l2).toHaveBeenCalledTimes(1);
    });
  });

  describe("subscribe / unsubscribe", () => {
    it("returns an unsubscribe function", () => {
      const listener = vi.fn();
      const unsub = bus.subscribe("agent1", listener);
      expect(typeof unsub).toBe("function");
    });

    it("stops receiving events after unsubscribe", () => {
      const listener = vi.fn();
      const unsub = bus.subscribe("agent1", listener);

      bus.emit("agent1", { event: "agent.wakeup", data: { agentId: "agent1" } });
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      bus.emit("agent1", { event: "agent.done", data: {} });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("does not affect other listeners when one unsubscribes", () => {
      const l1 = vi.fn();
      const l2 = vi.fn();
      const unsub1 = bus.subscribe("agent1", l1);
      bus.subscribe("agent1", l2);

      unsub1();
      bus.emit("agent1", { event: "agent.wakeup", data: { agentId: "agent1" } });

      expect(l1).not.toHaveBeenCalled();
      expect(l2).toHaveBeenCalledTimes(1);
    });
  });

  describe("event buffer (max 2000)", () => {
    it("trims buffer when exceeding maxBuffer", () => {
      const smallBus = new AgentEventBus(3);
      smallBus.emit("a1", { event: "agent.wakeup", data: { agentId: "a1" } });
      smallBus.emit("a1", { event: "agent.wakeup", data: { agentId: "a1" } });
      smallBus.emit("a1", { event: "agent.wakeup", data: { agentId: "a1" } });
      smallBus.emit("a1", { event: "agent.wakeup", data: { agentId: "a1" } });

      // Buffer should only have the last 3 events
      const events = smallBus.getSince("a1", 0);
      expect(events.length).toBe(3);
      // The first event in buffer should be id=2 (id=1 was trimmed)
      expect(events[0].id).toBe(2);
    });

    it("keeps all events when under maxBuffer", () => {
      for (let i = 0; i < 5; i++) {
        bus.emit("a1", { event: "agent.wakeup", data: { agentId: "a1" } });
      }
      const events = bus.getSince("a1", 0);
      expect(events.length).toBe(5);
    });
  });

  describe("getSince", () => {
    it("returns events after the given id", () => {
      bus.emit("a1", { event: "agent.wakeup", data: { agentId: "a1" } });
      bus.emit("a1", { event: "agent.done", data: {} });
      bus.emit("a1", { event: "agent.wakeup", data: { agentId: "a1" } });

      const events = bus.getSince("a1", 1);
      expect(events.length).toBe(2);
      expect(events[0].id).toBe(2);
      expect(events[1].id).toBe(3);
    });

    it("returns all events when afterId is 0", () => {
      bus.emit("a1", { event: "agent.wakeup", data: { agentId: "a1" } });
      bus.emit("a1", { event: "agent.done", data: {} });

      const events = bus.getSince("a1", 0);
      expect(events.length).toBe(2);
    });

    it("returns empty array for unknown agent", () => {
      const events = bus.getSince("unknown", 0);
      expect(events).toEqual([]);
    });

    it("returns empty array when afterId is beyond all events", () => {
      bus.emit("a1", { event: "agent.wakeup", data: { agentId: "a1" } });
      const events = bus.getSince("a1", 100);
      expect(events).toEqual([]);
    });
  });

  describe("getLatestId", () => {
    it("returns 0 for new channel", () => {
      expect(bus.getLatestId("new-agent")).toBe(0);
    });

    it("returns the latest event id", () => {
      bus.emit("a1", { event: "agent.wakeup", data: { agentId: "a1" } });
      bus.emit("a1", { event: "agent.done", data: {} });
      expect(bus.getLatestId("a1")).toBe(2);
    });
  });

  describe("isolated channels for multiple agents", () => {
    it("maintains separate buffers per agent", () => {
      bus.emit("a1", { event: "agent.wakeup", data: { agentId: "a1" } });
      bus.emit("a2", { event: "agent.wakeup", data: { agentId: "a2" } });
      bus.emit("a2", { event: "agent.done", data: {} });

      expect(bus.getSince("a1", 0).length).toBe(1);
      expect(bus.getSince("a2", 0).length).toBe(2);
    });

    it("maintains separate ids per agent", () => {
      bus.emit("a1", { event: "agent.wakeup", data: { agentId: "a1" } });
      bus.emit("a2", { event: "agent.wakeup", data: { agentId: "a2" } });

      // Both start at id=1 since they're separate channels
      const a1Events = bus.getSince("a1", 0);
      const a2Events = bus.getSince("a2", 0);
      expect(a1Events[0].id).toBe(1);
      expect(a2Events[0].id).toBe(1);
    });
  });

  describe("mergeRemoteEvent", () => {
    it("adds remote event to buffer and notifies listeners", () => {
      const listener = vi.fn();
      bus.subscribe("agent1", listener);

      bus.mergeRemoteEvent("agent1", { event: "agent.stream", data: { kind: "content", delta: "hello" } });

      expect(listener).toHaveBeenCalledTimes(1);
      const evt = listener.mock.calls[0][0];
      expect(evt.event).toBe("agent.stream");
      expect(evt.id).toBe(1);
    });

    it("respects maxBuffer for remote events", () => {
      const smallBus = new AgentEventBus(2);
      smallBus.mergeRemoteEvent("a1", { event: "agent.wakeup", data: { agentId: "a1" } });
      smallBus.mergeRemoteEvent("a1", { event: "agent.wakeup", data: { agentId: "a1" } });
      smallBus.mergeRemoteEvent("a1", { event: "agent.wakeup", data: { agentId: "a1" } });

      const events = smallBus.getSince("a1", 0);
      expect(events.length).toBe(2);
    });
  });

  describe("initCrossInstance", () => {
    it("does not throw when Redis is not configured", async () => {
      await expect(bus.initCrossInstance()).resolves.toBeUndefined();
    });

    it("is idempotent — calling twice does not error", async () => {
      await bus.initCrossInstance();
      await bus.initCrossInstance();
    });
  });

  describe("various event types", () => {
    it("handles agent.error events", () => {
      const listener = vi.fn();
      bus.subscribe("a1", listener);
      bus.emit("a1", { event: "agent.error", data: { message: "something broke" } });
      expect(listener.mock.calls[0][0].data.message).toBe("something broke");
    });

    it("handles pipeline.start events", () => {
      const listener = vi.fn();
      bus.subscribe("a1", listener);
      bus.emit("a1", {
        event: "pipeline.start",
        data: { pipelineId: "p1", workflowId: "w1", groupId: "g1", stageCount: 3 },
      });
      expect(listener.mock.calls[0][0].event).toBe("pipeline.start");
    });

    it("handles agent.stream events", () => {
      const listener = vi.fn();
      bus.subscribe("a1", listener);
      bus.emit("a1", {
        event: "agent.stream",
        data: { kind: "reasoning", delta: "thinking..." },
      });
      expect(listener.mock.calls[0][0].data.kind).toBe("reasoning");
    });
  });
});
