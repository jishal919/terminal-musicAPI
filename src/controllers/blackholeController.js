// src/controllers/blackholeController.js
const bh = require('../services/blackholeService');
const logger = require('../utils/logger');

function ok(res, data) {
  return res.json({ success: true, data });
}

function fail(res, err) {
  const status = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  logger.error(`[blackhole] ${code}: ${err.message}`);
  return res.status(status).json({ success: false, error: { code, message: err.message } });
}

// GET /bh/search?q=Shape+of+You&limit=8
async function search(req, res) {
  const { q, query, limit } = req.query;
  const searchQuery = q || query;
  if (!searchQuery) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'q param is required' } });
  try {
    return ok(res, await bh.search(searchQuery, Math.min(parseInt(limit) || 8, 20)));
  } catch (e) { return fail(res, e); }
}

// GET /bh/stream/:videoId?name=Shape+of+You&artist=Ed+Sheeran
async function stream(req, res) {
  const { videoId } = req.params;
  const { name, artist } = req.query;
  try {
    return ok(res, await bh.stream(videoId, { songName: name, artist }));
  } catch (e) { return fail(res, e); }
}

// GET /bh/metadata/:videoId
async function metadata(req, res) {
  const { videoId } = req.params;
  try {
    return ok(res, await bh.metadata(videoId));
  } catch (e) { return fail(res, e); }
}

// GET /bh/trending?region=IN
async function trending(req, res) {
  const { region } = req.query;
  try {
    return ok(res, await bh.trending(region || 'IN'));
  } catch (e) { return fail(res, e); }
}

module.exports = { search, stream, metadata, trending };