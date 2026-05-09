interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class SchemaCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private ttl = Number.parseInt(process.env.CACHE_TTL || '3600', 10) * 1000;
  private enabled = process.env.CACHE_ENABLED !== 'false';

  get<T>(key: string): T | null {
    if (!this.enabled) {
      return null;
    }

    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    if (!this.enabled) {
      return;
    }
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

export const cache = new SchemaCache();
