/**
 * @file cache.ts
 * Core caching logic — cacheQuery wraps any async read function with
 * Redis-backed caching, TTL support, and tag-based key registration.
 *
 * Failure contract:
 * - Redis errors during READ  → warn and fall through to the query function
 * - Redis errors during WRITE → warn and return the query result anyway
 * - Query errors              → always propagate as DBError
 */

import { CacheError, DBError } from "./types.js";
import type { CacheQueryOptions, CacheStore } from "./types.js";

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function warn(debug: boolean, message: string, detail?: unknown): void {
  if (debug) {
    console.warn(`[icacheyou] ⚠️  ${message}`, detail ?? "");
  } else {
    // Always warn on cache issues, even without debug mode, so devs spot them
    console.warn(`[icacheyou] ${message}`);
  }
}

function log(debug: boolean, message: string, detail?: unknown): void {
  if (debug) {
    console.log(`[icacheyou] 🔍 ${message}`, detail ?? "");
  }
}

// ---------------------------------------------------------------------------
// cacheQuery
// ---------------------------------------------------------------------------

/**
 * Wraps a read/query function with Redis caching.
 *
 * On cache HIT  → deserializes and returns the cached value immediately.
 * On cache MISS → calls queryFn, stores the result in Redis, then returns it.
 * On Redis FAIL → falls through to queryFn so the app stays functional.
 *
 * @param store     - CacheStore instance (from redisStore())
 * @param queryFn   - The async function that fetches data (e.g. Drizzle query)
 * @param args      - Arguments passed to queryFn and used to compute the key
 * @param options   - Key derivation, TTL, tags, and debug flag
 * @returns         - The resolved query result (from cache or DB)
 *
 * @example
 * const user = await cacheQuery(
 *   store,
 *   (id: number) => db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, id) }),
 *   userId,
 *   { key: (id) => `user:${id}`, ttl: 120, tags: (id) => [`user:${id}`] }
 * );
 */
export async function cacheQuery<TArgs, TResult>(
  store: CacheStore,
  queryFn: (args: TArgs) => Promise<TResult>,
  args: TArgs,
  options: CacheQueryOptions<TArgs>,
): Promise<TResult> {
  const { key, ttl = 60, tags, debug = false } = options;
  const cacheKey = key(args);

  // ------------------------------------------------------------------
  // 1. Try to read from cache
  // ------------------------------------------------------------------
  let cached: string | null = null;

  try {
    cached = await store.get(cacheKey);
    log(debug, `GET ${cacheKey} → ${cached ? "HIT" : "MISS"}`);
  } catch (err) {
    // Redis read failure — warn but continue to query
    warn(
      debug,
      `Cache read failed for key "${cacheKey}". Falling through to DB.`,
      err,
    );
  }

  // ------------------------------------------------------------------
  // 2. Cache HIT — deserialize and return
  // ------------------------------------------------------------------
  if (cached !== null) {
    try {
      return JSON.parse(cached) as TResult;
    } catch (err) {
      // Corrupted cache entry — warn and re-fetch from DB
      warn(
        debug,
        `Failed to deserialize cached value for key "${cacheKey}". Re-fetching from DB.`,
        err,
      );
    }
  }

  // ------------------------------------------------------------------
  // 3. Cache MISS — call the query function
  // ------------------------------------------------------------------
  let result: TResult;

  try {
    result = await queryFn(args);
  } catch (err) {
    // DB errors always propagate — we never swallow query failures
    throw new DBError(`Query function failed for cache key "${cacheKey}"`, err);
  }

  // ------------------------------------------------------------------
  // 4. Store result in Redis (best-effort — errors are non-fatal)
  // ------------------------------------------------------------------
  try {
    const serialized = JSON.stringify(result);
    await store.set(cacheKey, serialized, ttl);
    log(debug, `SET ${cacheKey} (TTL: ${ttl}s)`);

    // Register key under each tag for future invalidation
    if (tags) {
      const tagList = tags(args);
      for (const tag of tagList) {
        await store.tag(tag, [cacheKey]);
        log(debug, `Tagged "${cacheKey}" under "${tag}"`);
      }
    }
  } catch (err) {
    // Cache write failure — the result is still valid, just not cached
    warn(
      debug,
      `Failed to write cache for key "${cacheKey}". Result returned uncached.`,
      err instanceof CacheError ? err.message : err,
    );
  }

  return result;
}
