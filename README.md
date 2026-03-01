# icacheyou

Redis caching layer for Drizzle ORM queries. Type-safe, tag-based invalidation, fail-graceful.

> **Bun only.** This package uses Bun's built-in `RedisClient` and `Bun.env`.
> Requires Bun v1.1 or later.

---

## Requirements

- [Bun](https://bun.sh) v1.1+
- A running Redis instance

---

## Installation

```bash
bun add icacheyou
```

---

## Quick Start

```ts
// lib/icacheyou.ts
import icacheyou from "icacheyou";

export const cache = icacheyou.create(Bun.env.REDIS_URL!);
```

```ts
import { cache } from "@/lib/icacheyou";

// Read with caching
const user = await cache.query(
  (id) => db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, id) }),
  userId,
  {
    key: (id) => cache.key("user", { id }),
    ttl: 120,
    tags: (id) => [`user:${id}`, "users"],
  },
);

// Mutation + cache invalidation
await cache.mutate(
  ({ id, name }) => db.update(users).set({ name }).where(eq(users.id, id)),
  { id: userId, name: "Alice" },
  (args) => [`user:${args.id}`, "users"],
);

// Direct Redis access
await cache.redis.set("key", "value", "EX", 60);
await cache.redis.incr("counter");
await cache.redis.hset("hash", { field: "value" });
```

---

## API

### `icacheyou.create(redisUrl)`

Creates a fully-wired client from a Redis URL. Returns `{ query, mutate, key, redis }`.

```ts
const cache = icacheyou.create("redis://localhost:6379");
```

---

### `cache.query(queryFn, args, options)`

Wraps a read function with Redis caching.

| Option  | Type                 | Default | Description                      |
| ------- | -------------------- | ------- | -------------------------------- |
| `key`   | `(args) => string`   | —       | Derives the Redis key from args  |
| `ttl`   | `number`             | `60`    | Time-to-live in seconds          |
| `tags`  | `(args) => string[]` | —       | Tags used for bulk invalidation  |
| `debug` | `boolean`            | `false` | Logs HIT / MISS / SET to console |

Behavior:

- Cache hit — deserialize and return immediately
- Cache miss — call `queryFn`, store result, return
- Redis failure — falls through to `queryFn`, warns to console
- `queryFn` failure — throws `DBError` (always propagates)

---

### `cache.mutate(mutationFn, args, getTags, options?)`

Wraps a write function and invalidates all cache keys bound to the provided tags.

Behavior:

- Mutation failure — throws `DBError` (nothing is invalidated)
- Mutation success — resolves all tagged keys, deletes them from Redis
- Invalidation failure — warns to console, mutation result still returned

---

### `cache.key(prefix, args?)`

Builds a deterministic Redis key. Object keys are deep-sorted so argument order never matters.

```ts
cache.key("user", { id: 1 }); // → "user:{"id":1}"
cache.key("product", { page: 1, cat: "shoes" }); // stable regardless of arg order
```

---

### `cache.redis`

Direct access to the underlying Bun `RedisClient`. Full command surface available.

```ts
cache.redis.get(key);
cache.redis.set(key, value, "EX", ttl);
cache.redis.del(key);
cache.redis.expire(key, seconds);
cache.redis.ttl(key);
cache.redis.incr(key);
cache.redis.sadd(key, ...members);
cache.redis.smembers(key);
cache.redis.hset(key, fields);
cache.redis.hget(key, field);
cache.redis.hgetall(key);
cache.redis.lpush(key, ...values);
cache.redis.rpop(key);
cache.redis.lrange(key, start, stop);
cache.redis.zadd(key, score, member);
cache.redis.zrange(key, start, stop);
cache.redis.exists(key);
cache.redis.publish(channel, message);
```

---

## Error Types

```ts
import { DBError, RedisError, CacheError } from "icacheyou";

try {
  await cache.query(...);
} catch (err) {
  if (err instanceof DBError)    { /* database failure — always thrown  */ }
  if (err instanceof RedisError)  { /* handled internally — rarely surfaces */ }
  if (err instanceof CacheError)  { /* handled internally — rarely surfaces */ }
}
```

---

## Advanced — Bring Your Own Redis Client

```ts
import { cacheQuery, withInvalidation, redisStore } from "icacheyou";

const store = redisStore(myRedisClient); // any client matching RedisClient interface

const user = await cacheQuery(store, getUserById, id, {
  key: (id) => `user:${id}`,
  ttl: 120,
  tags: (id) => [`user:${id}`],
});

await withInvalidation(store, updateUser, { id, name }, (a) => [
  `user:${a.id}`,
]);
```

The `RedisClient` interface requires: `get`, `set`, `del`, `sadd`, `smembers`.

---

## Package Structure

```
src/
  createClient.ts   factory + ICacheYouClient
  cache.ts          cacheQuery core logic
  mutation.ts       withInvalidation logic
  redisStore.ts     generic Redis adapter
  key.ts            stableKey helper
  types.ts          types + error classes
  index.ts          exports
examples/
  usage.ts
```

---

## License

MIT License
