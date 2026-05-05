const { Router } = require('express');
const searchController  = require('../controllers/searchController');
const streamController  = require('../controllers/streamController');
const metadataController = require('../controllers/metadataController');

const router = Router();

// GET /api/search?query=<string>&limit=<number>&minScore=<0‑1>
router.get('/search', searchController.search);

// GET /api/stream?id=<saavn_id>
router.get('/stream', streamController.stream);

// GET /api/metadata?id=<saavn_id>
router.get('/metadata', metadataController.metadata);

module.exports = router;
