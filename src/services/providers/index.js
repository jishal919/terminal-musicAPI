/**
 * services/providers/index.js
 * 
 * Central registry for music providers.
 * Decouples controllers from specific service implementations.
 */

const saavn = require('../saavnService');
const archive = require('../archiveService');
const youtube = require('../youtubeService');

/**
 * Every registered provider MUST expose:
 * 1. search(query, limit) -> Promise<Track[]>
 * 2. getStream(id)        -> Promise<StreamResult>
 *
 * `youtube` is what gives the catalog real international/non-Bollywood
 * breadth — saavn and archive alone are Indian-catalog-heavy or
 * archive.org-dependent (hit or miss for commercial music).
 */
const PROVIDERS = {
  saavn,
  archive,
  youtube
};

module.exports = PROVIDERS;
