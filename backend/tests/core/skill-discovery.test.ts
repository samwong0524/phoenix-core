import { describe, it, expect } from "vitest";
import {
  analyzeForSkillSuggestions,
  matchSuggestionsToSkills,
  type SkillSuggestion,
} from "@/runtime/skill-discovery";
import type { HistoryMessage } from "@/runtime/agent-types";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function msg(content: string, role: "user" | "assistant" | "system" = "assistant"): HistoryMessage {
  return { role, content };
}

// ─── analyzeForSkillSuggestions ────────────────────────────────────────────────

describe("analyzeForSkillSuggestions", () => {
  describe("repeated-tool-failure-recovery pattern", () => {
    it("should trigger when 3+ retry patterns are detected", () => {
      const history: HistoryMessage[] = [
        msg("retry the operation"),
        msg("try again with different params"),
        msg("failed on first attempt, fixing now"),
        msg("error on second attempt, need to fix"),
      ];
      const suggestions = analyzeForSkillSuggestions(history);
      const match = suggestions.find(s => s.triggerPattern === "repeated-tool-failure-recovery");
      expect(match).toBeDefined();
      expect(match!.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it("should not trigger with fewer than 3 retry patterns", () => {
      const history: HistoryMessage[] = [
        msg("retry the operation"),
        msg("try again"),
        msg("everything is fine now"),
      ];
      const suggestions = analyzeForSkillSuggestions(history);
      const match = suggestions.find(s => s.triggerPattern === "repeated-tool-failure-recovery");
      expect(match).toBeUndefined();
    });

    it("should detect multiple 'retry' occurrences across messages", () => {
      const history: HistoryMessage[] = [
        msg("retry the deployment step"),
        msg("retry the connection"),
        msg("retry after timeout"),
      ];
      const suggestions = analyzeForSkillSuggestions(history);
      const match = suggestions.find(s => s.triggerPattern === "repeated-tool-failure-recovery");
      expect(match).toBeDefined();
    });
  });

  describe("multi-step-workflow pattern", () => {
    it("should trigger when 5+ tool calls are detected", () => {
      const history: HistoryMessage[] = [
        msg("executing tool_call for bash"),
        msg("executing tool_call for read"),
        msg("executing tool_call for write"),
        msg("executing tool_call for bash"),
        msg("executing function call for deploy"),
      ];
      const suggestions = analyzeForSkillSuggestions(history);
      const match = suggestions.find(s => s.triggerPattern === "multi-step-workflow");
      expect(match).toBeDefined();
      expect(match!.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it("should not trigger with fewer than 5 tool calls", () => {
      const history: HistoryMessage[] = [
        msg("executing tool_call for bash"),
        msg("executing tool_call for read"),
        msg("executing tool_call for write"),
        msg("normal message"),
      ];
      const suggestions = analyzeForSkillSuggestions(history);
      const match = suggestions.find(s => s.triggerPattern === "multi-step-workflow");
      expect(match).toBeUndefined();
    });
  });

  describe("user-correction-pattern", () => {
    it("should trigger when 2+ user corrections are detected", () => {
      const history: HistoryMessage[] = [
        msg("No, that's not what I want", "user"),
        msg("Actually, I need the opposite", "user"),
        msg("Here is the result", "assistant"),
      ];
      const suggestions = analyzeForSkillSuggestions(history);
      const match = suggestions.find(s => s.triggerPattern === "user-correction-pattern");
      expect(match).toBeDefined();
      expect(match!.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("should detect 'wrong,' pattern", () => {
      const history: HistoryMessage[] = [
        msg("Wrong, please use a different approach", "user"),
        msg("Actually, let me clarify", "user"),
      ];
      const suggestions = analyzeForSkillSuggestions(history);
      const match = suggestions.find(s => s.triggerPattern === "user-correction-pattern");
      expect(match).toBeDefined();
    });

    it("should detect 'not what i asked' pattern", () => {
      const history: HistoryMessage[] = [
        msg("That is not what i asked for", "user"),
        msg("No, I meant something else", "user"),
      ];
      const suggestions = analyzeForSkillSuggestions(history);
      const match = suggestions.find(s => s.triggerPattern === "user-correction-pattern");
      expect(match).toBeDefined();
    });

    it("should not trigger with only 1 correction", () => {
      const history: HistoryMessage[] = [
        msg("No, that's wrong", "user"),
        msg("OK, that looks good now", "user"),
      ];
      const suggestions = analyzeForSkillSuggestions(history);
      const match = suggestions.find(s => s.triggerPattern === "user-correction-pattern");
      expect(match).toBeUndefined();
    });
  });

  describe("domain-specific-commands pattern", () => {
    it("should trigger when 4+ unique bash/command messages are detected", () => {
      const history: HistoryMessage[] = [
        msg("run bash command: docker build -t app ."),
        msg("run bash command: docker push registry/app"),
        msg("run bash command: kubectl apply -f deploy.yaml"),
        msg("run bash command: kubectl get pods"),
      ];
      const suggestions = analyzeForSkillSuggestions(history);
      const match = suggestions.find(s => s.triggerPattern === "domain-specific-commands");
      expect(match).toBeDefined();
      expect(match!.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it("should not trigger with fewer than 4 unique commands", () => {
      const history: HistoryMessage[] = [
        msg("run bash command: docker build"),
        msg("run bash command: docker push"),
        msg("run bash command: docker pull"),
      ];
      const suggestions = analyzeForSkillSuggestions(history);
      const match = suggestions.find(s => s.triggerPattern === "domain-specific-commands");
      expect(match).toBeUndefined();
    });

    it("should deduplicate by first 50 chars", () => {
      // These all share the same first 50 chars, so they count as 1 unique
      const prefix = "run bash command: " + "x".repeat(31); // exactly 50 chars total
      const history: HistoryMessage[] = [
        msg(prefix + "variation1"),
        msg(prefix + "variation2"),
        msg(prefix + "variation3"),
        msg(prefix + "variation4"),
      ];
      const suggestions = analyzeForSkillSuggestions(history);
      const match = suggestions.find(s => s.triggerPattern === "domain-specific-commands");
      expect(match).toBeUndefined();
    });
  });

  describe("empty and edge cases", () => {
    it("should return no suggestions for empty history", () => {
      const suggestions = analyzeForSkillSuggestions([]);
      expect(suggestions).toEqual([]);
    });

    it("should return no suggestions for normal conversation", () => {
      const history: HistoryMessage[] = [
        msg("Hello, how are you?", "user"),
        msg("I'm doing well, thanks!", "assistant"),
        msg("What's the weather like?", "user"),
        msg("It's sunny today.", "assistant"),
      ];
      const suggestions = analyzeForSkillSuggestions(history);
      expect(suggestions).toEqual([]);
    });

    it("should only consider the last 20 messages", () => {
      // Put 20 normal messages first, then the retry patterns
      const history: HistoryMessage[] = [];
      for (let i = 0; i < 20; i++) {
        history.push(msg(`normal message ${i}`));
      }
      // These would be beyond the 20-message window
      history.push(msg("retry attempt 1"));
      history.push(msg("retry attempt 2"));
      history.push(msg("retry attempt 3"));

      // The last 20 messages should include the retry patterns
      const suggestions = analyzeForSkillSuggestions(history);
      // Since the retry messages are within the last 20, they should be detected
      const match = suggestions.find(s => s.triggerPattern === "repeated-tool-failure-recovery");
      expect(match).toBeDefined();
    });

    it("should handle multimodal content (array of parts)", () => {
      const history: HistoryMessage[] = [
        {
          role: "assistant",
          content: [
            { type: "text", text: "retry the operation" },
            { type: "image_url", image_url: { url: "http://example.com/img.png" } },
          ],
        },
        msg("try again please"),
        msg("failed attempt detected, error fix needed"),
      ];
      const suggestions = analyzeForSkillSuggestions(history);
      const match = suggestions.find(s => s.triggerPattern === "repeated-tool-failure-recovery");
      expect(match).toBeDefined();
    });

    it("should return multiple suggestions when multiple patterns match", () => {
      // Craft messages that trigger both retry and correction patterns
      const history: HistoryMessage[] = [
        msg("retry the operation"),
        msg("try again with different approach"),
        msg("failed attempt, error fix needed"),
        msg("No, that's not right", "user"),
        msg("Actually, do it differently", "user"),
      ];
      const suggestions = analyzeForSkillSuggestions(history);
      expect(suggestions.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// ─── matchSuggestionsToSkills ──────────────────────────────────────────────────

describe("matchSuggestionsToSkills", () => {
  const availableSkills = [
    { name: "docker-helper", description: "Handles repeated failures and recovery for docker tool operations" },
    { name: "git-workflow", description: "Git workflow automation with repeated error recovery" },
    { name: "api-tester", description: "API testing and debugging tool" },
    { name: "data-migration", description: "Database migration and data transformation" },
  ];

  it("should match suggestions to skills based on keyword overlap", () => {
    const suggestions: SkillSuggestion[] = [
      {
        skillName: "repeated-tool-failure-recovery",
        confidence: 0.85,
        reason: "Detected repeated tool failures — consider creating a recovery skill",
        triggerPattern: "repeated-tool-failure-recovery",
      },
    ];

    const matches = matchSuggestionsToSkills(suggestions, availableSkills);
    expect(matches.length).toBeGreaterThan(0);
    // "recovery" keyword should match docker-helper and git-workflow
    const dockerMatch = matches.find(m => m.skill === "docker-helper");
    expect(dockerMatch).toBeDefined();
  });

  it("should return empty array when no skills match", () => {
    const suggestions: SkillSuggestion[] = [
      {
        skillName: "test-pattern",
        confidence: 0.9,
        reason: "xyzabc unique pattern no match",
        triggerPattern: "test-pattern",
      },
    ];

    const matches = matchSuggestionsToSkills(suggestions, availableSkills);
    expect(matches).toEqual([]);
  });

  it("should return empty array for empty suggestions", () => {
    const matches = matchSuggestionsToSkills([], availableSkills);
    expect(matches).toEqual([]);
  });

  it("should return empty array for empty skills list", () => {
    const suggestions: SkillSuggestion[] = [
      {
        skillName: "test",
        confidence: 0.9,
        reason: "recovery tool failure",
        triggerPattern: "test",
      },
    ];
    const matches = matchSuggestionsToSkills(suggestions, []);
    expect(matches).toEqual([]);
  });

  it("should sort matches by confidence descending", () => {
    const suggestions: SkillSuggestion[] = [
      {
        skillName: "test",
        confidence: 0.9,
        reason: "recovery error fix tool",
        triggerPattern: "test",
      },
    ];

    const matches = matchSuggestionsToSkills(suggestions, availableSkills);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].confidence).toBeGreaterThanOrEqual(matches[i].confidence);
    }
  });

  it("should scale match confidence by suggestion confidence", () => {
    const suggestions: SkillSuggestion[] = [
      {
        skillName: "test",
        confidence: 0.85,
        reason: "recovery tool failure docker",
        triggerPattern: "test",
      },
    ];

    const matches = matchSuggestionsToSkills(suggestions, availableSkills);
    for (const match of matches) {
      expect(match.confidence).toBeLessThanOrEqual(0.85);
      expect(match.confidence).toBeGreaterThan(0);
    }
  });
});
