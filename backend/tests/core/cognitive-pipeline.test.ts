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

// ═══════════════════════════════════════════════════════════════
//  Cognitive Pipeline — Pure Decision Functions
// ═══════════════════════════════════════════════════════════════

describe("detectVerificationTool", () => {
  it("detects tsc", () => {
    expect(detectVerificationTool("npx tsc --noEmit")).toBe("npx tsc");
    expect(detectVerificationTool("tsc --noEmit")).toBe("tsc");
  });

  it("detects vitest", () => {
    expect(detectVerificationTool("npx vitest run")).toBe("npx vitest");
    expect(detectVerificationTool("vitest run")).toBe("vitest");
  });

  it("detects jest", () => {
    expect(detectVerificationTool("jest --coverage")).toBe("jest");
  });

  it("detects npm test variants", () => {
    expect(detectVerificationTool("npm test")).toBe("npm test");
    expect(detectVerificationTool("npm run test")).toBe("npm run test");
  });

  it("detects build commands", () => {
    expect(detectVerificationTool("next build")).toBe("next build");
    expect(detectVerificationTool("npm run build")).toBe("npm run build");
  });

  it("returns null for non-verification commands", () => {
    expect(detectVerificationTool("ls -la")).toBeNull();
    expect(detectVerificationTool("git status")).toBeNull();
    expect(detectVerificationTool("echo hello")).toBeNull();
    expect(detectVerificationTool("cat file.txt")).toBeNull();
  });

  it("prefers npx prefix when present", () => {
    expect(detectVerificationTool("npx tsc --noEmit")).toBe("npx tsc");
    expect(detectVerificationTool("npx vitest run")).toBe("npx vitest");
  });
});

describe("isCodeModificationBash", () => {
  it("detects sed -i (in-place edit)", () => {
    expect(isCodeModificationBash("sed -i 's/foo/bar/' file.ts")).toBe(true);
  });

  it("detects tee (file write)", () => {
    expect(isCodeModificationBash("echo content | tee output.txt")).toBe(true);
  });

  it("detects mkdir", () => {
    expect(isCodeModificationBash("mkdir -p src/components")).toBe(true);
  });

  it("detects build commands as code modification", () => {
    expect(isCodeModificationBash("npm run build")).toBe(true);
    expect(isCodeModificationBash("next build")).toBe(true);
  });

  it("detects shell redirection (echo > file)", () => {
    expect(isCodeModificationBash("echo hello > output.txt")).toBe(true);
    expect(isCodeModificationBash("cat template > newfile.ts")).toBe(true);
    expect(isCodeModificationBash("echo line >> append.txt")).toBe(true);
  });

  it("returns false for read-only commands", () => {
    expect(isCodeModificationBash("ls -la")).toBe(false);
    expect(isCodeModificationBash("git status")).toBe(false);
    expect(isCodeModificationBash("cat file.txt")).toBe(false);
    expect(isCodeModificationBash("grep pattern file.ts")).toBe(false);
    expect(isCodeModificationBash("npx tsc --noEmit")).toBe(false);
  });
});

describe("isFileModificationTool", () => {
  it("recognises file-writing tools", () => {
    expect(isFileModificationTool("write_file")).toBe(true);
    expect(isFileModificationTool("edit_file")).toBe(true);
    expect(isFileModificationTool("patch_file")).toBe(true);
    expect(isFileModificationTool("create_backup")).toBe(true);
  });

  it("rejects non-modification tools", () => {
    expect(isFileModificationTool("read_file")).toBe(false);
    expect(isFileModificationTool("bash")).toBe(false);
    expect(isFileModificationTool("search_files")).toBe(false);
  });
});

describe("parseVerificationResult", () => {
  describe("tsc results", () => {
    it("detects type errors", () => {
      const result = parseVerificationResult(
        "npx tsc --noEmit",
        "src/app.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      );
      expect(result.hadErrors).toBe(true);
      expect(result.summary).toContain("tsc: 1 type error(s)");
    });

    it("reports multiple errors with truncation", () => {
      const output = [
        "error TS2322",
        "error TS2345",
        "error TS2769",
        "error TS2554",
        "error TS2304",
      ].join("\n");
      const result = parseVerificationResult("tsc", output);
      expect(result.hadErrors).toBe(true);
      expect(result.summary).toContain("5 type error(s)");
      expect(result.summary).toContain("...");
    });

    it("detects non-zero exit code", () => {
      const result = parseVerificationResult("tsc", "Process exited with exit code: 1");
      expect(result.hadErrors).toBe(true);
      expect(result.summary).toContain("exited with code 1");
    });

    it("returns clean for successful tsc", () => {
      const result = parseVerificationResult("tsc --noEmit", "(no output)");
      expect(result.hadErrors).toBe(false);
      expect(result.summary).toBe("");
    });
  });

  describe("vitest results", () => {
    it("detects failed tests", () => {
      const result = parseVerificationResult("npx vitest run", "Test Files  2 failed (2)\n  Tests  3 failed, 10 passed");
      expect(result.hadErrors).toBe(true);
      // Regex matches first \d+ failed occurrence (from "Test Files" line)
      expect(result.summary).toContain("vitest: 2 test(s) failed");
    });

    it("returns clean for passing tests", () => {
      const result = parseVerificationResult("vitest run", "Test Files  5 passed (5)\n  Tests  100 passed");
      expect(result.hadErrors).toBe(false);
    });

    it("handles npm test as vitest", () => {
      const result = parseVerificationResult("npm test", "2 failed");
      expect(result.hadErrors).toBe(true);
    });
  });

  describe("non-verification commands", () => {
    it("returns clean for unrelated output", () => {
      const result = parseVerificationResult("git status", "On branch main");
      expect(result.hadErrors).toBe(false);
    });
  });
});

describe("hasPlanIndicators", () => {
  it("detects plan keywords in long text", () => {
    const text = "I will implement this by following a step-by-step approach. First I need to understand the requirements and then write the code.";
    expect(hasPlanIndicators(text)).toBe(true);
  });

  it("detects 'strategy' and 'approach'", () => {
    const text = "My strategy for this complex task is to first analyze the codebase, then design a modular approach that handles all edge cases properly.";
    expect(hasPlanIndicators(text)).toBe(true);
  });

  it("detects structured assessment keywords", () => {
    const text = "Task Type: modify, Complexity: moderate, Risk Level: medium. I will update the function to handle the new parameter types and verify with tests.";
    expect(hasPlanIndicators(text)).toBe(true);
  });

  it("rejects short text even with keywords", () => {
    expect(hasPlanIndicators("I will do it now")).toBe(false);
    expect(hasPlanIndicators("plan: fix bug")).toBe(false);
  });

  it("rejects long text without plan keywords", () => {
    const text = "The quick brown fox jumps over the lazy dog. This sentence has nothing to do with planning or executing any kind of task at all really.";
    expect(hasPlanIndicators(text)).toBe(false);
  });
});

describe("hasHighRiskIndicators", () => {
  it("detects high risk keywords", () => {
    expect(hasHighRiskIndicators("Risk: high")).toBe(true);
    expect(hasHighRiskIndicators("high risk operation")).toBe(true);
    expect(hasHighRiskIndicators("high complexity refactor")).toBe(true);
  });

  it("detects dangerous/critical", () => {
    expect(hasHighRiskIndicators("This is a dangerous operation")).toBe(true);
    expect(hasHighRiskIndicators("critical infrastructure change")).toBe(true);
  });

  it("detects scale indicators", () => {
    expect(hasHighRiskIndicators("Modifying 5+ files across modules")).toBe(true);
  });

  it("detects migration keywords", () => {
    expect(hasHighRiskIndicators("database migration script")).toBe(true);
    expect(hasHighRiskIndicators("db migrat")).toBe(true);
  });

  it("rejects low-risk text", () => {
    expect(hasHighRiskIndicators("simple bug fix")).toBe(false);
    expect(hasHighRiskIndicators("update README")).toBe(false);
    expect(hasHighRiskIndicators("Risk: low")).toBe(false);
  });
});

describe("hasCommunicationTool", () => {
  it("detects ask_user", () => {
    expect(hasCommunicationTool(["bash", "ask_user", "read_file"])).toBe(true);
  });

  it("detects send_group_message", () => {
    expect(hasCommunicationTool(["send_group_message"])).toBe(true);
  });

  it("detects send_direct_message", () => {
    expect(hasCommunicationTool(["send_direct_message"])).toBe(true);
  });

  it("rejects when only execution tools used", () => {
    expect(hasCommunicationTool(["bash", "write_file", "read_file"])).toBe(false);
  });

  it("handles empty array", () => {
    expect(hasCommunicationTool([])).toBe(false);
  });
});

describe("isCompletionMessage", () => {
  it("detects English completion", () => {
    expect(isCompletionMessage("Task is done")).toBe(true);
    expect(isCompletionMessage("All tests completed")).toBe(true);
    expect(isCompletionMessage("Finished implementing the feature")).toBe(true);
  });

  it("detects Chinese completion", () => {
    expect(isCompletionMessage("任务已完成")).toBe(true);
    expect(isCompletionMessage("搞定了")).toBe(true);
    expect(isCompletionMessage("做好了")).toBe(true);
    expect(isCompletionMessage("完毕")).toBe(true);
  });

  it("rejects non-completion messages", () => {
    expect(isCompletionMessage("Starting work on this task")).toBe(false);
    expect(isCompletionMessage("I need more information")).toBe(false);
    expect(isCompletionMessage("Running tests now")).toBe(false);
  });
});

describe("shouldBlockCompletion", () => {
  it("blocks when all conditions met", () => {
    expect(shouldBlockCompletion(true, true, true, true, false)).toBe(true);
  });

  it("allows when not a worker", () => {
    expect(shouldBlockCompletion(false, true, true, true, false)).toBe(false);
  });

  it("allows when no active workflow", () => {
    expect(shouldBlockCompletion(true, false, true, true, false)).toBe(false);
  });

  it("allows when not a completion message", () => {
    expect(shouldBlockCompletion(true, true, false, true, false)).toBe(false);
  });

  it("allows when no code modifications", () => {
    expect(shouldBlockCompletion(true, true, true, false, false)).toBe(false);
  });

  it("allows when verification was run", () => {
    expect(shouldBlockCompletion(true, true, true, true, true)).toBe(false);
  });
});

describe("shouldNudgeVerification", () => {
  it("nudges after 3+ modifications without verification", () => {
    expect(shouldNudgeVerification(3, 0)).toBe(true);
    expect(shouldNudgeVerification(5, 0)).toBe(true);
    expect(shouldNudgeVerification(10, 0)).toBe(true);
  });

  it("does not nudge before 3 modifications", () => {
    expect(shouldNudgeVerification(0, 0)).toBe(false);
    expect(shouldNudgeVerification(1, 0)).toBe(false);
    expect(shouldNudgeVerification(2, 0)).toBe(false);
  });

  it("does not nudge if verification was already run", () => {
    expect(shouldNudgeVerification(5, 1)).toBe(false);
    expect(shouldNudgeVerification(10, 2)).toBe(false);
  });
});
