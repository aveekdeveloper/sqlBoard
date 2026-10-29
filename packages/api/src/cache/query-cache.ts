import LRUCache from 'lru-cache';

interface CacheEntry {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  cachedAt: number;
  staleAt: number;
}

export class QueryCache {
  private cache: LRUCache<string, CacheEntry>;

  constructor(
    private readonly ttlMs: number,
    maxEntries = 500,
  ) {
    this.cache = new LRUCache<string, CacheEntry>({ max: maxEntries });
  }

  get(key: string): CacheEntry | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.staleAt) {
      this.cache.delete(key);
      return null;
    }
    return entry;
  }

  set(key: string, columns: string[], rows: Array<Record<string, unknown>>): void {
    const now = Date.now();
    this.cache.set(key, {
      columns,
      rows,
      cachedAt: now,
      staleAt: now + this.ttlMs,
    });
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /** Drop every cached result for a single connection (keys are `connectionId:...`). */
  invalidateConnection(connectionId: number): void {
    const prefix = `${connectionId}:`;
    for (const key of this.cache.keys()) {
      if (String(key).startsWith(prefix)) this.cache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  static hashKey(connectionId: number, sql: string, params?: unknown[]): string {
    const base = `${connectionId}:${sql.trim()}`;
    if (!params || params.length === 0) return base;
    return `${base}:${JSON.stringify(params)}`;
  }
}
