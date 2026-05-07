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

    // Backward compatibility: default to 'saavn' if source is missing
    const resolvedSource = (source || 'saavn').toLowerCase();

    if (!PROVIDERS[resolvedSource]) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid \`source\`. Supported: ${Object.keys(PROVIDERS).join(', ')}` 
      });
    }

    const cacheKey = `stream:${resolvedSource}:${id.trim()}`;

    // ── 2. Resolve via Provider Registry ────────────────────────────────────
    const data = await cache.metadata.memoize(cacheKey, async () => {
      const provider = PROVIDERS[resolvedSource];
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
