export interface KeyEntry {
  key: string;
  cooldownUntil: number; // timestamp (ms) when this key becomes available again
}

export class KeyPool {
  private entries: KeyEntry[] = [];
  private index = 0;

  constructor(keys: string[]) {
    this.entries = keys.filter(k => k.length > 0).map(k => ({ key: k, cooldownUntil: 0 }));
  }

  hasKeys(): boolean {
    return this.entries.length > 0;
  }

  hasAvailable(): boolean {
    return this.entries.some(e => e.cooldownUntil < Date.now());
  }

  /** Get next available key (round-robin with cooldown skip). Returns null if all keys are in cooldown. */
  getNext(): string | null {
    const now = Date.now();
    if (this.entries.length === 0) return null;
    if (this.entries.length === 1) {
      const e = this.entries[0];
      if (e.cooldownUntil > now) return null;
      return e.key;
    }
    // Try to find an available key starting from current index (round-robin)
    for (let i = 0; i < this.entries.length; i++) {
      const idx = (this.index + i) % this.entries.length;
      const entry = this.entries[idx];
      if (entry.cooldownUntil <= now) {
        this.index = (idx + 1) % this.entries.length;
        return entry.key;
      }
    }
    return null; // all keys in cooldown
  }

  /** Mark a key as rate-limited. It will be skipped for cooldownMs. */
  mark429(key: string, cooldownMs: number): void {
    const entry = this.entries.find(e => e.key === key);
    if (entry) {
      entry.cooldownUntil = Date.now() + cooldownMs;
      console.warn(`[KeyPool] key ${key.slice(0, 8)}... in cooldown for ${cooldownMs}ms`);
    }
  }

  size(): number {
    return this.entries.length;
  }
}

// Per-provider key pools (lazily initialized)
export let _glmKeyPool: KeyPool | null = null;
export let _openrouterKeyPool: KeyPool | null = null;
export let _anthropicKeyPool: KeyPool | null = null;
export let _freellmapiKeyPool: KeyPool | null = null;

export function parseKeyPool(envKey: string, fallbackKey: string): KeyPool {
  const keys = process.env[envKey]
    ? process.env[envKey].split(",").map(k => k.trim()).filter(k => k.length > 0)
    : fallbackKey ? [fallbackKey] : [];
  return new KeyPool(keys);
}

export function getGlmKeyPool(): KeyPool {
  if (_glmKeyPool) return _glmKeyPool;
  _glmKeyPool = parseKeyPool("GLM_API_KEYS", process.env.GLM_API_KEY ?? process.env.ZHIPUAI_API_KEY ?? "");
  return _glmKeyPool;
}

export function getOpenrouterKeyPool(): KeyPool {
  if (_openrouterKeyPool) return _openrouterKeyPool;
  _openrouterKeyPool = parseKeyPool("OPENROUTER_API_KEYS", process.env.OPENROUTER_API_KEY ?? "");
  return _openrouterKeyPool;
}

export function getAnthropicKeyPool(): KeyPool {
  if (_anthropicKeyPool) return _anthropicKeyPool;
  _anthropicKeyPool = parseKeyPool("ANTHROPIC_API_KEYS", process.env.ANTHROPIC_API_KEY ?? "");
  return _anthropicKeyPool;
}

export function getFreellmapiKeyPool(): KeyPool {
  if (_freellmapiKeyPool) return _freellmapiKeyPool;
  _freellmapiKeyPool = parseKeyPool("FREELLMAPI_API_KEYS", process.env.FREELLMAPI_API_KEY ?? "");
  return _freellmapiKeyPool;
}

// Invalidate all key pools (e.g., after .env change)
export function invalidateKeyPools(): void {
  _glmKeyPool = null;
  _openrouterKeyPool = null;
  _anthropicKeyPool = null;
  _freellmapiKeyPool = null;
}

/**
 * Global LLM request scheduler.
 * Ensures at most 1 concurrent LLM request with a minimum gap between calls,
 * forming a natural rate limiter (~50 requests/minute ceiling).
 * All agents share this single queue — when one agent's LLM call is retrying
 * on 429, others wait their turn instead of compounding the rate-limit.
 */
