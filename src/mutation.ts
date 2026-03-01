/**
 * @file mutation.ts
 * Mutation wrapper — withInvalidation runs a write operation and then
 * automatically invalidates all cache keys associated with the given tags.
 *
 * Failure contract:
 * - Mutation errors  → always propagate as DBError (never swallowed)
 * - Redis errors     → logged as warnings, mutation result still returned
 */

import { DBError } from "./types.js";
import type { CacheStore, WithInvalidationOptions } from "./types.js";

// ---------------------------------------------------------------------------
// Logging helpers (minimal, kept local to avoid cross-module coupling)
// ---------------------------------------------------------------------------

function warn(debug: boolean, message: string, detail?: unknown): void {
  if (debug) {
    console.warn(`[icacheyou] ⚠️  ${message}`, detail ?? "");
  } else {
    console.warn(`[icacheyou] ${message}`);
  }
}

function log(debug: boolean, message: string, detail?: unknown): void {
  if (debug) {
    console.log(`[icacheyou] 🗑️  ${message}`, detail ?? "");
  }
}

// ---------------------------------------------------------------------------
// withInvalidation
// ---------------------------------------------------------------------------

/**
 * Wraps a mutation function (INSERT / UPDATE / DELETE) and automatically
 * invalidates all cache keys bound to the provided tags after the mutation
 * completes successfully.
 *
 * The invalidation:
 * 1. Resolves all cache keys registered under each tag (via SMEMBERS)
 * 2. Deletes those keys from Redis (via DEL)
 * 3. Removes the tag metadata keys themselves
 *
 * @param store       - CacheStore instance (from redisStore())
 * @param mutationFn  - Async function that performs the write (e.g. Drizzle update)
 * @param args        - Arguments passed to mutationFn
 * @param getTags     - Function that derives tags to invalidate from the args
 * @param options     - Debug flag
 * @returns           - The resolved mutation result
 *
 * @example
 * await withInvalidation(
 *   store,
 *   ({ id, name }) => db.update(users).set({ name }).where(eq(users.id, id)),
 *   { id: 1, name: "Alice" },
 *   (args) => [`user:${args.id}`, "users"],
 * );
 */
export async function withInvalidation<TArgs, TResult>(
  store: CacheStore,
  mutationFn: (args: TArgs) => Promise<TResult>,
  args: TArgs,
  getTags: (args: TArgs) => string[],
  options: WithInvalidationOptions = {},
): Promise<TResult> {
  const { debug = false } = options;

  // ------------------------------------------------------------------
  // 1. Run the mutation — errors always propagate
  // ------------------------------------------------------------------
  let result: TResult;

  try {
    result = await mutationFn(args);
  } catch (err) {
    throw new DBError("Mutation function failed during withInvalidation", err);
  }

  // ------------------------------------------------------------------
  // 2. Invalidate cache tags (best-effort — never breaks the response)
  // ------------------------------------------------------------------
  const tags = getTags(args);

  if (tags.length === 0) {
    log(debug, "No tags provided — skipping invalidation.");
    return result;
  }

  try {
    // Collect all cache keys across all tags
    const keysByTag = await Promise.all(
      tags.map((tag) => store.keysForTag(tag)),
    );

    // Flatten and deduplicate
    const allKeys = [...new Set(keysByTag.flat())];

    if (allKeys.length === 0) {
      log(debug, `Tags [${tags.join(", ")}] had no registered cache keys.`);
      return result;
    }

    log(
      debug,
      `Invalidating ${allKeys.length} key(s) for tags [${tags.join(", ")}]: ${allKeys.join(", ")}`,
    );

    // Delete the actual cached values
    await store.del(allKeys);

    // Also clean up the tag metadata keys
    const tagMetaKeys = tags.map((t) => `icacheyou:tag:${t}`);
    await store.del(tagMetaKeys);

    log(debug, `Invalidation complete for tags: [${tags.join(", ")}]`);
  } catch (err) {
    // Cache invalidation failure is non-fatal — the mutation already succeeded
    warn(
      debug,
      `Cache invalidation failed for tags [${tags.join(", ")}]. Cache may be stale.`,
      err,
    );
  }

  return result;
}
