/**
 * @file key.ts
 * Deterministic, stable cache key generation.
 *
 * Keys are constructed by combining a prefix with a JSON-serialized,
 * sorted representation of the arguments — ensuring deep-equal objects
 * always produce identical keys regardless of property insertion order.
 */

/**
 * Creates a stable, deterministic cache key from a prefix and arguments.
 *
 * @param prefix - Namespace prefix (e.g. "user", "product:list")
 * @param args   - Any serializable arguments that uniquely identify the query
 * @returns      A string key safe to use in Redis
 *
 * @example
 * stableKey("user", { id: 1 })         // → "user:{"id":1}"
 * stableKey("user", { role: "admin", id: 1 }) // → same as { id: 1, role: "admin" }
 */
export function stableKey(prefix: string, args?: unknown): string {
  if (args === undefined || args === null) {
    return prefix;
  }

  const serialized = JSON.stringify(sortDeep(args));
  return `${prefix}:${serialized}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively sorts object keys so that `{ b: 1, a: 2 }` and `{ a: 2, b: 1 }`
 * produce the same JSON string.
 */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }

  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      sorted[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  return value;
}
