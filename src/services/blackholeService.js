// src/services/blackholeService.js
// ─────────────────────────────────────────────────────────────────
//  BLACKHOLE-STYLE MUSIC SERVICE
//
//  Exactly how the BlackHole app works:
//
//  1. SEARCH  → YouTube Music internal API (ytmusic-api)
//               Gets real song name, artist, album, thumbnail
//               No API key needed — uses YT Music's internal web API
//               Same API BlackHole's flutter app uses via youtube_explode_dart
//
//  2. STREAM  → Piped API (YouTube frontend)
//               Takes the videoId from YT Music search
//               Returns direct audio stream URL (.m4a / .webm)
//               No key needed — reverse engineered YT player
//
//  3. FALLBACK → JioSaavn for Indian songs OR Piped alternate instance
//
//  Result: 100M+ songs, Indian + International, no API key, free forever
// ─────────────────────────────────────────────────────────────────

const axios = require('axios');
const YTMusic = require('ytmusic-api');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

// ── CONFIG ────────────────────────────────────────────────────────

const REQUEST_TIMEOUT = 7000;

// Multiple Piped instances — we try them in order, fall back if one is down
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api-piped.mha.fi',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.university',
  'https://piped-api.garudalinux.org',
];

const SAAVN_BASE = 'https://saavn.sumit.co/api';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
  'Accept': 'application/json',
};

// ── YT MUSIC CLIENT (singleton) ───────────────────────────────────

let ytMusicClient = null;

async function getYTMusicClient() {
  if (ytMusicClient) return ytMusicClient;
  const client = new YTMusic();
  await client.initialize();
  ytMusicClient = client;
  logger.info('YTMusic client initialized');
  return client;
}

// ── PIPED STREAM RESOLVER ─────────────────────────────────────────

/**
 * Try each Piped instance until one returns a valid stream.
 * Returns { audioUrl, quality, format, instanceUsed } or throws.
 */
async function resolveStreamFromPiped(videoId) {
  let lastError;

  for (const instance of PIPED_INSTANCES) {
    try {
      const res = await axios.get(`${instance}/streams/${videoId}`, {
        timeout: REQUEST_TIMEOUT,
        headers: HEADERS,
      });

      const data = res.data;
      const audioStreams = data.audioStreams || [];

      if (audioStreams.length === 0) {
        logger.warn(`Piped ${instance}: no audio streams for ${videoId}`);
        continue;
      }

      // Pick best quality audio stream
      // Piped returns streams sorted — higher bitrate = better
      // Prefer m4a (AAC) over webm for browser compatibility
      const m4aStreams = audioStreams.filter(s =>
        s.mimeType?.includes('audio/mp4') || s.format === 'm4a'
      );
      const webmStreams = audioStreams.filter(s =>
        s.mimeType?.includes('audio/webm') || s.format === 'webm'
      );

      // Sort by bitrate descending
      const sortedM4a = [...m4aStreams].sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      const sortedWebm = [...webmStreams].sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      // Prefer m4a, fallback webm, fallback first available
      const best = sortedM4a[0] || sortedWebm[0] || audioStreams[0];

      logger.info(`Stream resolved via Piped`, {
        instance,
        videoId,
        format: best.mimeType || best.format,
        bitrate: best.bitrate,
      });

      return {
        audioUrl:     best.url,
        quality:      best.quality || `${Math.round((best.bitrate || 0) / 1000)}kbps`,
        bitrate:      best.bitrate || null,
        format:       best.mimeType || best.format || 'audio/mp4',
        instanceUsed: instance,
        // All available for quality picker
        allStreams: audioStreams.map(s => ({
          url:     s.url,
          quality: s.quality || `${Math.round((s.bitrate || 0) / 1000)}kbps`,
          bitrate: s.bitrate,
          format:  s.mimeType || s.format,
        })),
      };
    } catch (err) {
      lastError = err;
      logger.warn(`Piped instance failed: ${instance}`, { error: err.message });
      // try next instance
    }
  }

  throw new Error(`All Piped instances failed. Last error: ${lastError?.message}`);
}

// ── SAAVN STREAM RESOLVER (fallback for Indian songs) ─────────────

async function resolveStreamFromSaavn(songName, artist) {
  const query = artist ? `${songName} ${artist}` : songName;
  const searchRes = await axios.get(`${SAAVN_BASE}/search/songs`, {
    params: { query, limit: 3 },
    timeout: REQUEST_TIMEOUT,
    headers: HEADERS,
  });

  const results = searchRes.data?.data?.results || [];
  if (results.length === 0) throw new Error('No Saavn results');

  const song = results[0];
  const detailRes = await axios.get(`${SAAVN_BASE}/songs`, {
    params: { ids: song.id },
    timeout: REQUEST_TIMEOUT,
    headers: HEADERS,
  });

  const detail = detailRes.data?.data?.[0];
  if (!detail?.downloadUrl?.length) throw new Error('No download URLs from Saavn');

  // Sort by quality (320kbps best)
  const qualityOrder = ['320kbps', '160kbps', '96kbps', '48kbps', '12kbps'];
  let best = null;
  for (const q of qualityOrder) {
    best = detail.downloadUrl.find(d => d.quality === q);
    if (best) break;
  }

  return {
    audioUrl: best?.url || detail.downloadUrl[detail.downloadUrl.length - 1].url,
    quality:  best?.quality || 'unknown',
    bitrate:  null,
    format:   'audio/mp4',
    source:   'saavn',
    allStreams: detail.downloadUrl.map(d => ({
      url:     d.url,
      quality: d.quality,
      bitrate: null,
      format:  'audio/mp4',
    })),
  };
}

// ── FORMAT HELPERS ────────────────────────────────────────────────

function formatSongResult(ytSong, index) {
  // Extract best thumbnail (highest resolution)
  const thumbs = ytSong.thumbnails || [];
  const bestThumb = thumbs.reduce((best, t) =>
    ((t.width || 0) > (best?.width || 0)) ? t : best, thumbs[0]
  );

  // Saavn returns primary artists as array; YTMusic gives artist object
  const artistName = ytSong.artist?.name
    || (Array.isArray(ytSong.artists) ? ytSong.artists.map(a => a.name || a).join(', ') : null)
    || (typeof ytSong.artist === 'string' ? ytSong.artist : null)
    || 'Unknown Artist';

  return {
    videoId:   ytSong.videoId,
    name:      ytSong.name       || ytSong.title || 'Unknown',
    artist:    artistName,
    album:     ytSong.album?.name || null,
    duration:  ytSong.duration   || null,   // seconds
    year:      ytSong.year       || null,
    explicit:  ytSong.isExplicit || false,
    thumbnail: bestThumb?.url    || null,
    // Popularity proxy: position in search results
    rank:      index + 1,
  };
}

// ── MAIN SERVICE FUNCTIONS ────────────────────────────────────────

/**
 * search(query)
 *
 * Search YouTube Music for songs. Returns ranked list with:
 * videoId, name, artist, album, duration, thumbnail
 *
 * This is exactly what BlackHole does — search YT Music to get
 * the correct song metadata, then use videoId to stream.
 */
async function search(query, limit = 8) {
  if (!query?.trim()) throw Object.assign(new Error('Query is required'), { statusCode: 400 });

  const cacheKey = `bh:search:${query.toLowerCase().trim()}:${limit}`;
  const cached = cache.search.get(cacheKey);
  if (cached) return { ...cached, fromCache: true };

  const startMs = Date.now();

  try {
    const yt = await getYTMusicClient();
    const rawResults = await yt.searchSongs(query);

    const results = rawResults
      .slice(0, limit)
      .map((song, i) => formatSongResult(song, i));

    const response = {
      query,
      total: results.length,
      processingMs: Date.now() - startMs,
      source: 'youtube_music',
      results,
    };

    cache.search.set(cacheKey, response);
    logger.info('YTMusic search complete', { query, results: results.length, ms: response.processingMs });
    return response;

  } catch (err) {
    logger.error('YTMusic search failed', { query, error: err.message });
    throw Object.assign(
      new Error(`Search failed: ${err.message}`),
      { statusCode: 502, code: 'SEARCH_FAILED' }
    );
  }
}

/**
 * stream(videoId, options)
 *
 * Get a direct audio stream URL for a YouTube videoId.
 * Uses Piped API — same technique BlackHole uses (youtube_explode_dart
 * does the same thing: reverse-engineer YT's player to get stream URLs).
 *
 * Falls back to Saavn if videoId looks like a Saavn ID (no dashes, short).
 */
async function stream(videoId, options = {}) {
  const { songName, artist } = options;

  if (!videoId?.trim()) throw Object.assign(new Error('videoId is required'), { statusCode: 400 });

  const cacheKey = `bh:stream:${videoId}`;
  const cached = cache.metadata.get(cacheKey);
  if (cached) return { ...cached, fromCache: true };

  const startMs = Date.now();

  // Detect if this looks like a Saavn ID (alphanumeric, no underscores/dashes, ~8 chars)
  const looksLikeSaavnId = /^[a-zA-Z0-9]{6,12}$/.test(videoId) && !videoId.includes('-');

  let streamData;
  let usedSource = 'piped';

  try {
    // Always try Piped first (works for YouTube Music videoIds)
    streamData = await resolveStreamFromPiped(videoId);
  } catch (pipedErr) {
    logger.warn('Piped failed, trying Saavn fallback', { videoId, error: pipedErr.message });

    if (songName) {
      try {
        streamData = await resolveStreamFromSaavn(songName, artist);
        usedSource = 'saavn';
      } catch (saavnErr) {
        logger.error('Both Piped and Saavn failed', { videoId });
        throw Object.assign(
          new Error(`Could not resolve stream. Piped: ${pipedErr.message}. Saavn: ${saavnErr.message}`),
          { statusCode: 503, code: 'STREAM_UNAVAILABLE' }
        );
      }
    } else {
      throw Object.assign(
        new Error(`Stream unavailable: ${pipedErr.message}`),
        { statusCode: 503, code: 'STREAM_UNAVAILABLE' }
      );
    }
  }

  const response = {
    videoId,
    ...streamData,
    source: usedSource,
    processingMs: Date.now() - startMs,
  };

  cache.metadata.set(cacheKey, response);
  return response;
}

/**
 * metadata(videoId)
 *
 * Get full song metadata from YouTube Music by videoId.
 * Falls back to Piped API if YTMusic fails (often happens on Vercel/Serverless).
 */
async function metadata(videoId) {
  const id = videoId?.trim();
  if (!id || id.length < 10) {
    throw Object.assign(new Error('Invalid or missing videoId'), { statusCode: 400 });
  }

  const cacheKey = `bh:meta:${id}`;
  const cached = cache.metadata.get(cacheKey);
  if (cached) return { ...cached, fromCache: true };

  logger.info(`Fetching metadata for: ${id}`);
  const startMs = Date.now();

  // ── TRY YT MUSIC FIRST ─────────────────────────────────────────
  try {
    const yt = await getYTMusicClient();
    const [songSettlement, upNextSettlement] = await Promise.allSettled([
      yt.getSong(id),
      yt.getUpNexts(id),
    ]);

    if (songSettlement.status === 'fulfilled' && songSettlement.value) {
      const s = songSettlement.value;
      let lyrics = null;
      try {
        const lyricsData = await yt.getLyrics(id);
        lyrics = lyricsData?.lyrics || null;
      } catch { /* lyrics optional */ }

      const result = {
        videoId: id,
        name:    s.name || s.title || 'Unknown',
        artist:  s.artist?.name
          || (Array.isArray(s.artists) ? s.artists.map(a => a.name || a).join(', ') : null)
          || (typeof s.artist === 'string' ? s.artist : null)
          || 'Unknown',
        album:      s.album?.name || s.album || null,
        duration:   s.duration || null,
        year:       s.year || null,
        explicit:   s.isExplicit || false,
        thumbnails: s.thumbnails || [],
        lyrics:     lyrics,
        upNext:     upNextSettlement.status === 'fulfilled'
          ? (upNextSettlement.value || []).slice(0, 5).map((t, i) => formatSongResult(t, i))
          : [],
        processingMs: Date.now() - startMs,
        source: 'youtube_music',
      };
      cache.metadata.set(cacheKey, result);
      return result;
    }
    
    logger.warn(`YTMusic.getSong failed or empty for ${id}`, { 
      reason: songSettlement.reason?.message || 'Empty response' 
    });
  } catch (err) {
    logger.warn(`YTMusic metadata attempt failed for ${id}`, { error: err.message });
  }

  // ── FALLBACK: TRY PIPED API ────────────────────────────────────
  // If YTMusic fails, Piped is a great source for basic metadata.
  logger.info(`Attempting Piped fallback for metadata: ${id}`);
  
  for (const instance of PIPED_INSTANCES) {
    try {
      const res = await axios.get(`${instance}/streams/${id}`, {
        timeout: 5000,
        headers: HEADERS,
      });

      const d = res.data;
      if (!d.title) continue;

      const result = {
        videoId: id,
        name:    d.title,
        artist:  d.uploader || d.uploaderName || 'Unknown',
        album:   null,
        duration: d.duration || null,
        year:     null,
        explicit: false,
        thumbnails: d.thumbnailUrl ? [{ url: d.thumbnailUrl }] : [],
        lyrics:   null,
        upNext:   (d.relatedStreams || []).slice(0, 5).map(s => ({
          videoId:   s.url?.split('v=')[1] || s.url?.split('/').pop(),
          name:      s.title,
          artist:    s.uploaderName || s.uploader,
          thumbnail: s.thumbnail,
        })),
        processingMs: Date.now() - startMs,
        source: `piped_fallback (${new URL(instance).hostname})`,
      };

      cache.metadata.set(cacheKey, result);
      return result;
    } catch (e) {
      logger.debug(`Piped metadata fallback failed for ${instance}: ${e.message}`);
    }
  }

  throw Object.assign(
    new Error(`Could not fetch metadata from any source for ID: ${id}`),
    { statusCode: 404, code: 'NOT_FOUND' }
  );
}

/**
 * trending()
 *
 * Get trending/recommended songs from YouTube Music home.
 * BlackHole shows these on the home screen.
 */
async function trending(region = 'IN') {
  const cacheKey = `bh:trending:${region}`;
  const cached = cache.search.get(cacheKey);
  if (cached) return { ...cached, fromCache: true };

  const startMs = Date.now();

  try {
    const yt = await getYTMusicClient();
    const sections = await yt.getHomeSections();

    // YT Music home returns multiple sections: "Top picks", "Mixed for you", etc.
    const songs = [];
    for (const section of (sections || [])) {
      const items = section.contents || section.items || [];
      for (const item of items) {
        if (item.videoId && item.name) {
          songs.push(formatSongResult(item, songs.length));
        }
        if (songs.length >= 20) break;
      }
      if (songs.length >= 20) break;
    }

    const response = {
      region,
      total: songs.length,
      processingMs: Date.now() - startMs,
      results: songs,
    };

    cache.search.set(cacheKey, response);
    return response;

  } catch (err) {
    throw Object.assign(
      new Error(`Trending fetch failed: ${err.message}`),
      { statusCode: 502, code: 'TRENDING_FAILED' }
    );
  }
}

module.exports = { search, stream, metadata, trending };    