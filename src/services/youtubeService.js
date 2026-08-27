/**
 * services/youtubeService.js
 *
 * Adapts the YouTube Music (search) + Piped (stream) engine that already
 * lives in blackholeService.js to the standard provider contract:
 *
 *   search(query, limit) -> Promise<Track[]>
 *   getStream(id)        -> Promise<StreamResult|null>
 *
 * This is what actually gives the catalog its "every song, not just
 * Indian/JioSaavn" breadth — YouTube Music has almost everything.
 * It was previously only reachable via the separate /bh/* routes and
 * never took part in /api/search or /api/stream.
 */

const bh = require('./blackholeService');

/**
 * Map a blackholeService search result to our internal Track shape.
 */
function mapResult(song) {
  return {
    id:          song.videoId,
    title:       song.name || '',
    artist:      song.artist || 'Unknown Artist',
    album:       song.album || null,
    durationSec: song.duration || null,
    duration:    song.duration ? formatDuration(song.duration) : null,
    thumbnail:   song.thumbnail || null,
    language:    null,
    year:        song.year || null,
    hasLyrics:   false,
    source:      'youtube'
  };
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Search YouTube Music. Never throws — on any failure (client init
 * timeout, YT blocking the request, etc.) it resolves to [] so it
 * degrades cleanly inside Promise.allSettled alongside other providers.
 */
async function search(query, limit = 10) {
  try {
    const result = await bh.search(query, limit);
    const results = result?.results || [];
    return results.map(mapResult);
  } catch (err) {
    console.error('[youtube] Search failed:', err.message);
    return [];
  }
}

/**
 * Resolve a direct audio stream for a YouTube videoId via Piped.
 * Deliberately does NOT invoke blackholeService's internal
 * Saavn/Archive fallback chain here — those providers are already
 * tried independently by the caller (streamController cascades
 * across every registered provider), so retrying them here would
 * just duplicate work.
 */
async function getStream(id) {
  try {
    const streamData = await bh.resolveStreamFromPiped(id);
    if (!streamData) return null;

    return {
      streamUrl: streamData.audioUrl,
      source:    'youtube',
      quality:   streamData.quality,
      format:    streamData.format
    };
  } catch (err) {
    console.error('[youtube] Stream resolution failed:', err.message);
    return null;
  }
}

module.exports = { search, getStream };
