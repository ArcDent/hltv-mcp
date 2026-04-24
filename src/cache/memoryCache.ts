interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
}

export interface MemoryCacheOptions {
  maxEntries?: number;
  maxStaleSeconds?: number;
  now?: () => number;
}

export interface StaleCacheHit<T> {
  value: T;
  staleAgeSec: number;
}

export class MemoryCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  private readonly maxStaleMs: number;
  private readonly now: () => number;

  constructor(options: MemoryCacheOptions = {}) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 500));
    this.maxStaleMs = Math.max(options.maxStaleSeconds ?? 3_600, 0) * 1_000;
    this.now = options.now ?? Date.now;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      return undefined;
    }

    const currentTime = this.now();
    if (entry.expiresAt <= currentTime) {
      if (this.isTooStale(entry, currentTime)) {
        this.store.delete(key);
      }
      return undefined;
    }

    return entry.value;
  }

  getStale<T>(key: string): T | undefined {
    return this.getStaleWithMeta<T>(key)?.value;
  }

  getStaleWithMeta<T>(key: string): StaleCacheHit<T> | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      return undefined;
    }

    const currentTime = this.now();
    if (this.isTooStale(entry, currentTime)) {
      this.store.delete(key);
      return undefined;
    }

    return {
      value: entry.value,
      staleAgeSec: Math.max(0, Math.floor((currentTime - entry.expiresAt) / 1_000))
    };
  }

  async runOnce<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }

    const promise = Promise.resolve().then(compute);
    this.inFlight.set(key, promise);

    try {
      return await promise;
    } finally {
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    }
  }

  set<T>(key: string, value: T, ttlSeconds: number): void {
    const ttlMs = Math.max(ttlSeconds, 1) * 1_000;
    const currentTime = this.now();
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    this.store.set(key, {
      value,
      createdAt: currentTime,
      expiresAt: currentTime + ttlMs
    });
    this.evictOverflow();
  }

  clear(): void {
    this.store.clear();
    this.inFlight.clear();
  }

  private evictOverflow(): void {
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value as string | undefined;
      if (!oldestKey) {
        return;
      }
      this.store.delete(oldestKey);
    }
  }

  private isTooStale(entry: CacheEntry<unknown>, currentTime: number): boolean {
    return currentTime - entry.expiresAt > this.maxStaleMs;
  }
}
