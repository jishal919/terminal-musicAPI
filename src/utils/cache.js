/**
 * utils/cache.js
 *
 * Thin wrapper around node-cache that provides typed helpers
 * for the two TTL tiers used by this API:
 *
 *  - SEARCH  : shorter TTL (default 5 min) — results can drift quickly
 *  - METADATA: longer  TTL (default 1 hr)  — song details rarely change
 */

const NodeCache = require('node-cache');

const SEARCH_TTL   = parseInt(process.env.CACHE_TTL_SEARCH   || '300',  10);
const METADATA_TTL = parseInt(process.env.CACHE_TTL_METADATA || '3600', 10);

const searchCache   = new NodeCache({ stdTTL: SEARCH_TTL,   checkperiod: 60 });
const metadataCache = new NodeCache({ stdTTL: METADATA_TTL, checkperiod: 120 });

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Memoised fetch: returns cached value if present,
 * otherwise calls `fetchFn`, stores result, and returns it.
 *
 * @template T
 * @param {NodeCache} cache
 * @param {string}    key
 * @param {() => Promise<T>} fetchFn
 * @returns {Promise<T>}
 */
async function memoize(cache, key, fetchFn) {
  const hit = cache.get(key);
  if (hit !== undefined) {
    console.debug(`[cache] HIT  ${key}`);
    return hit;
  }
  console.debug(`[cache] MISS ${key}`);
  const value = await fetchFn();
  
  // Only cache if the value is not null, undefined, AND not an empty array
  const isEmptyArray = Array.isArray(value) && value.length === 0;
  if (value !== null && value !== undefined && !isEmptyArray) {
    cache.set(key, value);
  }
  return value;
}

module.exports = {
  search: {
    get: (key)         => searchCache.get(key),
    set: (key, value)  => searchCache.set(key, value),
    del: (key)         => searchCache.del(key),
    memoize: (key, fn) => memoize(searchCache, key, fn),
  },
  metadata: {
    get: (key)         => metadataCache.get(key),
    set: (key, value)  => metadataCache.set(key, value),
    del: (key)         => metadataCache.del(key),
    memoize: (key, fn) => memoize(metadataCache, key, fn),
  },
};
