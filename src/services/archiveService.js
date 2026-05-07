/**
 * services/archiveService.js
 * 
 * Interfaces with the Internet Archive (IA) Advanced Search and Metadata APIs.
 * Provides international music candidates by searching for audio mediatypes.
 */

const fetch = require('node-fetch');

const BASE_URL = 'https://archive.org';
const TIMEOUT_MS = 2500;

/**
 * Search Internet Archive for audio tracks.
 */
async function search(query, limit = 10) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // We search by title for better precision in music context
    const q = `title:("${query}") AND mediatype:audio`;
    const params = new URLSearchParams({
      q,
      'fl[]': 'identifier,title,creator,album,duration',
      'sort[]': 'downloads desc', // Prioritize popular files
      rows: limit * 2, // Fetch more to allow for filtering noise
      output: 'json'
    });

    const response = await fetch(`${BASE_URL}/advancedsearch.php?${params.toString()}`, {
      signal: controller.signal
    });

    if (!response.ok) return [];

    const data = await response.json();
    const docs = data.response?.docs || [];

    // Filter noise and map results
    return docs
      .filter(isPotentiallyMusic)
      .slice(0, limit)
      .map(mapArchiveResult);

  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[archive] Search timed out after ${TIMEOUT_MS}ms`);
    } else {
      console.error('[archive] Search error:', err.message);
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Get the best available audio stream for an IA identifier.
 */
async function getStream(id) {
  try {
    const response = await fetch(`${BASE_URL}/metadata/${id}`);
    if (!response.ok) return null;

    const data = await response.json();
    const { server, dir, files } = data;

    if (!server || !dir || !files || !Array.isArray(files)) return null;

    // Filter for valid audio files
    const audioFiles = files.filter(f => {
      const name = (f.name || '').toLowerCase();
      const size = parseInt(f.size || '0', 10);

      const isValidExt = name.endsWith('.mp3') || name.endsWith('.ogg') || name.endsWith('.flac');
      const isNotPreview = !name.includes('preview') && !name.includes('sample') && !name.includes('demo');
      const isLargeEnough = size > 500000; // > 500KB

      return isValidExt && isNotPreview && isLargeEnough;
    });

    if (audioFiles.length === 0) return null;

    // Weighting: MP3 > OGG > FLAC, then bitrate
    const ranked = audioFiles.sort((a, b) => {
      const getWeight = (f) => {
        const name = f.name.toLowerCase();
        if (name.endsWith('.mp3')) return 3;
        if (name.endsWith('.ogg')) return 2;
        return 1;
      };
      
      const weightA = getWeight(a);
      const weightB = getWeight(b);
      
      if (weightA !== weightB) return weightB - weightA;
      
      const bitrateA = parseInt(a.bitrate || '0', 10);
      const bitrateB = parseInt(b.bitrate || '0', 10);
      return bitrateB - bitrateA;
    });

    const bestFile = ranked[0];
    const streamUrl = `https://${server}${dir}/${encodeURIComponent(bestFile.name)}`;

    return {
      streamUrl,
      source: 'archive',
      format: bestFile.name.split('.').pop(),
      quality: bestFile.bitrate ? `${bestFile.bitrate}kbps` : 'VBR'
    };
  } catch (err) {
    console.error('[archive] Metadata error:', err.message);
    return null;
  }
}

/**
 * Maps IA document to standard Project Song schema
 */
function mapArchiveResult(doc) {
  return {
    id:        doc.identifier,
    title:     cleanMetadata(doc.title || 'Unknown Title'),
    artist:    cleanMetadata(doc.creator || 'Unknown Artist'),
    album:     doc.album || 'Internet Archive',
    duration:  doc.duration || null,
    thumbnail: `https://archive.org/services/img/${doc.identifier}`,
    source:    'archive'
  };
}

/**
 * Clean noisy metadata strings (titles/artists).
 */
function cleanMetadata(text) {
  if (!text) return '';
  
  return text
    // 1. Remove file extensions
    .replace(/\.(mp3|wav|flac|ogg|m4a|wma)$/gi, '')
    // 2. Remove common noisy tags
    .replace(/\((official audio|lyrics|official video|full album|high quality|hq)\)/gi, '')
    .replace(/\[(hd|official audio|full album|hq)\]/gi, '')
    // 3. Remove symbols and excessive whitespace
    .replace(/[\[\]\(\)\{\}]/g, ' ')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lightweight music check for IA results.
 */
function isPotentiallyMusic(doc) {
  const title = (doc.title || '').toLowerCase();
  const id = (doc.identifier || '').toLowerCase();

  const noiseKeywords = ['podcast', 'audiobook', 'lecture', 'interview', 'radio', 'episode', 'chapter'];
  if (noiseKeywords.some(k => title.includes(k))) return false;

  if (title.length > 120) return false;
  if ((id.match(/[._-]/g) || []).length > 6) return false;

  return true;
}

module.exports = { search, getStream };
