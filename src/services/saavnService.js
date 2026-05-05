/**
 * services/saavnService.js
 *
 * All communication with the JioSaavn public API lives here.
 * Controllers and the scoring service never touch fetch() directly.
 *
 * Base URL: https://saavn.sumit.co/api
 */

const fetch = require('node-fetch');

const BASE_URL = (process.env.SAAVN_BASE_URL || 'https://saavn.sumit.co/api').replace(/\/$/, '');
const TIMEOUT  = parseInt(process.env.REQUEST_TIMEOUT_MS || '7000', 10);

// ── Low-level HTTP helper ───────────────────────────────────────────────────

/**
 * GET a JSON resource with a hard timeout.
 * Throws a structured ApiError on HTTP / network failure.
 *
 * @param {string} url
 * @returns {Promise<object>}
 */
async function getJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw Object.assign(new Error(`Upstream HTTP ${response.status}`), {
        statusCode: 502,
        upstream: url,
      });
    }
    return await response.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('Upstream request timed out'), {
        statusCode: 504,
        upstream: url,
      });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Response normalisers ────────────────────────────────────────────────────

/**
 * Map a raw Saavn search result item to our internal Track shape.
 *
 * @param {object} raw
 * @returns {object} Track
 */
function mapSearchResult(raw) {
  const primaryArtist =
    raw.artists?.primary?.[0]?.name ||
    raw.primaryArtists ||
    'Unknown';

  const allArtists = (raw.artists?.primary || [])
    .map(a => a.name)
    .join(', ') || primaryArtist;

  const durationSec = raw.duration ? parseInt(raw.duration, 10) : null;

  // Pick the best thumbnail — prefer 500px, fall back down
  const images = raw.image || [];
  const thumbnail =
    (images.find(i => i.quality === '500x500') ||
     images.find(i => i.quality === '150x150') ||
     images[images.length - 1])?.url || null;

  return {
    id:          raw.id,
    title:       raw.name || raw.song || '',
    artist:      allArtists,
    album:       raw.album?.name || raw.album || null,
    durationSec,
    duration:    durationSec ? formatDuration(durationSec) : null,
    thumbnail,
    language:    raw.language || null,
    year:        raw.year || null,
    hasLyrics:   raw.hasLyrics === 'true' || raw.hasLyrics === true,
  };
}

/**
 * Map a raw Saavn song detail item to our internal Track shape.
 * The /songs endpoint returns richer data than /search/songs.
 *
 * @param {object} raw
 * @returns {object} Track
 */
function mapSongDetail(raw) {
  const base = mapSearchResult(raw);

  const images  = raw.image || [];
  const coverHQ =
    (images.find(i => i.quality === '500x500') ||
     images[images.length - 1])?.url || null;

  const downloadUrls = (raw.downloadUrl || []).map(u => ({
    quality: u.quality,
    url:     u.url,
  }));

  // Highest quality stream — last item is typically 320kbps on Saavn
  const bestStream = downloadUrls[downloadUrls.length - 1] || null;

  return {
    ...base,
    coverHQ,
    releaseDate:  raw.releaseDate || null,
    label:        raw.label || null,
    copyright:    raw.copyright || null,
    playCount:    raw.playCount ? parseInt(raw.playCount, 10) : null,
    downloadUrls,
    streamUrl:    bestStream?.url   || null,
    streamQuality: bestStream?.quality || null,
  };
}

// ── Public API methods ──────────────────────────────────────────────────────

/**
 * Search for songs.
 *
 * @param {string} query
 * @param {number} [limit=10]
 * @returns {Promise<object[]>}  array of mapped Track objects
 */
async function searchSongs(query, limit = 10) {
  const url = `${BASE_URL}/search/songs?query=${encodeURIComponent(query)}&limit=${limit}`;
  const data = await getJSON(url);

  // Handle different API versions: some use .data.results, some use .data
  let results = data?.data?.results || data?.data;
  
  if (!Array.isArray(results)) {
    // If it's a single object (some versions), wrap it in an array
    if (results && typeof results === 'object' && results.id) {
      results = [results];
    } else {
      results = [];
    }
  }

  if (results.length === 0) return [];

  return results.map(mapSearchResult);
}

/**
 * Fetch full details for one or more song IDs.
 *
 * @param {string|string[]} ids
 * @returns {Promise<object[]>}  array of mapped Track objects
 */
async function getSongs(ids) {
  const idList = Array.isArray(ids) ? ids.join(',') : ids;
  const url    = `${BASE_URL}/songs?ids=${encodeURIComponent(idList)}`;
  const data   = await getJSON(url);

  let results = data?.data?.results || data?.data;
  if (!Array.isArray(results)) {
    results = results ? [results] : [];
  }

  if (results.length === 0) return [];

  return results.map(mapSongDetail);
}

/**
 * Convenience: get a single song by ID.
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function getSong(id) {
  const songs = await getSongs([id]);
  return songs[0] || null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

module.exports = { searchSongs, getSongs, getSong };
