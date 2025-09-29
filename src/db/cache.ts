import { logger } from '../utils/logger.js';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class SchemaCache {
  private cache: Map<string, CacheEntry<any>>;
  private enabled: boolean;
  private defaultTTL: number;

  constructor() {
    this.cache = new Map();
    this.enabled = process.env.CACHE_ENABLED === 'true';
    this.defaultTTL = parseInt(process.env.CACHE_TTL || '3600', 10) * 1000; // Convert to milliseconds
  }

  public get<T>(key: string): T | null {
    if (!this.enabled) {
      return null;
    }

    const entry = this.cache.get(key);
    if (!entry) {
      logger.debug(`Cache miss: ${key}`);
      return null;
    }

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      logger.debug(`Cache expired: ${key}`);
      this.cache.delete(key);
      return null;
    }

    logger.debug(`Cache hit: ${key}`);
    return entry.data as T;
  }

  public set<T>(key: string, data: T, ttl?: number): void {
    if (!this.enabled) {
      return;
    }

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
    };

    this.cache.set(key, entry);
    logger.debug(`Cache set: ${key}`);
  }

  public delete(key: string): void {
    this.cache.delete(key);
    logger.debug(`Cache deleted: ${key}`);
  }

  public clear(): void {
    this.cache.clear();
    logger.info('Cache cleared');
  }

  public getStats(): { size: number; enabled: boolean; ttl: number } {
    return {
      size: this.cache.size,
      enabled: this.enabled,
      ttl: this.defaultTTL,
    };
  }
}

export const cache = new SchemaCache();
export default cache;