/**
 * @file redisStore.ts
 * Redis adapter — translates the minimal RedisClient interface into a
 * full CacheStore that icacheyou understands.
 *
 * Compatible with: ioredis, @upstash/redis, Bun's built-in Redis client,
 * or any object that satisfies the RedisClient interface.
 */

import { RedisError } from "./types.js";
import type { CacheStore, RedisClient } from "./types.js";

/**
 * TAG_PREFIX is prepended to all Redis keys that store tag → key-set mappings.
 * This separates tag metadata from actual cached values.
 *
 * Example: tag "user:1" → Redis key "icacheyou:tag:user:1"
 */
const TAG_PREFIX = "icacheyou:tag:";

/**
 * Creates a CacheStore adapter from any Redis client that satisfies
 * the RedisClient interface.
 *
 * @param client - A Redis client instance (ioredis, Upstash, Bun Redis, etc.)
 * @returns       A CacheStore ready to pass to cacheQuery / withInvalidation
 *
 * @example
 * import { Redis } from "ioredis";
 * const redis = new Redis();
 * const store = redisStore(redis);
 */
export function redisStore(client: RedisClient): CacheStore {
  return {
    // ------------------------------------------------------------------
    // get: read a cached value by key
    // ------------------------------------------------------------------
    async get(key: string): Promise<string | null> {
      try {
        return await client.get(key);
      } catch (err) {
        throw new RedisError(`Redis GET failed for key "${key}"`, err);
      }
    },

    // ------------------------------------------------------------------
    // set: write a value with optional TTL
    // ------------------------------------------------------------------
    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
      try {
        if (ttlSeconds !== undefined && ttlSeconds > 0) {
          await client.set(key, value, { ex: ttlSeconds });
        } else {
          await client.set(key, value);
        }
      } catch (err) {
        throw new RedisError(`Redis SET failed for key "${key}"`, err);
      }
    },

    // ------------------------------------------------------------------
    // del: delete one or more keys
    // ------------------------------------------------------------------
    async del(keys: string[]): Promise<void> {
      if (keys.length === 0) return;
      try {
        await client.del(...keys);
      } catch (err) {
        throw new RedisError(
          `Redis DEL failed for keys [${keys.join(", ")}]`,
          err,
        );
      }
    },

    // ------------------------------------------------------------------
    // tag: associate keys with a tag for later bulk-invalidation
    // SADD is idempotent — adding the same key twice is safe
    // ------------------------------------------------------------------
    async tag(tag: string, keys: string[]): Promise<void> {
      if (keys.length === 0) return;
      const tagKey = `${TAG_PREFIX}${tag}`;
      try {
        await client.sadd(tagKey, ...keys);
      } catch (err) {
        throw new RedisError(
          `Redis SADD failed for tag "${tag}" → keys [${keys.join(", ")}]`,
          err,
        );
      }
    },

    // ------------------------------------------------------------------
    // keysForTag: retrieve all cache keys belonging to a tag
    // ------------------------------------------------------------------
    async keysForTag(tag: string): Promise<string[]> {
      const tagKey = `${TAG_PREFIX}${tag}`;
      try {
        return await client.smembers(tagKey);
      } catch (err) {
        throw new RedisError(`Redis SMEMBERS failed for tag "${tag}"`, err);
      }
    },
  };
}
