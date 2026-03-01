/**
 * @file types.ts
 * All shared types, interfaces, and custom error classes for icacheyou.
 */

// ---------------------------------------------------------------------------
// Redis client abstraction — accept any Redis client that satisfies this shape
// ---------------------------------------------------------------------------

/**
 * Minimal Redis interface that icacheyou requires.
 * Compatible with `ioredis`, `@upstash/redis`, and any redis client
 * that exposes get/set/del/sadd/smembers.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ex?: number }): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  sadd(key: string, ...members: string[]): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Store — the internal unified Redis adapter shape
// ---------------------------------------------------------------------------

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(keys: string[]): Promise<void>;
  /** Associate cache keys with a tag for bulk invalidation */
  tag(tag: string, keys: string[]): Promise<void>;
  /** Return all cache keys associated with a tag */
  keysForTag(tag: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// cacheQuery options
// ---------------------------------------------------------------------------

export interface CacheQueryOptions<TArgs> {
  /**
   * Derives the Redis key from the query arguments.
   * Example: `(id) => \`user:${id}\``
   */
  key: (args: TArgs) => string;

  /**
   * Time-to-live in seconds. Defaults to 60.
   */
  ttl?: number;

  /**
   * Tags associated with this cache entry, used for bulk invalidation.
   * Example: `(id) => [\`user:${id}\`, "users"]`
   */
  tags?: (args: TArgs) => string[];

  /**
   * Enable verbose debug logging. Defaults to false.
   */
  debug?: boolean;
}

// ---------------------------------------------------------------------------
// withInvalidation options
// ---------------------------------------------------------------------------

export interface WithInvalidationOptions {
  /**
   * Enable verbose debug logging. Defaults to false.
   */
  debug?: boolean;
}

// ---------------------------------------------------------------------------
// Custom error types
// ---------------------------------------------------------------------------

/**
 * Base error class for all icacheyou errors.
 */
export class IcacheyouError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "IcacheyouError";
    // Maintain proper prototype chain in transpiled environments
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a cache read/write operation fails unexpectedly.
 * The system should still fall through to the database.
 */
export class CacheError extends IcacheyouError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "CacheError";
  }
}

/**
 * Thrown when the Redis client raises an error during a command.
 */
export class RedisError extends IcacheyouError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "RedisError";
  }
}

/**
 * Thrown when the underlying query or mutation function fails.
 * This error always propagates — DB failures are not swallowed.
 */
export class DBError extends IcacheyouError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "DBError";
  }
}
