/**
 * utils/normalizer.js
 *
 * Cleans raw text before similarity scoring.
 * Consistent normalisation is the single most impactful step —
 * two strings that look different but mean the same thing
 * will score ~1.0 only if noise is stripped first.
 */

// Words that add no semantic value in a music context
const NOISE_WORDS = new Set([
  'official', 'video', 'audio', 'music', 'lyric', 'lyrics',
  'full', 'hd', 'hq', '4k', 'ft', 'feat', 'featuring',
  'remix', 'mix', 'extended', 'version', 'edit',
  'original', 'soundtrack', 'ost', 'cover',
  'live', 'acoustic', 'remastered', 'remaster',
  'explicit', 'clean', 'radio',
]);

/**
 * Full normalisation pipeline for a music title or artist string.
 *
 * Steps:
 *  1. Lowercase
 *  2. Strip content inside brackets — e.g. "(Official Video)", "[HD]"
 *  3. Remove punctuation except apostrophes
 *  4. Collapse multiple spaces
 *  5. Remove noise tokens
 *  6. Trim
 *
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    .toLowerCase()
    // remove bracketed / parenthesised content
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    // remove special chars except alphanumeric, space, apostrophe, hyphen
    .replace(/[^a-z0-9\s'-]/g, ' ')
    // collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
    // filter noise tokens
    .split(' ')
    .filter(t => t && !NOISE_WORDS.has(t))
    .join(' ');
}

/**
 * Normalise and tokenise — returns a Set of tokens.
 * Useful for fast intersection checks.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenSet(text) {
  return new Set(normalize(text).split(' ').filter(Boolean));
}

/**
 * Extract a probable artist name from a raw query like "Shape of You Ed Sheeran"
 * by taking the last 1‑2 words if the query is long enough.
 * This is a heuristic — the real artist comes from the API response.
 *
 * @param {string} query
 * @returns {{ title: string, artist: string }}
 */
function splitQueryHeuristic(query) {
  const norm = normalize(query);
  const tokens = norm.split(' ').filter(Boolean);

  // If the query contains " - " treat left as title, right as artist
  if (query.includes(' - ')) {
    const parts = query.split(' - ');
    return { title: normalize(parts[0]), artist: normalize(parts[1]) };
  }

  // Short query → treat as title only
  if (tokens.length <= 3) return { title: norm, artist: '' };

  // Longer query → last 2 tokens are probably the artist
  const artist = tokens.slice(-2).join(' ');
  const title  = tokens.slice(0, -2).join(' ');
  return { title, artist };
}

module.exports = { normalize, tokenSet, splitQueryHeuristic };
