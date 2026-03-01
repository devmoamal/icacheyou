/**
 * icacheyou — Usage Examples
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop-in caching for Drizzle ORM queries using Redis.
 * All patterns shown here map 1-to-1 to a real Bun + Hono + Drizzle project.
 */

import type { SQL } from "drizzle-orm";
import icacheyou, { DBError, CacheError, RedisError } from "icacheyou";

// ─── Types (replace with your own Drizzle schema + db instance) ───────────────

type User = { id: number; name: string; email: string };

type WhereCallback<TTable> = (
  table: TTable,
  operators: { eq: <T>(a: T, b: T) => SQL },
) => SQL;

declare const db: {
  query: {
    users: {
      findFirst: (q: {
        where: WhereCallback<{ id: number }>;
      }) => Promise<User | undefined>;
      findMany: () => Promise<User[]>;
    };
  };
  update: (table: object) => {
    set: (values: object) => { where: (cond: SQL) => Promise<void> };
  };
};
declare const users: { id: number };

// ─── 1. Create the client ─────────────────────────────────────────────────────

const cache = icacheyou.create(
  Bun.env["REDIS_URL"] ?? "redis://localhost:6379",
);

// ─── 2. cache.query — Cache a read ───────────────────────────────────────────

async function getUser(id: number): Promise<User | undefined> {
  return cache.query(
    (id) => db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, id) }),
    id,
    {
      key: (id) => cache.key("user", { id }),
      ttl: 120,
      tags: (id) => [`user:${id}`, "users"],
      debug: true,
    },
  );
}

async function getAllUsers(): Promise<User[]> {
  return cache.query(() => db.query.users.findMany(), undefined, {
    key: () => "users:all",
    ttl: 30,
    tags: () => ["users"],
  });
}

// ─── 3. cache.mutate — Write + auto-invalidate ────────────────────────────────

async function updateUser(id: number, name: string): Promise<void> {
  return cache.mutate(
    ({ id, name }) =>
      db
        .update(users)
        .set({ name })
        .where({ id } as unknown as SQL),
    { id, name },
    (args) => [`user:${args.id}`, "users"],
    { debug: true },
  );
}

// ─── 4. cache.redis — Raw Redis access ───────────────────────────────────────

async function redisExamples() {
  // Strings
  await cache.redis.set("hits", "0");
  await cache.redis.incr("hits");
  const hits = await cache.redis.get("hits");

  // Expiry
  await cache.redis.set("session:abc", "data", "EX", 3600);
  await cache.redis.expire("session:abc", 7200);
  const ttl = await cache.redis.ttl("session:abc");

  // Sets
  await cache.redis.sadd("online-users", "1", "2", "3");
  const online = await cache.redis.smembers("online-users");

  // Hashes
  await cache.redis.hset("user:1", { name: "Alice", role: "admin" });
  const name = await cache.redis.hget("user:1", "name");
  const all = await cache.redis.hgetall("user:1");

  // Lists
  await cache.redis.lpush("queue", "job-1", "job-2");
  const job = await cache.redis.rpop("queue");
  const all2 = await cache.redis.lrange("queue", 0, -1);

  // Sorted sets
  await cache.redis.zadd("leaderboard", 100, "alice", 200, "bob");
  const top = await cache.redis.zrange("leaderboard", 0, -1, "WITHSCORES");

  // Keys
  await cache.redis.del("hits");
  const exists = await cache.redis.exists("hits");

  // Pub/sub
  await cache.redis.publish(
    "events",
    JSON.stringify({ type: "user.updated", id: 1 }),
  );

  (void hits, ttl, online, name, all, job, all2, top, exists);
}

// ─── 5. cache.key — Deterministic key building ───────────────────────────────

const keyA = cache.key("product", { page: 1, category: "shoes" });
const keyB = cache.key("product", { category: "shoes", page: 1 });
console.assert(keyA === keyB); // ✅ always true

// ─── 6. Error handling ───────────────────────────────────────────────────────

async function safeGetUser(id: number) {
  try {
    return await getUser(id);
  } catch (err) {
    if (err instanceof DBError) {
      console.error("[DB]   ", err.message, err.cause);
      throw err;
    }
    if (err instanceof RedisError) {
      console.warn("[Redis]", err.message);
    }
    if (err instanceof CacheError) {
      console.warn("[Cache]", err.message);
    }
    throw err;
  }
}

void getUser;
void getAllUsers;
void updateUser;
void redisExamples;
void keyA;
void keyB;
void safeGetUser;
