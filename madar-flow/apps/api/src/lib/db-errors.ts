/**
 * Detects PostgreSQL unique violations. Drizzle wraps driver errors in a
 * `DrizzleQueryError`, so the original error (with `code` and `constraint`)
 * lives on the `cause` chain rather than on the thrown object itself.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current !== null && current !== undefined; depth += 1) {
    if (typeof current !== 'object') return false;
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === '23505') {
      if (!constraint || candidate.constraint === constraint) return true;
    }
    current = candidate.cause;
  }
  return false;
}
