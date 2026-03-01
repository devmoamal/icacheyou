/**
 * @file createClient.ts
 * Factory function — pass a Redis URL, get back a fully-wired icacheyou client.
 *
 * Uses Bun's built-in RedisClient (available from Bun v1.1+).
 *
 * @example
 * // lib/icacheyou.ts
 * import { createICacheYou } from "icacheyou";
 * export const cache = createICacheYou(process.env.REDIS_URL!);
 *
 * // Anywhere in your app
 * import { cache } from "@/lib/icacheyou";
 *
 * const user = await cache.query(getUserById, id, {
 *   key: (id) => cache.key("user", { id }),
 *   ttl: 120,
 *   tags: (id) => [`user:${id}`, "users"],
 * });
 *
 * await cache.mutate(updateUser, { id, name }, (args) => [`user:${args.id}`]);
 *
 * // Direct Redis access
 * await cache.redis.set("foo", "bar");
 * const val = await cache.redis.get("foo");
 */

import { RedisClient } from "bun";

import { cacheQuery } from "./cache.js";
import { withInvalidation } from "./mutation.js";
import { stableKey } from "./key.js";
import type {
  CacheQueryOptions,
  CacheStore,
  WithInvalidationOptions,
} from "./types.js";

// ---------------------------------------------------------------------------
// Bun RedisClient → CacheStore adapter
//
// Bun's set() uses positional EX/PX args instead of an options object,
// so we bridge it to match our CacheStore interface.
// ---------------------------------------------------------------------------

function bunClientToStore(client: RedisClient): CacheStore {
  return {
    async get(key) {
      return client.get(key);
    },

    async set(key, value, ttlSeconds) {
      if (ttlSeconds !== undefined && ttlSeconds > 0) {
        await client.set(key, value, "EX", ttlSeconds);
      } else {
        await client.set(key, value);
      }
    },

    async del(keys) {
      if (keys.length === 0) return;
      await client.del(...keys);
    },

    async tag(tag, keys) {
      if (keys.length === 0) return;
      await client.sadd(`icacheyou:tag:${tag}`, ...keys);
    },

    async keysForTag(tag) {
      return client.smembers(`icacheyou:tag:${tag}`);
    },
  };
}

// ---------------------------------------------------------------------------
// ICacheYouClient
// ---------------------------------------------------------------------------

export interface ICacheYouClient {
  /**
   * Direct access to the raw Bun RedisClient.
   * Full Redis command surface — get, set, del, expire, ttl, sadd,
   * smembers, hset, hget, lpush, rpush, zadd, incr, publish, and more.
   *
   * @example
   * cache.redis.get("key")
   * cache.redis.set("key", "value", "EX", 60)
   * cache.redis.del("key")
   * cache.redis.expire("key", 30)
   * cache.redis.ttl("key")
   * cache.redis.incr("counter")
   * cache.redis.sadd("myset", "a", "b")
   * cache.redis.smembers("myset")
   * cache.redis.hset("hash", "field", "value")
   * cache.redis.hget("hash", "field")
   * cache.redis.lpush("list", "item")
   * cache.redis.lrange("list", 0, -1)
   * cache.redis.zadd("zset", 1, "member")
   * cache.redis.publish("channel", "message")
   */
  readonly redis: RedisClient;

  /**
   * Cache a read/query function.
   * Checks Redis first — falls through to queryFn on miss or Redis failure.
   */
  query<TArgs, TResult>(
    queryFn: (args: TArgs) => Promise<TResult>,
    args: TArgs,
    options: CacheQueryOptions<TArgs>,
  ): Promise<TResult>;

  /**
   * Wrap a mutation and auto-invalidate cache tags after success.
   * DB errors always propagate; cache errors are non-fatal warnings.
   */
  mutate<TArgs, TResult>(
    mutationFn: (args: TArgs) => Promise<TResult>,
    args: TArgs,
    getTags: (args: TArgs) => string[],
    options?: WithInvalidationOptions,
  ): Promise<TResult>;

  /**
   * Build a stable, deterministic Redis cache key from a prefix + args.
   * Deep-sorts object keys so argument order never causes cache misses.
   *
   * @example
   * cache.key("user", { id: 1 }) // → "user:{"id":1}"
   */
  key(prefix: string, args?: unknown): string;
}

// ---------------------------------------------------------------------------
// createICacheYou
// ---------------------------------------------------------------------------

/**
 * Bootstrap a fully-wired icacheyou client from a Redis URL.
 *
 * @param redisUrl - e.g. "redis://localhost:6379" or "rediss://user:pass@host:6380"
 */
export function createICacheYou(redisUrl: string): ICacheYouClient {
  const redis = new RedisClient(redisUrl);
  const store = bunClientToStore(redis);

  return {
    redis,

    query<TArgs, TResult>(
      queryFn: (args: TArgs) => Promise<TResult>,
      args: TArgs,
      options: CacheQueryOptions<TArgs>,
    ): Promise<TResult> {
      return cacheQuery(store, queryFn, args, options);
    },

    mutate<TArgs, TResult>(
      mutationFn: (args: TArgs) => Promise<TResult>,
      args: TArgs,
      getTags: (args: TArgs) => string[],
      options?: WithInvalidationOptions,
    ): Promise<TResult> {
      return withInvalidation(store, mutationFn, args, getTags, options);
    },

    key(prefix: string, args?: unknown): string {
      return stableKey(prefix, args);
    },
  };
}
