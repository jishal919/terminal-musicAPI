/**
 * services/scoringService.js
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SCORING PIPELINE
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  raw candidates
 *       │
 *       ▼
 *  [1] NORMALISE  — strip noise, lowercase, remove brackets
 *       │
 *       ▼
 *  [2] SCORE      — compute weighted confidence for each candidate
 *       │           ├─ title similarity   (Levenshtein + Jaccard)  [40%]
 *       │           ├─ artist match       (Levenshtein + Jaccard)  [30%]
 *       │           ├─ keyword overlap    (exact token hits)       [15%]
 *       │           ├─ duration proximity (if both available)      [10%]
 *       │           └─ popularity signal  (play count / position)  [5%]
 *       │
 *       ▼
 *  [3] FILTER     — drop anything below MIN_CONFIDENCE_SCORE
 *       │
 *       ▼
 *  [4] DEDUPLICATE — remove near-identical results (same id or title≥95%)
 *       │
 *       ▼
 *  [5] RANK        — sort descending by confidence
 *       │
 *       ▼
 *  scored, ranked, deduplicated list  ✓
 */

const { bestMatch, tokenSimilarity } = require('../utils/fuzzy');
const { normalize, splitQueryHeuristic, tokenSet } = require('../utils/normalizer');

const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE_SCORE || '0.35');

// ── Weight constants (must sum to 1.0) ─────────────────────────────────────
const W = {
  TITLE:      0.40,
  ARTIST:     0.30,
  KEYWORD:    0.15,
  DURATION:   0.10,
  POPULARITY: 0.05,
};

// ── Individual scorers ──────────────────────────────────────────────────────

/**
 * Title similarity score.
 * Uses best-of(Levenshtein similarity, Jaccard token similarity).
 *
 * @param {string} queryTitle   normalised query title
 * @param {string} resultTitle  normalised result title
 * @returns {number} [0, 1]
 */
function scoreTitleMatch(queryTitle, resultTitle) {
  if (!queryTitle) return 0.5; // no title in query → neutral
  return bestMatch(queryTitle, resultTitle);
}

/**
 * Artist match score.
 * If no artist in query → 0.5 (neutral, not penalised).
 * Uses token similarity to handle "Drake" matching "Drake feat. Future".
 *
 * @param {string} queryArtist
 * @param {string} resultArtist
 * @returns {number} [0, 1]
 */
function scoreArtistMatch(queryArtist, resultArtist) {
  if (!queryArtist) return 0.5;
  if (!resultArtist) return 0;
  return bestMatch(queryArtist, resultArtist);
}

/**
 * Keyword overlap score.
 * Measures what fraction of the raw query tokens appear in the result title.
 * Rewards exact keyword hits regardless of ordering.
 *
 * @param {string} rawQuery        full original query (normalised)
 * @param {string} resultTitle     normalised result title
 * @param {string} resultArtist    normalised result artist
 * @returns {number} [0, 1]
 */
function scoreKeywordOverlap(rawQuery, resultTitle, resultArtist) {
  const qTokens   = tokenSet(rawQuery);
  const rText     = `${resultTitle} ${resultArtist}`;
  const rTokens   = tokenSet(rText);

  if (qTokens.size === 0) return 0.5;

  let hits = 0;
  for (const tok of qTokens) {
    if (rTokens.has(tok)) hits++;
  }
  return hits / qTokens.size;
}

/**
 * Duration proximity score.
 * Full marks if within ±5 seconds, degrades linearly to 0 at ±60 seconds.
 *
 * @param {number|null} queryDurationSec   expected duration (seconds) or null
 * @param {number|null} resultDurationSec  result duration (seconds) or null
 * @returns {number} [0, 1]
 */
function scoreDurationProximity(queryDurationSec, resultDurationSec) {
  if (queryDurationSec == null || resultDurationSec == null) return 0.5;
  const diff = Math.abs(queryDurationSec - resultDurationSec);
  if (diff <= 5)  return 1.0;
  if (diff >= 60) return 0.0;
  return 1 - (diff - 5) / 55;
}

/**
 * Popularity heuristic score.
 * Uses the result's position index in the API response (lower index = more popular).
 * Position 0 → 1.0, position 9 → ~0.1.
 *
 * @param {number} positionIndex   0-based index in original API results
 * @param {number} totalResults    total number of candidates
 * @returns {number} [0, 1]
 */
function scorePopularity(positionIndex, totalResults) {
  if (totalResults <= 1) return 1;
  // Exponential decay: earlier positions score much higher
  return Math.exp(-positionIndex * 0.3);
}

// ── Main pipeline ───────────────────────────────────────────────────────────

/**
 * Score a single candidate against the user's query.
 *
 * @param {object} candidate         raw result from saavnService
 * @param {string} rawQuery          original user query
 * @param {number} positionIndex     0-based index in API results
 * @param {number} totalResults      total candidates count
 * @param {number|null} queryDuration  optional expected duration in seconds
 * @returns {object}  candidate enriched with `_score` and `_scoreBreakdown`
 */
function scoreCandidate(candidate, rawQuery, positionIndex, totalResults, queryDuration = null) {
  const { title: queryTitle, artist: queryArtist } = splitQueryHeuristic(rawQuery);
  const normQuery  = normalize(rawQuery);

  const normTitle  = normalize(candidate.title  || '');
  const normArtist = normalize(candidate.artist || '');

  const titleScore      = scoreTitleMatch(queryTitle, normTitle);
  const artistScore     = scoreArtistMatch(queryArtist, normArtist);
  const keywordScore    = scoreKeywordOverlap(normQuery, normTitle, normArtist);
  const durationScore   = scoreDurationProximity(queryDuration, candidate.durationSec || null);
  const popularityScore = scorePopularity(positionIndex, totalResults);

  const confidence =
    W.TITLE      * titleScore      +
    W.ARTIST     * artistScore     +
    W.KEYWORD    * keywordScore    +
    W.DURATION   * durationScore   +
    W.POPULARITY * popularityScore;

  const breakdown = {
    title:      +titleScore.toFixed(3),
    artist:     +artistScore.toFixed(3),
    keyword:    +keywordScore.toFixed(3),
    duration:   +durationScore.toFixed(3),
    popularity: +popularityScore.toFixed(3),
  };

  // Debug log — extremely useful when tuning weights
  console.debug(
    `[score] "${candidate.title}" by "${candidate.artist}" → ${confidence.toFixed(3)}`,
    breakdown
  );

  return {
    ...candidate,
    _confidence: +confidence.toFixed(4),
    _scoreBreakdown: breakdown,
  };
}

/**
 * Full pipeline: score all candidates, filter, deduplicate, rank.
 *
 * @param {object[]} candidates     raw results from saavnService
 * @param {string}   rawQuery       original user query
 * @param {object}   options
 * @param {number}   [options.minScore]       override MIN_CONFIDENCE
 * @param {number|null} [options.queryDuration]  expected duration in seconds
 * @returns {object[]}  scored + filtered + ranked results (public fields only)
 */
function rankCandidates(candidates, rawQuery, options = {}) {
  const minScore    = options.minScore ?? MIN_CONFIDENCE;
  const queryDur    = options.queryDuration ?? null;
  const total       = candidates.length;

  // ── 1. Score all ──────────────────────────────────────────────────────────
  const scored = candidates.map((c, idx) =>
    scoreCandidate(c, rawQuery, idx, total, queryDur)
  );

  // ── 2. Filter low-confidence ──────────────────────────────────────────────
  const filtered = scored.filter(c => c._confidence >= minScore);

  if (filtered.length === 0) {
    console.warn(`[score] All ${total} candidates scored below minScore=${minScore}`);
  }

  // ── 3. Deduplicate ────────────────────────────────────────────────────────
  const seen = new Set();
  const deduped = filtered.filter(c => {
    const key = `${normalize(c.title)}_${normalize(c.artist)}`;
    if (seen.has(key) || seen.has(c.id)) return false;
    seen.add(key);
    seen.add(c.id);
    return true;
  });

  // ── 4. Sort descending ────────────────────────────────────────────────────
  deduped.sort((a, b) => b._confidence - a._confidence);

  return deduped;
}

module.exports = { rankCandidates, scoreCandidate, MIN_CONFIDENCE };
