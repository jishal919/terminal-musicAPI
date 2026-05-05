require('dotenv').config();
const express = require('express');
const cors = require('cors');
const routes = require('./src/routes');
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

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// 404 fallback
app.use((_req, res) => res.status(404).json({ success: false, error: 'Route not found' }));

// Centralised error handler (must be last)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🎵 Music API running on http://localhost:${PORT}`);
  console.log(`   MIN_CONFIDENCE : ${process.env.MIN_CONFIDENCE_SCORE || 0.35}`);
  console.log(`   CACHE_TTL      : ${process.env.CACHE_TTL_SEARCH || 300}s (search)`);
});
