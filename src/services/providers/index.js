/**
 * services/providers/index.js
 * 
 * Central registry for music providers.
 * Decouples controllers from specific service implementations.
 */

const saavn = require('../saavnService');
const archive = require('../archiveService');

/**
 * Every registered provider MUST expose:
 * 1. search(query, limit) -> Promise<Track[]>
 * 2. getStream(id)        -> Promise<StreamResult>
 */
const PROVIDERS = {
  saavn,
  archive
};

module.exports = PROVIDERS;
