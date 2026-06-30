import { describe, it, expect, beforeEach, vi } from "vitest";
import { isLlmCircuitOpen, recordLlmFailure, recordLlmSuccess } from "../../src/runtime/agent-scheduler";
import { llmFailureCount, LLM_CIRCUIT_BREAKER_THRESHOLD, LLM_CIRCUIT_BREAKER_COOLDOWN } from "../../src/runtime/agent-types";

describe("circuit breaker", () => {
  beforeEach(() => {
    // Reset the shared failure counter between tests
    llmFailureCount.clear();
    vi.restoreAllMocks();
  });

  describe("isLlmCircuitOpen()", () => {
    it("returns false initially (no failures recorded)", () => {
      expect(isLlmCircuitOpen()).toBe(false);
    });

    it("returns false when failures below threshold", () => {
      recordLlmFailure();
      recordLlmFailure();
      expect(LLM_CIRCUIT_BREAKER_THRESHOLD).toBeGreaterThan(2); // sanity check
      expect(isLlmCircuitOpen()).toBe(false);
    });

    it("after threshold failures → returns true", () => {
      for (let i = 0; i < LLM_CIRCUIT_BREAKER_THRESHOLD; i++) {
        recordLlmFailure();
      }
      expect(isLlmCircuitOpen()).toBe(true);
    });
  });

  describe("recordLlmFailure()", () => {
    it("increments counter", () => {
      recordLlmFailure();
      const state = llmFailureCount.get("global");
      expect(state).toBeDefined();
      expect(state!.count).toBe(1);
    });

    it("increments counter multiple times", () => {
      recordLlmFailure();
      recordLlmFailure();
      recordLlmFailure();
      const state = llmFailureCount.get("global");
      expect(state!.count).toBe(3);
    });

    it("updates lastFailure timestamp", () => {
      const before = Date.now();
      recordLlmFailure();
      const state = llmFailureCount.get("global");
      expect(state!.lastFailure).toBeGreaterThanOrEqual(before);
      expect(state!.lastFailure).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("recordLlmSuccess()", () => {
    it("resets the counter", () => {
      // Build up failures
      for (let i = 0; i < LLM_CIRCUIT_BREAKER_THRESHOLD; i++) {
        recordLlmFailure();
      }
      expect(isLlmCircuitOpen()).toBe(true);

      // Success resets everything
      recordLlmSuccess();
      expect(isLlmCircuitOpen()).toBe(false);
      expect(llmFailureCount.get("global")).toBeUndefined();
    });

    it("is safe to call when no failures exist", () => {
      expect(() => recordLlmSuccess()).not.toThrow();
      expect(isLlmCircuitOpen()).toBe(false);
    });
  });

  describe("cooldown expiry", () => {
    it("after cooldown expires → circuit resets", () => {
      // Trip the circuit breaker
      for (let i = 0; i < LLM_CIRCUIT_BREAKER_THRESHOLD; i++) {
        recordLlmFailure();
      }
      expect(isLlmCircuitOpen()).toBe(true);

      // Fast-forward time past the cooldown
      const fakeNow = Date.now() + LLM_CIRCUIT_BREAKER_COOLDOWN + 1000;
      vi.spyOn(Date, "now").mockReturnValue(fakeNow);

      // Circuit should reset because cooldown has expired
      expect(isLlmCircuitOpen()).toBe(false);
    });

    it("within cooldown period → circuit stays open", () => {
      // Trip the circuit breaker
      for (let i = 0; i < LLM_CIRCUIT_BREAKER_THRESHOLD; i++) {
        recordLlmFailure();
      }
      expect(isLlmCircuitOpen()).toBe(true);

      // Fast-forward only half the cooldown
      const fakeNow = Date.now() + Math.floor(LLM_CIRCUIT_BREAKER_COOLDOWN / 2);
      vi.spyOn(Date, "now").mockReturnValue(fakeNow);

      expect(isLlmCircuitOpen()).toBe(true);
    });
  });
});
