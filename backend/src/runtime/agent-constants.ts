export const MAX_LLM_RETRIES = 5;
export const LLM_RETRY_BASE_MS = 3000;
export const LLM_REQUEST_TIMEOUT_MS = 60000; // 60s max per request
export const MAX_CONCURRENT_LLM = 1;
export const MIN_LLM_INTERVAL_MS = 1200; // minimum gap between LLM calls (~50 QPM ceiling)

// Nudge Engine: lightweight background analysis that runs periodically during a conversation.
// Every NUDGE_INTERVAL rounds, the agent reviews recent history for patterns
// (tool failures that recovered, repeated commands, successful workflows)
// and auto-creates skills from them. Best-effort, non-blocking.
export const NUDGE_INTERVAL = 15; // rounds between nudge analyses
export const MAX_AUTO_SKILLS_PER_AGENT_PER_DAY = 3; // shared with autoCreateSkillFromWorkflow

// Context compression configuration (design doc §6.3)
export const COMPRESS_PROTECT_FIRST = 2; // protect first N system messages
export const COMPRESS_PROTECT_LAST = 8;  // keep last N messages intact
export const COMPRESS_TRIGGER = 12;       // trigger compression when history > N
export const COMPRESS_MAX_CONTENT = 2000; // max chars per individual message before truncation

// Key Pool: per-provider API key rotation with 429 cooldown

// Skill lifecycle constants (design doc §11.4)
export const SKILL_STALE_DAYS = 30;       // days without use → stale warning
export const SKILL_ARCHIVE_DAYS = 90;     // days without use → archive
export const SKILL_MERGE_SIMILARITY = 0.7; // description overlap threshold for dedup
// Keys are parsed from *_API_KEYS env var (comma-separated)
