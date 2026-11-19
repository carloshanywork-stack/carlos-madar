# Agent instructions

## Multi-Agent Worktree Architecture & Coordinator Role
- This workspace (`/home/carlos/Desktop/MADAR`) is the **Production & Coordinator Workspace** on branch `main`.
- The repository owner operates a 3-agent worktree layout:
  1. **Coordinator Agent** (this workspace, branch `main`): reviews incoming commits from feature worktrees, performs clean merges into `main`, verifies system and PM2 health, and executes safe `git push origin main`.
  2. **Mobile Specialist Agent** (`/home/carlos/Desktop/MADAR-mobile`, branch `feat/mobile-app`): builds and modifies Android apps, APK releases, and mobile rep modules exclusively.
  3. **Desktop Specialist Agent** (`/home/carlos/Desktop/MADAR-desktop`, branch `feat/desktop-system`): builds and modifies Windows Electron desktop app, code signing certificates, and packaging scripts exclusively.
- **Git workflow for Coordinator**:
  - The `main` branch is the production trunk. Only the Coordinator merges from `feat/mobile-app` or `feat/desktop-system` into `main`.
  - Preserve existing edits. Before committing or pushing, inspect the working tree, verify the relevant changes, and run appropriate safe tests. Push completed, verified changes to `origin/main` so the existing deployment process can pick them up. Do not assume a successful push proves the running service or APK has updated; verify their actual state separately.

## Repository map and commands
- `system/` is the npm package: Express API in `src/server.js`, React/Vite UI in `src/App.jsx`, SQLite schema/migrations in `src/db.js`, and pure stock arithmetic in `src/inventory.js`.
- `src/main.jsx` wraps the SPA in `BrowserRouter`; route paths and page mapping live in `src/App.jsx`. Normal API calls use its `fetch` helper; folder-upload progress uses XHR because Fetch does not expose upload progress.
- The root `.env` is loaded by the API; relative `DATABASE_URL` and `STORAGE_ROOT_PATH` resolve from the repository root. Keep persistent customer files in root `storage/`, not `system/`.
- Use Node 22+ to satisfy the locked `better-sqlite3` 13 engine requirement. From `system/`, run `npm run dev`, `npm test`, `npm run check`, or `npm run build`; focused tests are `node --test test/inventory.test.js`, `node --test test/api.test.js`, and `node --test test/migration.test.js`.
- `npm run dev` starts `nodemon src/server.js` and Vite; it assumes dependencies are already installed. Before direct/PM2 startup, explicitly run `npm install` and `npm run build` from `system/`; `system/index.js` checks prerequisites and fails clearly without installing or building.
- PM2 is intentionally one forked process: SQLite is local and must not be scaled to multiple app instances.
- API integration tests launch `index.js` on a free port with temporary DB/storage paths; never point tests at `system/data/madar.sqlite` or real `storage/` data.
- SQLite access is mixed: handwritten SQL and schema migrations use `better-sqlite3`; Sequelize models and transactions use the SQLite dialect backed by `sqlite3`. Both connections target the same configured database file. Keep migrations additive and transactional, preserve IDs/history, and record one-time migrations in `schema_migrations`; do not switch drivers or recreate the schema.
- Daily ZIP backups are stored in root `Backups/`; set `BACKUP_CRON` or `BACKUP_ROOT_PATH` to override the defaults. Fatal process errors are written to root `error.log` before shutdown.
- Vite proxies `/api`, `/storage`, and `/socket.io` to the API. The storage root is configurable; derive `Areas` from `storageRoot`, not a hard-coded repository-relative path.
- Machine photo review virtualizes the grid with TanStack Virtual and uses dnd-kit; serve authenticated 200px WebP thumbnails from `GET /api/files/thumbnail` and keep the originals for full-size preview/export.

## Domain constraints for related work
- These are requirements, not claims that every feature is complete; inspect the implementation and tests before reporting status.
- The auto-installer delegates to `npm install`; keep the manifest and lockfile aligned with requested runtime packages. The active upgrade brief names `express`, `cors`, `dotenv`, `multer`, `fs-extra`, `exifr`, `sharp`, `pptxgenjs`, `docxtemplater`, `pizzip`, `xlsx`, `sequelize`, `sqlite3`, `chokidar`, and `socket.io`; reconcile the requested DB packages with the existing `better-sqlite3` stack rather than silently switching drivers.
- Do not announce an `Areas` folder as ready on `addDir` alone: use Chokidar `awaitWriteFinish` with `stabilityThreshold: 3000` and `pollInterval: 500`; keep `.incoming` excluded. The Socket.IO event is `areas:folder-added`.
- Preserve archived source images byte-for-byte. For PPTX/Word exports, compress derived in-memory buffers (Sharp, max width 800px, JPEG quality 75); never rewrite archived originals.
- Image ordering must use EXIF (`DateTimeOriginal`/`CreateDate`), then supported timestamp filename patterns, then filesystem `mtime`; sort older photos to Before and put exact timestamp ties in Before for manual correction.
- Excel imports upsert by stable machine/material business code, preserve existing IDs and relations, never truncate, and deactivate missing rows rather than delete them when `deactivateMissing` is requested.
- Main-warehouse stock is whole units; fractional reusable offcuts belong to the sub-warehouse. Offer the user the sub-warehouse-vs-full-unit choice; if full units are chosen, round main withdrawal up and record the remainder transactionally as an offcut.
- Invoice creation does not change cash; receipt/payment vouchers are recorded separately and invoices track total, paid, remaining, and Unpaid/Partial/Paid state.
- Sensitive changes store actor, action, entity, old/new values, and timestamp; audit browsing and filtering are Admin-only.
- File reads through `/api/files`, `/api/files/thumbnail`, and `/api/storage/files` must stay under the configured storage root and reject symlink paths. Current product use is administrator-only; do not add customer- or role-scoped access without a product request.
- Order-directory deletion must stage by same-volume rename before the soft-delete transaction, restore on transaction failure, and recover interrupted stages before the API starts. Keep staging folders out of storage listings and backups.
- In Android Room DAOs, never use `@Insert(onConflict = OnConflictStrategy.REPLACE)` on parent tables (e.g. `visits`) where child tables (e.g. `photos`) define `ForeignKey(..., onDelete = CASCADE)`. In SQLite, `INSERT OR REPLACE` deletes the row before re-inserting, causing automatic cascade deletion of child records. Always use Room's `@Upsert` (`INSERT ... ON CONFLICT DO UPDATE`) to preserve child entities.
- Any mobile release intended for distribution or client testing MUST increment `versionCode` in `madar-v2/android/version.properties` and register a corresponding row in `apk_releases` on the server. If `versionCode` is not bumped, installed Android clients will evaluate matching versions and bypass update prompts.
- For physical Android QA testing via `@Android CLI`: verify connected devices (`adb devices -l`), test first-launch permissions reset (`pm reset-permissions <pkg>`), test process-death survival (`am force-stop <pkg>`), verify gallery backup naming (`MADAR_<machineCode>_<phase>_<pos>_<id>.jpg` in `Pictures/MADAR`), and confirm backend ingestion (`rep_visits`, `rep_visit_photos`) with physical storage in `storage/Areas/`.

## Field Operations Mobile Architecture Standards (Amazon Flex Paradigm)
- **Declarative Finite State Machine (FSM):** All multi-step field operations (visits, inspections, collections) must be modeled as strict FSMs where every transition persists state immediately to Room DB before updating UI.
- **Offline Action Queue Pattern:** All field submissions must be appended to an immutable `action_queue` table locally before network dispatch. WorkManager handles idempotent delivery with retry backoff and deduplication.
- **Geofenced Arrival Verification:** Machine work requires explicit geofence confirmation ("I've Arrived") with anti-mock GPS detection before unlocking service forms, logging any supervisor-authorized manual bypasses.
- **Zero-Data-Loss Camera Pipeline:** Photos must be committed to application private storage and referenced in Room before memory-intensive transformations (watermarking, compression) take place.

