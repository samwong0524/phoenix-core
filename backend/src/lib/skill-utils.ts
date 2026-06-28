/**
 * Shared utility for parsing @skill references in message content.
 * Used by both frontend (autocomplete filtering) and backend (skill hint injection).
 */

/**
 * Extract @skill-name references from text content.
 * Matches @skill-name only when preceded by start-of-string or whitespace.
 * Returns deduplicated array of skill names (lowercase).
 */
export function parseSkillReferences(content: string): string[] {
  if (!content) return [];
  const regex = /(?:^|\s)@([a-z0-9_-]+)/gi;
  const matches = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    matches.add(match[1].toLowerCase());
  }
  return Array.from(matches);
}

/**
 * Detect if the text at a given cursor position is inside an @skill trigger.
 * Returns the filter string (text after @) if active, or null if not.
 */
export function detectAtTrigger(
  text: string,
  cursorPos: number
): { filter: string; atIndex: number } | null {
  // Walk backwards from cursor to find @
  let i = cursorPos - 1;
  while (i >= 0) {
    const ch = text[i];
    // If we hit a space or start of string, check if the char before is @
    if (ch === " " || ch === "\n" || ch === "\t") {
      // The @ must be right after this whitespace
      break;
    }
    if (ch === "@") {
      // @ must be at start of text or preceded by whitespace
      if (i === 0 || /\s/.test(text[i - 1])) {
        const filter = text.slice(i + 1, cursorPos);
        return { filter, atIndex: i };
      }
      return null;
    }
    // Only allow valid skill name chars between @ and cursor
    if (!/[a-zA-Z0-9_-]/.test(ch)) {
      return null;
    }
    i--;
  }
  return null;
}
