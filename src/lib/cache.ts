interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

/** TTL + LRU 단순 캐시 (law-mcp 패턴) */
export class SimpleCache {
  private cache = new Map<string, CacheEntry<unknown>>()
  private maxSize: number

  constructor(maxSize = 300) {
    this.maxSize = maxSize
  }

  set<T>(key: string, data: T, ttl = 24 * 60 * 60 * 1000): void {
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOne()
    }
    this.cache.delete(key)
    this.cache.set(key, { data, timestamp: Date.now(), ttl })
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      return null
    }
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry.data as T
  }

  private evictOne(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key)
        return
      }
    }
    const oldest = this.cache.keys().next().value
    if (oldest) this.cache.delete(oldest)
  }

  cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) this.cache.delete(key)
    }
  }
}

export const patentCache = new SimpleCache(300)

setInterval(() => patentCache.cleanup(), 60 * 60 * 1000).unref()
