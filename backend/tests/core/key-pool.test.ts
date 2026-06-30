import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { KeyPool, parseKeyPool } from "../../src/runtime/agent-keys";

describe("KeyPool", () => {
  describe("constructor", () => {
    it("empty array → hasKeys() returns false", () => {
      const pool = new KeyPool([]);
      expect(pool.hasKeys()).toBe(false);
    });

    it("constructor with keys → hasKeys() returns true", () => {
      const pool = new KeyPool(["key1", "key2"]);
      expect(pool.hasKeys()).toBe(true);
      expect(pool.size()).toBe(2);
    });

    it("filters out empty strings", () => {
      const pool = new KeyPool(["key1", "", "key2", ""]);
      expect(pool.size()).toBe(2);
    });
  });

  describe("getNext() round-robin rotation", () => {
    it("rotates through keys in order", () => {
      const pool = new KeyPool(["key1", "key2", "key3"]);
      expect(pool.getNext()).toBe("key1");
      expect(pool.getNext()).toBe("key2");
      expect(pool.getNext()).toBe("key3");
      expect(pool.getNext()).toBe("key1"); // wraps around
    });

    it("returns null for empty pool", () => {
      const pool = new KeyPool([]);
      expect(pool.getNext()).toBeNull();
    });

    it("single key returns same key repeatedly", () => {
      const pool = new KeyPool(["only-key"]);
      expect(pool.getNext()).toBe("only-key");
      expect(pool.getNext()).toBe("only-key");
    });
  });

  describe("mark429() cooldown", () => {
    it("puts key in cooldown → getNext() skips it", () => {
      const pool = new KeyPool(["key1", "key2"]);
      pool.mark429("key1", 60000); // 60 second cooldown
      expect(pool.getNext()).toBe("key2");
      expect(pool.getNext()).toBe("key2"); // key1 still in cooldown
    });

    it("all keys in cooldown → getNext() returns null", () => {
      const pool = new KeyPool(["key1", "key2"]);
      pool.mark429("key1", 60000);
      pool.mark429("key2", 60000);
      expect(pool.getNext()).toBeNull();
    });

    it("mark429 on non-existent key does nothing", () => {
      const pool = new KeyPool(["key1"]);
      pool.mark429("nonexistent", 60000);
      expect(pool.getNext()).toBe("key1");
    });
  });

  describe("hasAvailable()", () => {
    it("returns true when keys are available", () => {
      const pool = new KeyPool(["key1", "key2"]);
      expect(pool.hasAvailable()).toBe(true);
    });

    it("returns false when all keys in cooldown", () => {
      const pool = new KeyPool(["key1", "key2"]);
      pool.mark429("key1", 60000);
      pool.mark429("key2", 60000);
      expect(pool.hasAvailable()).toBe(false);
    });

    it("returns false for empty pool", () => {
      const pool = new KeyPool([]);
      expect(pool.hasAvailable()).toBe(false);
    });

    it("returns true when some keys available", () => {
      const pool = new KeyPool(["key1", "key2"]);
      pool.mark429("key1", 60000);
      expect(pool.hasAvailable()).toBe(true);
    });
  });
});

describe("parseKeyPool", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("parses comma-separated keys from env var", () => {
    process.env.TEST_API_KEYS = "key1,key2,key3";
    const pool = parseKeyPool("TEST_API_KEYS", "fallback");
    expect(pool.size()).toBe(3);
    expect(pool.hasKeys()).toBe(true);
  });

  it("trims whitespace from keys", () => {
    process.env.TEST_API_KEYS = "key1, key2 , key3";
    const pool = parseKeyPool("TEST_API_KEYS", "fallback");
    expect(pool.size()).toBe(3);
  });

  it("filters out empty strings", () => {
    process.env.TEST_API_KEYS = "key1,,key2,";
    const pool = parseKeyPool("TEST_API_KEYS", "fallback");
    expect(pool.size()).toBe(2);
  });

  it("fallback to single key when env var not set", () => {
    delete process.env.TEST_API_KEYS;
    const pool = parseKeyPool("TEST_API_KEYS", "fallback-key");
    expect(pool.size()).toBe(1);
    expect(pool.getNext()).toBe("fallback-key");
  });

  it("returns empty pool when no env var and no fallback", () => {
    delete process.env.TEST_API_KEYS;
    const pool = parseKeyPool("TEST_API_KEYS", "");
    expect(pool.hasKeys()).toBe(false);
    expect(pool.size()).toBe(0);
  });
});
