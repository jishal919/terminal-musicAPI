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

    // ── 1. Strict Validation ────────────────────────────────────────────────
    if (!id || !id.trim()) {
      return res.status(400).json({ success: false, error: 'Missing `id` parameter' });
    }

    if (!source || !PROVIDERS[source]) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid or missing \`source\`. Supported: ${Object.keys(PROVIDERS).join(', ')}` 
      });
    }

    const cacheKey = `stream:${source}:${id.trim()}`;

    // ── 2. Resolve via Provider Registry ────────────────────────────────────
    // Using a shorter TTL for streams as CDN URLs can expire
    const data = await cache.metadata.memoize(cacheKey, async () => {
      const provider = PROVIDERS[source];
      const result = await provider.getStream(id.trim());
      
      if (!result) return null;

      return {
        source:    result.source,
        streamUrl: result.streamUrl,
        quality:   result.quality,
        format:    result.format,
        expiresAt: result.expiresAt || null
      };
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
