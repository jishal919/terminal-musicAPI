/**
 * utils/fuzzy.js
 *
 * Pure utility functions for string similarity.
 * No external dependencies — all algorithms implemented from scratch
 * so the module adds zero cold-start overhead in serverless environments.
 */

/**
 * Classic Levenshtein distance between two strings.
 * Uses single-array DP — O(n*m) time, O(min(n,m)) space.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  // Make `a` the shorter string for memory efficiency
  if (a.length > b.length) [a, b] = [b, a];

  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  let curr = new Array(a.length + 1);

  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        prev[i] + 1,       // deletion
        curr[i - 1] + 1,   // insertion
        prev[i - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[a.length];
}

/**
 * Normalised similarity in [0, 1] where 1 = identical.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

/**
 * Token-based Jaccard similarity.
 * Splits on whitespace, computes intersection / union of token sets.
 *
 * Handles "Drake - God's Plan" vs "God's Plan Drake" well
 * because order doesn't matter for Jaccard.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function tokenSimilarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  const tokA = new Set(a.split(/\s+/).filter(Boolean));
  const tokB = new Set(b.split(/\s+/).filter(Boolean));

  let intersect = 0;
  for (const t of tokA) if (tokB.has(t)) intersect++;

  const union = tokA.size + tokB.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

/**
 * Best-of combination: max(levenshtein similarity, token Jaccard).
 * Covers both character-level typos and word-order variance.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function bestMatch(a, b) {
  return Math.max(similarity(a, b), tokenSimilarity(a, b));
}

module.exports = { levenshtein, similarity, tokenSimilarity, bestMatch };
