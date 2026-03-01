/**
 * @file index.ts
 * Public entry point for icacheyou.
 *
 * Recommended usage:
 *   import icacheyou from 'icacheyou';
 *   const cache = icacheyou.create(process.env.REDIS_URL!);
 *
 *   cache.query(...)      // cached read
 *   cache.mutate(...)     // mutation + invalidation
 *   cache.key(...)        // stable key builder
 *   cache.redis.get(...)  // raw Redis access
 *
 * Named exports for advanced / tree-shaken usage:
 *   import { createICacheYou, cacheQuery, withInvalidation, stableKey } from 'icacheyou';
 */

import { createICacheYou } from "./createClient.js";
import { stableKey } from "./key.js";

// ---------------------------------------------------------------------------
// Named exports
// ---------------------------------------------------------------------------

// Factory (main export)
export { createICacheYou } from "./createClient.js";
export type { ICacheYouClient } from "./createClient.js";

// Low-level building blocks (advanced use, bring-your-own-redis)
export { cacheQuery } from "./cache.js";
export { withInvalidation } from "./mutation.js";
export { redisStore } from "./redisStore.js";
export { stableKey } from "./key.js";

// Types
export type {
  RedisClient,
  CacheStore,
  CacheQueryOptions,
  WithInvalidationOptions,
} from "./types.js";

// Error classes
export { IcacheyouError, CacheError, RedisError, DBError } from "./types.js";

// ---------------------------------------------------------------------------
// Default export — namespaced API
// ---------------------------------------------------------------------------

/**
 * @example
 * import icacheyou from 'icacheyou';
 *
 * const cache = icacheyou.create(process.env.REDIS_URL!);
 *
 * const user = await cache.query(getUser, id, {
 *   key: (id) => cache.key("user", { id }),
 *   ttl: 120,
 *   tags: (id) => [`user:${id}`, "users"],
 * });
 *
 * await cache.mutate(updateUser, { id, name }, (a) => [`user:${a.id}`]);
 *
 * await cache.redis.set("hits", "0");
 * await cache.redis.incr("hits");
 */
const icacheyou = {
  /**
   * Bootstrap a fully-wired client from a Redis URL.
   * Returns { query, mutate, key, redis }.
   */
  create: createICacheYou,

  /**
   * Build a stable, deterministic Redis key from a prefix + args.
   * Deep-sorts object keys so argument order never causes cache misses.
   */
  stableKey,
} as const;

export default icacheyou;
