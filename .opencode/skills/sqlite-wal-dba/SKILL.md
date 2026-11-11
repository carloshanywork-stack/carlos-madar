---
name: SQLite WAL DBA
description: Tune and safely evolve MADAR V2's local SQLite database, WAL behavior, indexes, transactions, and backup/recovery paths.
---

# MADAR V2 SQLite rules

- Use the existing local SQLite database and current driver conventions. Keep WAL mode, foreign keys, and configured busy timeout intact.
- Make schema changes additive, transactional, idempotent, and recorded in `schema_migrations`; preserve identifiers, relations, and historical rows. Never recreate the schema or use `sync({ force: true })`.
- Use transactions for coupled business writes. Inspect query plans with `EXPLAIN QUERY PLAN` before adding indexes; justify index write/storage costs and avoid duplicate indexes.
- Run migration and performance checks against temporary databases. Treat production SQL/MCP access as read-only unless a specific, scoped write is authorized.
- Preserve the repository's established backup path (`better-sqlite3` online `database.backup()` plus the configured local storage archive). Do not replace it with `VACUUM INTO` or claim an atomic/verified recovery path without testing WAL consistency, restore, and application compatibility.
- Keep customer data local under the configured storage root; do not add cloud database, analytics, or backup dependencies.
