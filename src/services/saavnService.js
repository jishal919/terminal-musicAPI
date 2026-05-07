/**
 * services/saavnService.js
 *
 * All communication with the JioSaavn public API lives here.
 * Controllers and the scoring service never touch fetch() directly.
 *
 * Base URL: https://jiosaavn-api-beta.vercel.app
 */

const fetch = require('node-fetch');

// Using a more stable public instance
const BASE_URL = (process.env.SAAVN_BASE_URL || 'https://jiosaavn-api-beta.vercel.app').replace(/\/$/, '');
const TIMEOUT  = parseInt(process.env.REQUEST_TIMEOUT_MS || '7000', 10);

const QUALITY_LADDER = ['320kbps', '160kbps', '96kbps', '48kbps', '12kbps'];

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
        statusCode: response.status === 429 ? 429 : 502,
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
  const primaryArtist = raw.primaryArtists || 'Unknown';

  const durationSec = raw.duration ? parseInt(raw.duration, 10) : null;

  // Pick the best thumbnail — prefer 500px, fall back down
  // Note: New API instance uses 'link' instead of 'url' in image array
  const images = raw.image || [];
  const thumbnail =
    (images.find(i => i.quality === '500x500') ||
     images.find(i => i.quality === '150x150') ||
     images[images.length - 1])?.link || 
    (images.find(i => i.quality === '500x500') ||
     images.find(i => i.quality === '150x150') ||
     images[images.length - 1])?.url || null;

  return {
    id:          raw.id,
    title:       raw.name || raw.song || '',
    artist:      primaryArtist,
    album:       raw.album?.name || raw.album || null,
    durationSec,
    duration:    durationSec ? formatDuration(durationSec) : null,
    thumbnail,
    language:    raw.language || null,
    year:        raw.year || null,
    hasLyrics:   raw.hasLyrics === 'true' || raw.hasLyrics === true,
    source:      'saavn'
  };
}

/**
 * Map a raw Saavn song detail item to our internal Track shape.
 */
function mapSongDetail(raw) {
  const base = mapSearchResult(raw);

  const downloadUrls = (raw.downloadUrl || []).map(u => ({
    quality: u.quality,
    url:     u.link || u.url, // Handle both structures
  }));

  return {
    ...base,
    downloadUrls
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
async function search(query, limit = 10) {
  const url = `${BASE_URL}/search/songs?query=${encodeURIComponent(query)}&limit=${limit}`;
  const data = await getJSON(url);

  // New API instance returns data in .data.results
  const results = data?.data?.results || data?.data || [];
  
  if (!Array.isArray(results)) return [];

  return results.map(mapSearchResult);
}

/**
 * Get the best available audio stream for a Saavn song ID.
 */
async function getStream(id) {
  // New API uses ?id= instead of ?ids= for single song
  const url = `${BASE_URL}/songs?id=${encodeURIComponent(id)}`;
  const data = await getJSON(url);

  const results = data?.data || [];
  const songRaw = Array.isArray(results) ? results[0] : results;
  
  if (!songRaw) return null;

  const song = mapSongDetail(songRaw);
  const { downloadUrls } = song;
  
  if (!downloadUrls || downloadUrls.length === 0) return null;

  // Pick best quality available from the ladder
  let bestUrl = null;
  let bestQuality = null;

  for (const preferred of QUALITY_LADDER) {
    const match = downloadUrls.find(u =>
      u.quality?.toLowerCase() === preferred.toLowerCase()
    );
    if (match?.url) {
      bestUrl = match.url;
      bestQuality = match.quality;
      break;
    }
  }

  if (!bestUrl) {
    const last = downloadUrls[downloadUrls.length - 1];
    bestUrl = last?.url;
    bestQuality = last?.quality;
  }

  if (!bestUrl) return null;

  return {
    streamUrl: bestUrl,
    source: 'saavn',
    quality: bestQuality,
    format: 'mp4'
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

module.exports = { search, getStream };
