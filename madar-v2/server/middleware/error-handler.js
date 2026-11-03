export function notFoundHandler(req, res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.path}`);
  error.status = 404;
  next(error);
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const status = error.code === 'LIMIT_FILE_SIZE'
    ? 413
    : error.name === 'MulterError'
      ? 400
      : error.code === 'SQLITE_CONSTRAINT_UNIQUE'
        ? 409
        : error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || error.code === 'SQLITE_CONSTRAINT_CHECK'
          ? 400
          : Number.isInteger(error.status) && error.status >= 400 && error.status < 600
    ? error.status
    : 500;
  if (status >= 500) console.error(error);

  res.status(status).json({
    error: status >= 500 && process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : error.message,
  });
}
