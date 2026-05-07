/**
 * controllers/searchController.js
 *
 * GET /api/search?query=<string>&limit=<number>&minScore=<0-1>&duration=<seconds>
 *
 * Orchestrates:
 *   providerRegistry (Parallel Fetch) → scoringService.rankCandidates → response
 */

const PROVIDERS = require('../services/providers');
const { rankCandidates, MIN_CONFIDENCE } = require('../services/scoringService');
const cache = require('../utils/cache');

// Result limits to prevent serverless execution overhead
const MAX_SAAVN   = 40;
const MAX_ARCHIVE = 25;

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

    // ── Cache key includes query and base candidate pool ────────────────────
    const cacheKey = `search:${query.trim().toLowerCase()}`;

    let actualFetched = 0;
    const results = await cache.search.memoize(cacheKey, async () => {
      // Parallel fetch from all registered providers
      const providerKeys = Object.keys(PROVIDERS);
      
      const settlements = await Promise.allSettled(
        providerKeys.map(key => {
          const limit = key === 'saavn' ? MAX_SAAVN : MAX_ARCHIVE;
          return PROVIDERS[key].search(query.trim(), limit);
        })
      );

      const combinedCandidates = [];
      const stats = {};

      settlements.forEach((s, i) => {
        const key = providerKeys[i];
        if (s.status === 'rejected') {
          console.error(`[search] Provider "${key}" failed:`, s.reason.message);
        }
        const candidates = s.status === 'fulfilled' ? s.value : [];
        stats[key] = candidates.length;
        combinedCandidates.push(...candidates);
      });

      actualFetched = combinedCandidates.length;
      console.log(`[search] Aggregated ${actualFetched} candidates`, stats);

      if (combinedCandidates.length === 0) return [];

      return rankCandidates(combinedCandidates, query.trim(), {
        minScore:      parsedMinScore,
        queryDuration: parsedDuration,
        sourceBiases:  { saavn: 0.03 } // Saavn metadata is slightly more reliable
      });
    });

    // Re-apply limit and minScore after cache (user may vary these per request)
    const filtered = results
      .filter(r => r._confidence >= parsedMinScore)
      .slice(0, parsedLimit);

    // ── Build public response (strip internal fields from output) ────────────
    const tracks = filtered.map(formatTrackForResponse);

    const isCached = cache.search.get(cacheKey) !== undefined;

    return res.json({
      success: true,
      query,
      count:   tracks.length,
      tracks,
      meta: {
        minScoreApplied: parsedMinScore,
        candidatesFetched: actualFetched || (isCached ? results.length : 0),
        cached: isCached,
        sources: Object.keys(PROVIDERS)
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
    source:         track.source,
    confidence:     track._confidence,
    scoreBreakdown: track._scoreBreakdown,
  };
}

module.exports = { search };
