import { Injectable, Logger } from '@nestjs/common';

/**
 * Short-lived in-process cache for high-traffic read paths.
 *
 * The trending leaderboard, the destination feed and the per-trek like counts
 * are read on essentially every screen, by every user, and they change only
 * when somebody taps a heart. Recomputing the aggregation per request was the
 * dominant cost on those routes; a few seconds of staleness is not.
 *
 * Deliberately in-process rather than Redis: the read paths it fronts are
 * per-deployment aggregations, not shared session state, so a local map gives
 * the same latency win with no extra service to run or fail. `CACHE_REDIS_URL`
 * is intentionally *not* consulted — introducing a second cache tier that can
 * be unreachable would trade a real dependency for a marginal hit rate.
 *
 * Three properties make it safe to sit in front of live data:
 *
 *   · **Bounded staleness.** Every entry carries its own TTL, measured in
 *     seconds, so nothing can go stale indefinitely.
 *   · **Write-through invalidation.** A like/unlike calls `invalidate()` for
 *     the affected tags, so a user's own action is reflected immediately rather
 *     than after the TTL elapses. This is what keeps "refresh downtime" at zero
 *     for the person who caused the change.
 *   · **Single-flight.** Concurrent misses for the same key share one
 *     computation instead of stampeding the database.
 */

interface CacheEntry<T> {
  value: T;
  /** Epoch millis after which the entry must not be served. */
  expiresAt: number;
  /** Invalidation tags this entry belongs to. */
  tags: readonly string[];
}

/** Cache tags, so a write can invalidate exactly the reads it affects. */
export const CacheTag = {
  /** Anything derived from the likes collection: counts, trending, feeds. */
  LIKES: 'likes',
  /** The destination catalogue itself. */
  DESTINATIONS: 'destinations',
} as const;

export type CacheTagValue = (typeof CacheTag)[keyof typeof CacheTag];

/** Default TTLs, in milliseconds. Short enough that nothing feels stale. */
export const CACHE_TTL = {
  /** Trending leaderboard — invalidated on every like, so this is a backstop. */
  TRENDING: 10_000,
  /** Per-trek like counts. Same write-through invalidation applies. */
  LIKE_COUNTS: 10_000,
  /** The destination catalogue. Only changes on a re-seed. */
  CATALOGUE: 60_000,
  /** A user's personalised feed. Short: it must react to their own likes. */
  FEED: 15_000,
} as const;

/** How many entries to hold before evicting the oldest-expiring ones. */
const MAX_ENTRIES = 500;

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly store = new Map<string, CacheEntry<unknown>>();
  /** In-flight computations, keyed the same way, for single-flight de-duping. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  /**
   * Read `key` from the cache, computing and storing it on a miss.
   *
   * `compute` is never called more than once concurrently for the same key. If
   * it throws, nothing is cached and the error propagates to every waiter — a
   * failed load must not be memoised as a successful empty result.
   */
  async wrap<T>(
    key: string,
    ttlMs: number,
    tags: readonly string[],
    compute: () => Promise<T>
  ): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;

    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const pending = (async () => {
      try {
        const value = await compute();
        this.set(key, value, ttlMs, tags);
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, pending);
    return pending;
  }

  /** A live (non-expired) value, or undefined on a miss. */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number, tags: readonly string[] = []): void {
    if (this.store.size >= MAX_ENTRIES) this.evict();
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs, tags });
  }

  /**
   * Drop every entry carrying any of `tags`. Called write-through from the like
   * path so the user who caused a change never reads their own stale data.
   */
  invalidate(...tags: readonly string[]): void {
    if (tags.length === 0) return;
    const wanted = new Set(tags);
    for (const [key, entry] of this.store) {
      if (entry.tags.some(tag => wanted.has(tag))) this.store.delete(key);
    }
  }

  /** Drop a single key. */
  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /** Evict expired entries first, then the soonest-to-expire, to stay bounded. */
  private evict(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) this.store.delete(key);
    }
    if (this.store.size < MAX_ENTRIES) return;

    const byExpiry = Array.from(this.store.entries()).sort(
      (a, b) => a[1].expiresAt - b[1].expiresAt
    );
    const drop = Math.ceil(MAX_ENTRIES * 0.2);
    for (let i = 0; i < drop && i < byExpiry.length; i++) {
      this.store.delete(byExpiry[i][0]);
    }
    this.logger.debug(`Evicted ${drop} cache entries to stay under ${MAX_ENTRIES}`);
  }
}
