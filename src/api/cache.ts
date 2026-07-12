interface Entry<T> {
  v: T | null;
  exp: number;
  at: number; // insertion time, for eviction order
}

/** TTL cache with negative caching, optional localStorage persistence, and size cap. */
export class TtlCache<T> {
  private map = new Map<string, Entry<T>>();

  constructor(
    private storageKey: string,
    private storage: Storage | null,
    private ttlMs: number,
    private maxEntries: number,
    private now: () => number = Date.now,
  ) {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(storageKey);
      if (raw) {
        const obj: Record<string, Entry<T>> = JSON.parse(raw);
        const t = this.now();
        for (const [k, e] of Object.entries(obj)) {
          if (e && typeof e.exp === 'number' && e.exp > t) this.map.set(k, e);
        }
      }
    } catch {
      // corrupt cache: start fresh
    }
  }

  /** undefined = miss; null = cached negative result. */
  get(key: string): T | null | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.exp <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return e.v;
  }

  set(key: string, value: T | null): void {
    const t = this.now();
    this.map.set(key, { v: value, exp: t + this.ttlMs, at: t });
    while (this.map.size > this.maxEntries) {
      let oldestKey: string | null = null;
      let oldestAt = Infinity;
      for (const [k, e] of this.map) {
        if (e.at < oldestAt) { oldestAt = e.at; oldestKey = k; }
      }
      if (oldestKey === null) break;
      this.map.delete(oldestKey);
    }
    this.persist();
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const obj: Record<string, Entry<T>> = {};
      for (const [k, e] of this.map) obj[k] = e;
      this.storage.setItem(this.storageKey, JSON.stringify(obj));
    } catch {
      // quota exceeded: cache still works in memory
    }
  }
}
