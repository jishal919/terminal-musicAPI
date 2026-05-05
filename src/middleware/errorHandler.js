/**
 * middleware/errorHandler.js
 *
 * Express error-handling middleware (4 args — must come last).
 * Translates thrown errors into structured JSON responses.
 */

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const status  = err.statusCode || err.status || 500;
  const message = err.message    || 'Internal server error';

  // Log everything — include stack in non-production
  const isProd  = process.env.NODE_ENV === 'production';
  console.error(`[error] ${status} — ${message}`, isProd ? '' : err.stack);

  res.status(status).json({
    success: false,
    error:   message,
    ...(err.upstream  ? { upstream:  err.upstream  } : {}),
    ...(err.details   ? { details:   err.details   } : {}),
    ...(!isProd && err.stack ? { stack: err.stack } : {}),
  });
}

module.exports = errorHandler;
