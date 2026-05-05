/**
 * controllers/streamController.js
 *
 * GET /api/stream?id=<saavn_id>
 *
 * Returns the best available audio stream URL for a given song ID.
 * The URL comes directly from Saavn's CDN — we don't proxy the audio bytes.
 *
 * Quality preference order (highest first):
 *   320kbps → 160kbps → 96kbps → 48kbps → 12kbps
 */

const saavnService = require('../services/saavnService');
const cache        = require('../utils/cache');

// Quality ladder — index 0 is preferred
const QUALITY_LADDER = ['320kbps', '160kbps', '96kbps', '48kbps', '12kbps'];

async function stream(req, res, next) {
  try {
    const { id } = req.query;

    if (!id || !id.trim()) {
      return res.status(400).json({ success: false, error: 'Missing `id` parameter' });
    }

    const cacheKey = `stream:${id.trim()}`;

    const data = await cache.metadata.memoize(cacheKey, async () => {
      const song = await saavnService.getSong(id.trim());

      if (!song) {
        return null; // will be caught below
      }

      const { downloadUrls } = song;
      if (!downloadUrls || downloadUrls.length === 0) {
        throw Object.assign(new Error('No stream URLs available for this track'), {
          statusCode: 404,
        });
      }

      // Pick best quality available from the ladder
      let bestUrl   = null;
      let bestQuality = null;

      for (const preferred of QUALITY_LADDER) {
        const match = downloadUrls.find(u =>
          u.quality?.toLowerCase() === preferred.toLowerCase()
        );
        if (match?.url) {
          bestUrl     = match.url;
          bestQuality = match.quality;
          break;
        }
      }

      // Fallback: just take the last item (Saavn puts best last)
      if (!bestUrl) {
        const last = downloadUrls[downloadUrls.length - 1];
        bestUrl     = last?.url;
        bestQuality = last?.quality;
      }

      if (!bestUrl) {
        throw Object.assign(new Error('Stream URL could not be resolved'), {
          statusCode: 502,
        });
      }

      return {
        id:          song.id,
        title:       song.title,
        artist:      song.artist,
        streamUrl:   bestUrl,
        quality:     bestQuality,
        allQualities: downloadUrls.map(u => ({ quality: u.quality, url: u.url })),
      };
    });

    if (!data) {
      return res.status(404).json({ success: false, error: 'Song not found' });
    }

    return res.json({ success: true, ...data });

  } catch (err) {
    next(err);
  }
}

module.exports = { stream };
