export function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
  const requestPath = req.originalUrl.split('?')[0];
  res.once('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const entry = {
      time: new Date().toISOString(),
      method: req.method,
      path: requestPath,
      status: res.statusCode,
      duration_ms: Math.round(elapsedMs * 100) / 100,
    };
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  });
  next();
}
