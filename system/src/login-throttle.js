function createLoginThrottle({
  baseDelayMs = 250,
  maxDelayMs = 2000,
  windowMs = 15 * 60 * 1000,
  maxTrackedKeys = 10_000,
  now = Date.now,
} = {}) {
  if (![baseDelayMs, maxDelayMs, windowMs, maxTrackedKeys].every(Number.isSafeInteger)
    || baseDelayMs < 0 || maxDelayMs < baseDelayMs || windowMs < 1000 || maxTrackedKeys < 100) {
    throw new Error('Login throttle settings are invalid.')
  }
  const attemptsByKey = new Map()
  let attemptsSincePrune = 0

  function beforeAttempt(keyValue) {
    const key = String(keyValue || 'unknown')
    const timestamp = now()
    const previous = attemptsByKey.get(key)
    const attempts = previous && timestamp - previous.startedAt < windowMs ? previous.attempts + 1 : 1
    const startedAt = previous && timestamp - previous.startedAt < windowMs ? previous.startedAt : timestamp
    attemptsByKey.set(key, { attempts, startedAt, lastAttemptAt: timestamp })
    attemptsSincePrune += 1
    if (attemptsSincePrune >= 64 || attemptsByKey.size > maxTrackedKeys) {
      for (const [candidate, state] of attemptsByKey) {
        if (timestamp - state.lastAttemptAt >= windowMs) attemptsByKey.delete(candidate)
      }
      attemptsSincePrune = 0
    }
    while (attemptsByKey.size > maxTrackedKeys) {
      const oldest = attemptsByKey.keys().next().value
      attemptsByKey.delete(oldest)
    }
    const exponent = Math.max(0, attempts - 2)
    return Math.min(maxDelayMs, attempts <= 1 ? 0 : baseDelayMs * (2 ** exponent))
  }

  function recordSuccess(keyValue) {
    attemptsByKey.delete(String(keyValue || 'unknown'))
  }

  function createMiddleware() {
    return (req, _res, next) => {
      const key = req.ip || req.socket?.remoteAddress || 'unknown'
      const delay = beforeAttempt(key)
      if (!delay) return next()
      const timer = setTimeout(next, delay)
      timer.unref?.()
    }
  }

  return { beforeAttempt, createMiddleware, recordSuccess }
}

module.exports = { createLoginThrottle }
