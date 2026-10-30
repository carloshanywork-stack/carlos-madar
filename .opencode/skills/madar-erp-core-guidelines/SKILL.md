---
name: Madar ERP Core Guidelines
description: Core safety, data, and deployment rules for developing the Madar ERP project.
---

# Madar ERP Core Guidelines

Apply these requirements to all Madar ERP work.

## Zero Cloud
- Keep application data, customer files, and processing on the local machine or trusted LAN/Tailscale network.
- Persist customer files under the repository-root `storage/` directory, using the configured storage root. Do not move customer data to cloud storage or hard-code a repository-relative storage path.
- Do not add cloud dependencies or external data transfer unless the user explicitly requests it.

## Database Safety
- Use the existing SQLite database and handwritten SQL / Sequelize integration; preserve the current driver and schema conventions.
- Preserve SQLite WAL mode and transactional consistency for data changes.
- Never use `sync({ force: true })`, destructive schema recreation, or destructive database commands.
- Deletions of persistent business records must be soft deletes. Sequelize models that support soft deletion must retain `paranoid: true`; use `destroy()` without `force: true`.
- Keep migrations additive and transactional, preserve identifiers and history, and record one-time migrations in `schema_migrations`.
- Treat direct SQL/MCP access as read-only unless a specific write is explicitly requested and safely scoped. Never make schema or production-data changes as an incidental inspection step.

## Arabic Data Mapping
- When matching Arabic machine names from Excel or folder names, trim and normalize the input, then match against the Arabic-name field in the actual schema.
- The current `machines` table uses `name_ar` (Sequelize attribute `nameAr`); use that field rather than assuming a nonexistent `arabic_name` column. For other entities, use the actual schema's Arabic `name`/Arabic-name attribute.
- Where a region/area is supplied, constrain machine matching to that region before linking records or photos.
- Preserve stable machine codes and existing relations during imports. Validate rows, avoid SQLite parameter-count limits, and perform imports transactionally.

## Project Conventions
- Use Node.js 20+ and run relevant tests, `npm run check`, and `npm run build` for code changes.
- API integration tests must use temporary SQLite databases and storage directories; never aim tests at the live database or real customer storage.
- Keep archived source images byte-for-byte unchanged. Compress only derived in-memory buffers for exports.
- Respect existing role authorization and audit sensitive changes with actor, action, entity, old/new values, and timestamp.
