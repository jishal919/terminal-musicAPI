require('dotenv').config();
const express = require('express');
const cors = require('cors');
const routes = require('./src/routes');
const bhController = require('./src/controllers/blackholeController');
const errorHandler = require('./src/middleware/errorHandler');
const rateLimiter = require('./src/middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(rateLimiter);

// Request logger — prints method, path, and query for every incoming request
app.use((req, _res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.path}`, req.query);
  next();
});

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api', routes);

// Blackhole API routes
app.get('/bh/search',            bhController.search);
app.get('/bh/stream/:videoId',   bhController.stream);
app.get('/bh/metadata/:videoId', bhController.metadata);
app.get('/bh/trending',          bhController.trending);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// 404 fallback
app.use((_req, res) => res.status(404).json({ success: false, error: 'Route not found' }));

// Centralised error handler (must be last)
app.use(errorHandler);

// For Vercel deployment, we export the app. 
// We only call app.listen() if we are running locally.
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🎵 Music API running on http://localhost:${PORT}`);
    console.log(`   MIN_CONFIDENCE : ${process.env.MIN_CONFIDENCE_SCORE || 0.35}`);
    console.log(`   CACHE_TTL      : ${process.env.CACHE_TTL_SEARCH || 300}s (search)`);
  });
}

module.exports = app;
