/**
 * Skill Auto-Discovery Engine (A-05)
 *
 * Analyzes conversation history for patterns that indicate skill opportunities.
 * Emits non-blocking suggestions via the UI bus when confidence >= 0.8.
 * Integrated into the nudge analysis cycle in agent-runtime.ts.
 */

import type { HistoryMessage } from "./agent-types";

export interface SkillSuggestion {
  skillName: string;
  confidence: number;
  reason: string;
  triggerPattern: string;
}

// Pattern matchers: each returns a confidence score 0-1
interface PatternMatcher {
  name: string;
  test: (history: HistoryMessage[], recentMessages: string[]) => { confidence: number; reason: string };
}

const PATTERNS: PatternMatcher[] = [
  {
    name: "repeated-tool-failure-recovery",
    test: (_history, recent) => {
      // Detect when agent retries on a tool 3+ times before succeeding
      const text = recent.join(" ");
      const retryPatterns = text.match(/retry|try again|failed.*attempt|error.*fix/gi) || [];
      if (retryPatterns.length >= 3) {
        return { confidence: 0.85, reason: "Detected repeated tool failures — consider creating a recovery skill" };
      }
      return { confidence: 0, reason: "" };
    },
  },
  {
    name: "multi-step-workflow",
    test: (_history, recent) => {
      // Detect sequential tool patterns (bash → read → write → bash)
      const toolCalls = recent.filter(m => m.includes("tool_call") || m.includes("function"));
      if (toolCalls.length >= 5) {
        return { confidence: 0.82, reason: "Complex multi-step workflow detected — could be templated as a skill" };
      }
      return { confidence: 0, reason: "" };
    },
  },
  {
    name: "user-correction-pattern",
    test: (_history, recent) => {
      // Detect when user corrects the agent multiple times on same topic
      const corrections = recent.filter(m =>
        m.toLowerCase().includes("no, ") ||
        m.toLowerCase().includes("wrong,") ||
        m.toLowerCase().includes("actually,") ||
        m.toLowerCase().includes("not what i asked")
      );
      if (corrections.length >= 2) {
        return { confidence: 0.9, reason: "User corrected agent multiple times — skill needed for clarification" };
      }
      return { confidence: 0, reason: "" };
    },
  },
  {
    name: "domain-specific-commands",
    test: (_history, recent) => {
      // Detect repeated bash commands or patterns in same domain
      const bashCalls = recent.filter(m => m.includes("bash") || m.includes("command"));
      const uniqueCmds = new Set(bashCalls.map(m => m.slice(0, 50)));
      if (uniqueCmds.size >= 4) {
        return { confidence: 0.8, reason: "Repeated domain-specific commands detected — consider a skill" };
      }
      return { confidence: 0, reason: "" };
    },
  },
];

const CONFIDENCE_THRESHOLD = 0.8;

/**
 * Analyze conversation history for skill suggestion opportunities.
 * Returns suggestions with confidence >= CONFIDENCE_THRESHOLD.
 */
export function analyzeForSkillSuggestions(
  history: HistoryMessage[],
): SkillSuggestion[] {
  // Extract recent messages (last 20)
  const recent = history
    .slice(-20)
    .map(m => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) return m.content.map(p => p.type === "text" ? p.text : "").join(" ");
      return "";
    })
    .filter(Boolean);

  const suggestions: SkillSuggestion[] = [];

  for (const pattern of PATTERNS) {
    const result = pattern.test(history, recent);
    if (result.confidence >= CONFIDENCE_THRESHOLD) {
      suggestions.push({
        skillName: pattern.name,
        confidence: result.confidence,
        reason: result.reason,
        triggerPattern: pattern.name,
      });
    }
  }

  return suggestions;
}

/**
 * Match suggestions against existing skills to find the best existing skill.
 * Returns skill names that could help with the detected pattern.
 */
export function matchSuggestionsToSkills(
  suggestions: SkillSuggestion[],
  availableSkills: Array<{ name: string; description: string }>
): Array<{ skill: string; confidence: number; reason: string }> {
  const matches: Array<{ skill: string; confidence: number; reason: string }> = [];

  for (const suggestion of suggestions) {
    // Simple keyword matching between suggestion reason and skill descriptions
    const keywords = suggestion.reason.toLowerCase().split(/\s+/).filter(w => w.length > 4);

    for (const skill of availableSkills) {
      const descLower = skill.description.toLowerCase();
      const matchCount = keywords.filter(k => descLower.includes(k)).length;
      const matchRatio = keywords.length > 0 ? matchCount / keywords.length : 0;

      if (matchRatio >= 0.3) {
        matches.push({
          skill: skill.name,
          confidence: suggestion.confidence * matchRatio,
          reason: suggestion.reason,
        });
      }
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}
