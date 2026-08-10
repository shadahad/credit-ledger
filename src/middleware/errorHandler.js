const { AppError } = require('../errors/AppError');

function errorHandler(err, req, res, next) {
  // Operational errors (controlled domain responses)
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
    });
  }

  // Handle Postgres Constraint Violations
  if (err.code === '23514') {
    // Check constraint violation
    return res.status(400).json({
      error: 'Operation violates balance or constraint limits',
    });
  }

  // Internal/unexpected errors (do not leak stack trace or internal SQL data)
  console.error('Unhandled Server Error:', err);
  return res.status(500).json({
    error: 'An internal server error occurred',
  });
}

module.exports = errorHandler;