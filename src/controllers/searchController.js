/**
 * controllers/searchController.js
 *
 * GET /api/search?query=<string>&limit=<number>&minScore=<0-1>&duration=<seconds>
 *
 * Orchestrates:
 *   saavnService.searchSongs  →  scoringService.rankCandidates  →  response
 */

const saavnService  = require('../services/saavnService');
const { rankCandidates, MIN_CONFIDENCE } = require('../services/scoringService');
const cache = require('../utils/cache');

const MAX_CANDIDATES = parseInt(process.env.MAX_SEARCH_CANDIDATES || '10', 10);

async function search(req, res, next) {
  try {
    const { query, limit, minScore, duration } = req.query;

    // ── Input validation ────────────────────────────────────────────────────
    if (!query || query.trim().length < 1) {
      return res.status(400).json({
        success: false,
        error:   'Missing or empty `query` parameter',
      });
    }

    const parsedLimit    = Math.min(parseInt(limit    || '5', 10), 20);
    const parsedMinScore = parseFloat(minScore || MIN_CONFIDENCE);
    const parsedDuration = duration ? parseFloat(duration) : null;

    if (isNaN(parsedMinScore) || parsedMinScore < 0 || parsedMinScore > 1) {
      return res.status(400).json({
        success: false,
        error:   '`minScore` must be a number between 0 and 1',
      });
    }

    // ── Cache key includes all search-affecting params ───────────────────────
    const cacheKey = `search:${query.trim().toLowerCase()}:${MAX_CANDIDATES}`;

    const results = await cache.search.memoize(cacheKey, async () => {
      // Fetch more candidates than we'll return — the scorer needs room to work
      const candidates = await saavnService.searchSongs(query.trim(), MAX_CANDIDATES);

      if (candidates.length === 0) return [];

      return rankCandidates(candidates, query.trim(), {
        minScore:      parsedMinScore,
        queryDuration: parsedDuration,
      });
    });

    // Re-apply limit and minScore after cache (user may vary these per request)
    const filtered = results
      .filter(r => r._confidence >= parsedMinScore)
      .slice(0, parsedLimit);

    // ── Build public response (strip internal fields from output) ────────────
    const tracks = filtered.map(formatTrackForResponse);

    return res.json({
      success: true,
      query,
      count:   tracks.length,
      tracks,
      meta: {
        minScoreApplied: parsedMinScore,
        candidatesFetched: MAX_CANDIDATES,
        cached: cache.search.get(cacheKey) !== undefined,
      },
    });

  } catch (err) {
    next(err);
  }
}

/**
 * Strip internal scoring fields; keep only public-facing data.
 */
function formatTrackForResponse(track) {
  return {
    id:             track.id,
    title:          track.title,
    artist:         track.artist,
    album:          track.album,
    duration:       track.duration,
    durationSec:    track.durationSec,
    thumbnail:      track.thumbnail,
    language:       track.language,
    year:           track.year,
    confidence:     track._confidence,
    scoreBreakdown: track._scoreBreakdown,
  };
}

module.exports = { search };
