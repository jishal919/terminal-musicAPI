/**
 * services/scoringService.js
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SCORING PIPELINE (Refined)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  raw candidates
 *       │
 *       ▼
 *  [1] NORMALISE  — strip noise, lowercase, generate internal fields
 *       │
 *       ▼
 *  [2] SCORE      — compute weighted confidence for each candidate
 *       │
 *       ▼
 *  [3] BIAS       — apply source-specific confidence adjustments
 *       │
 *       ▼
 *  [4] FILTER     — drop anything below MIN_CONFIDENCE_SCORE
 *       │
 *       ▼
 *  [5] RANK        — sort descending by confidence
 *       │
 *       ▼
 *  [6] DEDUPLICATE — remove near-identical results using normalized metadata
 *       │
 *       ▼
 *  scored, ranked, deduplicated list  ✓
 */

const { bestMatch } = require('../utils/fuzzy');
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

function scoreTitleMatch(queryTitle, resultTitle) {
  if (!queryTitle) return 0.5;
  return bestMatch(queryTitle, resultTitle);
}

function scoreArtistMatch(queryArtist, resultArtist) {
  if (!queryArtist) return 0.5;
  if (!resultArtist) return 0;
  return bestMatch(queryArtist, resultArtist);
}

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

function scoreDurationProximity(queryDurationSec, resultDurationSec) {
  if (queryDurationSec == null || resultDurationSec == null) return 0.5;
  const diff = Math.abs(queryDurationSec - resultDurationSec);
  if (diff <= 5)  return 1.0;
  if (diff >= 60) return 0.0;
  return 1 - (diff - 5) / 55;
}

function scorePopularity(positionIndex, totalResults) {
  if (totalResults <= 1) return 1;
  return Math.exp(-positionIndex * 0.3);
}

// ── Main pipeline ───────────────────────────────────────────────────────────

/**
 * Score a single candidate against the user's query.
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

  return {
    ...candidate,
    _normalizedTitle: normTitle,
    _normalizedArtist: normArtist,
    _confidence: +confidence.toFixed(4),
    _scoreBreakdown: breakdown,
  };
}

/**
 * Full pipeline: score, bias, filter, rank, deduplicate.
 */
function rankCandidates(candidates, rawQuery, options = {}) {
  const minScore     = options.minScore ?? MIN_CONFIDENCE;
  const queryDur     = options.queryDuration ?? null;
  const sourceBiases = options.sourceBiases ?? {};
  const total        = candidates.length;

  // 1. Score all
  let scored = candidates.map((c, idx) =>
    scoreCandidate(c, rawQuery, idx, total, queryDur)
  );

  // 2. Apply source bias (Safe adjustment after fuzzy scoring)
  scored = scored.map(c => {
    const bias = sourceBiases[c.source] || 0;
    if (bias !== 0) {
      c._confidence = Math.min(1.0, +(c._confidence + bias).toFixed(4));
    }
    return c;
  });

  // 3. Filter low-confidence
  const filtered = scored.filter(c => c._confidence >= minScore);

  if (filtered.length === 0) {
    console.warn(`[score] All ${total} candidates scored below minScore=${minScore}`);
  }

  // 4. Sort descending (highest score wins competition)
  filtered.sort((a, b) => b._confidence - a._confidence);

  // 5. Deduplicate using internal normalized fields
  const seen = new Set();
  const deduped = filtered.filter(c => {
    const key = `${c._normalizedTitle}_${c._normalizedArtist}`;
    if (seen.has(key) || seen.has(c.id)) return false;
    seen.add(key);
    seen.add(c.id);
    return true;
  });

  return deduped;
}

module.exports = { rankCandidates, scoreCandidate, MIN_CONFIDENCE };
