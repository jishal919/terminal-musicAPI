/**
 * controllers/metadataController.js
 *
 * GET /api/metadata?id=<saavn_id>
 *
 * Returns rich metadata for a song — album, release date, cover art, etc.
 * Response is cached aggressively (1 hour default) since metadata rarely changes.
 */

const saavnService = require('../services/saavnService');
const cache        = require('../utils/cache');

async function metadata(req, res, next) {
  try {
    const { id } = req.query;

    if (!id || !id.trim()) {
      return res.status(400).json({ success: false, error: 'Missing `id` parameter' });
    }

    const cacheKey = `meta:${id.trim()}`;

    const data = await cache.metadata.memoize(cacheKey, async () => {
      const song = await saavnService.getSong(id.trim());
      return song || null;
    });

    if (!data) {
      return res.status(404).json({ success: false, error: 'Song not found' });
    }

    return res.json({
      success: true,
      metadata: {
        id:          data.id,
        title:       data.title,
        artist:      data.artist,
        album:       data.album,
        coverImage:  data.coverHQ || data.thumbnail,
        duration:    data.duration,
        durationSec: data.durationSec,
        releaseDate: data.releaseDate,
        year:        data.year,
        language:    data.language,
        label:       data.label,
        hasLyrics:   data.hasLyrics,
        playCount:   data.playCount,
        copyright:   data.copyright,
      },
    });

  } catch (err) {
    next(err);
  }
}

module.exports = { metadata };
