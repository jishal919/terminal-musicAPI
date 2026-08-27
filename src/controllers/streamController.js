/**
 * controllers/streamController.js
 *
 * GET /api/stream?id=<id>&source=<saavn|archive>
 *
 * Orchestrates stream resolution via the Provider Registry.
 * Returns direct CDN URLs optimized for low-latency playback.
 */

const PROVIDERS = require('../services/providers');
const cache     = require('../utils/cache');

async function stream(req, res, next) {
  try {
    const { id, source } = req.query;

    // ── 1. Input Validation & Defaults ──────────────────────────────────────
    if (!id || !id.trim()) {
      return res.status(400).json({ success: false, error: 'Missing `id` parameter' });
    }

    const trimmedId = id.trim();
    const hintedSource = source ? source.toLowerCase() : null;

    if (hintedSource && !PROVIDERS[hintedSource]) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid \`source\`. Supported: ${Object.keys(PROVIDERS).join(', ')}` 
      });
    }

    // Try the hinted provider first (if given), then cascade through every
    // other registered provider. This is deliberate: /api/search aggregates
    // tracks from several providers (saavn/archive/youtube), and a track's
    // `id` only means anything to the provider that issued it. Previously
    // this endpoint silently defaulted to 'saavn' whenever `source` was
    // omitted, so any non-Saavn track (i.e. most of the international
    // catalog) would 404 on playback even though search had found it fine.
    const providerOrder = hintedSource
      ? [hintedSource, ...Object.keys(PROVIDERS).filter(k => k !== hintedSource)]
      : Object.keys(PROVIDERS);

    const cacheKey = `stream:${hintedSource || 'any'}:${trimmedId}`;

    // ── 2. Resolve via Provider Registry (cascading fallback) ───────────────
    const data = await cache.metadata.memoize(cacheKey, async () => {
      for (const key of providerOrder) {
        try {
          const result = await PROVIDERS[key].getStream(trimmedId);
          if (result) {
            return {
              source:    result.source || key,
              streamUrl: result.streamUrl,
              quality:   result.quality,
              format:    result.format,
              expiresAt: result.expiresAt || null
            };
          }
        } catch (err) {
          console.error(`[stream] Provider "${key}" failed for id ${trimmedId}:`, err.message);
        }
      }
      return null;
    });

    if (!data) {
      return res.status(404).json({ 
        success: false, 
        error: 'Stream could not be resolved or song not found' 
      });
    }

    // ── 3. Stable Response Shape ────────────────────────────────────────────
    return res.json({ 
      success: true, 
      id: id.trim(),
      ...data 
    });

  } catch (err) {
    next(err);
  }
}

module.exports = { stream };
