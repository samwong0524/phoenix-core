import { describe, it, expect } from "vitest";
import { createDeferred, safeJsonParse } from "../../src/runtime/utils";

describe("createDeferred", () => {
  it("returns an object with promise, resolve, and reject", () => {
    const d = createDeferred<string>();
    expect(d).toHaveProperty("promise");
    expect(d).toHaveProperty("resolve");
    expect(d).toHaveProperty("reject");
    expect(d.promise).toBeInstanceOf(Promise);
    expect(typeof d.resolve).toBe("function");
    expect(typeof d.reject).toBe("function");
  });

  it("resolves the promise when resolve is called", async () => {
    const d = createDeferred<number>();
    d.resolve(42);
    const value = await d.promise;
    expect(value).toBe(42);
  });

  it("rejects the promise when reject is called", async () => {
    const d = createDeferred<string>();
    d.reject(new Error("fail"));
    await expect(d.promise).rejects.toThrow("fail");
  });

  it("supports chaining with .then()", async () => {
    const d = createDeferred<number>();
    const chained = d.promise.then((v) => v * 2);
    d.resolve(5);
    expect(await chained).toBe(10);
  });

  it("supports .catch() on rejection", async () => {
    const d = createDeferred<number>();
    const caught = d.promise.catch((err) => err.message);
    d.reject(new Error("oops"));
    expect(await caught).toBe("oops");
  });

  it("resolves with undefined for void type", async () => {
    const d = createDeferred<void>();
    d.resolve(undefined);
    await expect(d.promise).resolves.toBeUndefined();
  });

  it("resolves with complex objects", async () => {
    const d = createDeferred<{ a: number; b: string }>();
    const obj = { a: 1, b: "test" };
    d.resolve(obj);
    expect(await d.promise).toEqual(obj);
  });

  it("rejects with non-Error values", async () => {
    const d = createDeferred<string>();
    d.reject("string error");
    await expect(d.promise).rejects.toBe("string error");
  });
});

describe("safeJsonParse", () => {
  it("parses valid JSON object", () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
  });

  it("parses valid JSON array", () => {
    expect(safeJsonParse("[1,2,3]", [])).toEqual([1, 2, 3]);
  });

  it("parses valid JSON string", () => {
    expect(safeJsonParse('"hello"', "")).toBe("hello");
  });

  it("parses valid JSON number", () => {
    expect(safeJsonParse("42", 0)).toBe(42);
  });

  it("parses valid JSON boolean", () => {
    expect(safeJsonParse("true", false)).toBe(true);
  });

  it("parses null JSON", () => {
    expect(safeJsonParse("null", "default")).toBeNull();
  });

  it("returns fallback for invalid JSON", () => {
    expect(safeJsonParse("not json", "fallback")).toBe("fallback");
  });

  it("returns fallback for empty string", () => {
    expect(safeJsonParse("", { default: true })).toEqual({ default: true });
  });

  it("returns fallback for undefined-like string", () => {
    expect(safeJsonParse("undefined", 0)).toBe(0);
  });

  it("returns fallback for truncated JSON", () => {
    expect(safeJsonParse('{"a":', [])).toEqual([]);
  });

  it("preserves type safety with generic parameter", () => {
    const result = safeJsonParse<number[]>("[1,2,3]", []);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([1, 2, 3]);
  });

  it("returns fallback for JSON with trailing comma", () => {
    expect(safeJsonParse("[1,2,]", [])).toEqual([]);
  });
});
