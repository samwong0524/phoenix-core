import { describe, it, expect } from "vitest";
import {
  detectVerificationTool,
  isCodeModificationBash,
  isFileModificationTool,
  parseVerificationResult,
  hasPlanIndicators,
  hasHighRiskIndicators,
  hasCommunicationTool,
  isCompletionMessage,
  shouldBlockCompletion,
  shouldNudgeVerification,
} from "../../src/runtime/agent-helpers";

// ─── detectVerificationTool ─────────────────────────────────────────────────

describe("detectVerificationTool", () => {
  it("detects tsc", () => {
    expect(detectVerificationTool("tsc --noEmit")).toBe("tsc");
  });

  it("detects npx tsc", () => {
    expect(detectVerificationTool("npx tsc --noEmit")).toMatch(/tsc/);
  });

  it("detects vitest", () => {
    expect(detectVerificationTool("npx vitest run")).toMatch(/vitest/);
  });

  it("detects jest", () => {
    expect(detectVerificationTool("jest --coverage")).toBe("jest");
  });

  it("detects npm test", () => {
    expect(detectVerificationTool("npm test")).toBe("npm test");
  });

  it("detects npm run test", () => {
    expect(detectVerificationTool("npm run test")).toBe("npm run test");
  });

  it("detects next build", () => {
    expect(detectVerificationTool("next build")).toBe("next build");
  });

  it("detects npm run build", () => {
    expect(detectVerificationTool("npm run build")).toBe("npm run build");
  });

  it("detects npx playwright", () => {
    expect(detectVerificationTool("npx playwright test")).toMatch(/playwright/);
  });

  it("detects playwright test", () => {
    expect(detectVerificationTool("playwright test --project=chromium")).toMatch(/playwright/);
  });

  it("returns null for non-verification commands", () => {
    expect(detectVerificationTool("echo hello")).toBeNull();
    expect(detectVerificationTool("ls -la")).toBeNull();
    expect(detectVerificationTool("git status")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(detectVerificationTool("")).toBeNull();
  });
});

// ─── isCodeModificationBash ─────────────────────────────────────────────────

describe("isCodeModificationBash", () => {
  it("detects sed -i", () => {
    expect(isCodeModificationBash("sed -i 's/old/new/' file.txt")).toBe(true);
  });

  it("detects tee", () => {
    expect(isCodeModificationBash("echo 'content' | tee file.txt")).toBe(true);
  });

  it("detects mkdir", () => {
    expect(isCodeModificationBash("mkdir -p src/components")).toBe(true);
  });

  it("detects echo redirect", () => {
    expect(isCodeModificationBash("echo 'hello' > file.txt")).toBe(true);
  });

  it("detects append redirect", () => {
    expect(isCodeModificationBash("echo 'line' >> file.txt")).toBe(true);
  });

  it("detects next build as code modification", () => {
    expect(isCodeModificationBash("next build")).toBe(true);
  });

  it("returns false for read-only commands", () => {
    expect(isCodeModificationBash("cat file.txt")).toBe(false);
    expect(isCodeModificationBash("ls -la")).toBe(false);
    expect(isCodeModificationBash("grep -r pattern")).toBe(false);
  });
});

// ─── isFileModificationTool ─────────────────────────────────────────────────

describe("isFileModificationTool", () => {
  it("detects file modification tools", () => {
    expect(isFileModificationTool("write_file")).toBe(true);
    expect(isFileModificationTool("edit_file")).toBe(true);
    expect(isFileModificationTool("patch_file")).toBe(true);
    expect(isFileModificationTool("create_backup")).toBe(true);
  });

  it("rejects non-modification tools", () => {
    expect(isFileModificationTool("read_file")).toBe(false);
    expect(isFileModificationTool("bash")).toBe(false);
    expect(isFileModificationTool("search")).toBe(false);
  });
});

// ─── parseVerificationResult ────────────────────────────────────────────────

describe("parseVerificationResult", () => {
  it("detects tsc type errors with file location", () => {
    const result = parseVerificationResult("tsc --noEmit", "src/app.ts(10,5): error TS2322: Type 'string' is not assignable");
    expect(result).toMatch(/tsc: 1 type error/);
    expect(result).toContain("src/app.ts:10");
    expect(result).toContain("TS2322");
  });

  it("extracts multiple tsc error locations", () => {
    const input = [
      "src/a.ts(12,3): error TS2345: Argument mismatch",
      "src/b.ts(44,1): error TS2322: Type error",
      "src/c.ts(7,8): error TS2304: Cannot find name",
    ].join("\n");
    const result = parseVerificationResult("tsc --noEmit", input);
    expect(result).toMatch(/tsc: 3 type error/);
    expect(result).toContain("src/a.ts:12");
    expect(result).toContain("src/b.ts:44");
    expect(result).toContain("src/c.ts:7");
  });

  it("caps tsc location extraction at 5", () => {
    const lines = Array.from({ length: 8 }, (_, i) =>
      `src/file${i}.ts(${i + 1},1): error TS2322: err${i}`
    ).join("\n");
    const result = parseVerificationResult("tsc", lines);
    expect(result).toMatch(/tsc: 8 type error/);
    expect(result).toContain("(+3 more)");
  });

  it("falls back to error code summary without locations", () => {
    const result = parseVerificationResult("npx tsc", "error TS2322 a\nerror TS2345 b\nerror TS2304 c\nerror TS2307 d");
    expect(result).toMatch(/tsc: 4 type error/);
    expect(result).toContain("...");
  });

  it("detects tsc exit code failure", () => {
    const result = parseVerificationResult("tsc", "exit code: 2");
    expect(result).toMatch(/tsc: exited with code 2/);
  });

  it("returns null for clean tsc", () => {
    expect(parseVerificationResult("tsc --noEmit", "No errors found")).toBeNull();
  });

  it("detects vitest failures with test locations", () => {
    const input = "Tests: 2 failed, 10 passed\n❯ tests/core/foo.test.ts:15:20\n❯ tests/core/bar.test.ts:42:5";
    const result = parseVerificationResult("npx vitest run", input);
    expect(result).toMatch(/vitest: 2 test\(s\) failed/);
    expect(result).toContain("tests/core/foo.test.ts:15");
    expect(result).toContain("tests/core/bar.test.ts:42");
  });

  it("detects vitest failures with FAIL lines", () => {
    const input = "Tests: 1 failed\nFAIL  tests/auth.test.ts > should login correctly";
    const result = parseVerificationResult("vitest run", input);
    expect(result).toMatch(/vitest: 1 test\(s\) failed/);
    expect(result).toContain("tests/auth.test.ts");
    expect(result).toContain("should login correctly");
  });

  it("returns null for clean vitest", () => {
    expect(parseVerificationResult("vitest run", "Tests: 0 failed, 25 passed")).toBeNull();
  });

  it("detects playwright failures with locations", () => {
    const input = "3 failed, 12 passed\n1) tests/e2e/auth.spec.ts:23:5 › login › should redirect\n2) tests/e2e/nav.spec.ts:10:3 › nav › should show menu";
    const result = parseVerificationResult("npx playwright test", input);
    expect(result).toMatch(/playwright: 3 test\(s\) failed/);
    expect(result).toContain("tests/e2e/auth.spec.ts:23");
    expect(result).toContain("should redirect");
  });

  it("returns null for clean playwright", () => {
    expect(parseVerificationResult("playwright test", "15 passed, 0 failed")).toBeNull();
  });

  it("detects next build errors with file and line", () => {
    const input = "./src/pages/api/users.ts\nType error: Cannot find module\n  12 | const x = require('missing')";
    const result = parseVerificationResult("next build", input);
    expect(result).toContain("src/pages/api/users.ts");
    expect(result).toContain(":12");
  });

  it("falls back for build without file info", () => {
    const result = parseVerificationResult("next build", "Failed to compile. Type error: Cannot find module");
    expect(result).toMatch(/build: compilation error/);
  });

  it("returns null for successful build", () => {
    expect(parseVerificationResult("npm run build", "Compiled successfully")).toBeNull();
  });

  it("returns null for non-verification commands", () => {
    expect(parseVerificationResult("echo hello", "hello")).toBeNull();
  });
});

// ─── hasPlanIndicators ──────────────────────────────────────────────────────

describe("hasPlanIndicators", () => {
  const longText = "a".repeat(81);

  it("detects Chinese plan keywords with sufficient length", () => {
    expect(hasPlanIndicators("执行方案" + longText)).toBe(true);
    expect(hasPlanIndicators("执行计划" + longText)).toBe(true);
    expect(hasPlanIndicators("实施计划" + longText)).toBe(true);
  });

  it("detects English plan keywords with sufficient length", () => {
    expect(hasPlanIndicators("implementation plan" + longText)).toBe(true);
    expect(hasPlanIndicators("execution plan" + longText)).toBe(true);
  });

  it("rejects short text even with plan keywords", () => {
    expect(hasPlanIndicators("执行方案")).toBe(false);
  });

  it("rejects long text without plan keywords", () => {
    expect(hasPlanIndicators(longText + longText)).toBe(false);
  });
});

// ─── hasHighRiskIndicators ──────────────────────────────────────────────────

describe("hasHighRiskIndicators", () => {
  it("detects high risk", () => {
    expect(hasHighRiskIndicators("This is a high risk operation")).toBe(true);
  });

  it("detects Chinese risk keywords", () => {
    expect(hasHighRiskIndicators("这个操作很复杂")).toBe(true);
    expect(hasHighRiskIndicators("这是危险操作")).toBe(true);
  });

  it("detects critical keyword", () => {
    expect(hasHighRiskIndicators("critical system change")).toBe(true);
  });

  it("detects 5+ files pattern", () => {
    expect(hasHighRiskIndicators("affects 5+ files")).toBe(true);
  });

  it("detects database migration (with space)", () => {
    expect(hasHighRiskIndicators("database migration required")).toBe(true);
  });

  it("detects db migration", () => {
    expect(hasHighRiskIndicators("db migration needed")).toBe(true);
  });

  it("rejects safe operations", () => {
    expect(hasHighRiskIndicators("simple refactoring")).toBe(false);
    expect(hasHighRiskIndicators("update README")).toBe(false);
  });
});

// ─── hasCommunicationTool ───────────────────────────────────────────────────

describe("hasCommunicationTool", () => {
  it("detects ask_user", () => {
    expect(hasCommunicationTool(["bash", "ask_user", "read_file"])).toBe(true);
  });

  it("detects send_group_message", () => {
    expect(hasCommunicationTool(["send_group_message"])).toBe(true);
  });

  it("detects send_direct_message", () => {
    expect(hasCommunicationTool(["send_direct_message", "bash"])).toBe(true);
  });

  it("rejects when no communication tools", () => {
    expect(hasCommunicationTool(["bash", "read_file", "write_file"])).toBe(false);
  });

  it("handles empty array", () => {
    expect(hasCommunicationTool([])).toBe(false);
  });
});

// ─── isCompletionMessage ────────────────────────────────────────────────────

describe("isCompletionMessage", () => {
  it("detects English completion", () => {
    expect(isCompletionMessage("Task is done")).toBe(true);
    expect(isCompletionMessage("All complete")).toBe(true);
    expect(isCompletionMessage("Finished processing")).toBe(true);
    expect(isCompletionMessage("Successfully completed")).toBe(true);
  });

  it("detects Chinese completion (no \\b for CJK)", () => {
    expect(isCompletionMessage("任务已完成")).toBe(true);
    expect(isCompletionMessage("搞定了")).toBe(true);
    expect(isCompletionMessage("做好了")).toBe(true);
    expect(isCompletionMessage("完毕")).toBe(true);
  });

  it("rejects non-completion messages", () => {
    expect(isCompletionMessage("starting work now")).toBe(false);
    expect(isCompletionMessage("need more info")).toBe(false);
    expect(isCompletionMessage("请问如何处理")).toBe(false);
  });

  it("handles case insensitivity for English", () => {
    expect(isCompletionMessage("DONE")).toBe(true);
    expect(isCompletionMessage("Task COMPLETE")).toBe(true);
  });
});

// ─── shouldBlockCompletion ──────────────────────────────────────────────────

describe("shouldBlockCompletion", () => {
  it("blocks when all conditions met", () => {
    expect(shouldBlockCompletion(true, true, true, true, false)).toBe(true);
  });

  it("does not block for coordinator", () => {
    expect(shouldBlockCompletion(false, true, true, true, false)).toBe(false);
  });

  it("does not block without workflow", () => {
    expect(shouldBlockCompletion(true, false, true, true, false)).toBe(false);
  });

  it("does not block when no code modified", () => {
    expect(shouldBlockCompletion(true, true, true, false, false)).toBe(false);
  });

  it("does not block when verification ran", () => {
    expect(shouldBlockCompletion(true, true, true, true, true)).toBe(false);
  });

  it("does not block non-completion messages", () => {
    expect(shouldBlockCompletion(true, true, false, true, false)).toBe(false);
  });
});

// ─── shouldNudgeVerification ────────────────────────────────────────────────

describe("shouldNudgeVerification", () => {
  it("nudges after 3+ modifications without verification", () => {
    expect(shouldNudgeVerification(3, 0)).toBe(true);
    expect(shouldNudgeVerification(5, 0)).toBe(true);
  });

  it("does not nudge with fewer than 3 modifications", () => {
    expect(shouldNudgeVerification(2, 0)).toBe(false);
    expect(shouldNudgeVerification(0, 0)).toBe(false);
  });

  it("does not nudge when verification already ran", () => {
    expect(shouldNudgeVerification(5, 1)).toBe(false);
    expect(shouldNudgeVerification(3, 2)).toBe(false);
  });
});
