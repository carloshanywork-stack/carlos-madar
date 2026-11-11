# MADAR V2 — Real-Time Rep Sync, Auto-Removal, and Exclusive Machine Locking

**Status:** Proposed design
**Date:** 2026-11-11
**Scope:** `madar-v2` representative API, PWA/browser client, standalone Capacitor Android APK, SQLite schema

---

## 1. Executive summary

The three requirements should be implemented on the existing **SQLite + Express + durable `operations_events` + SSE** stack, not Firebase and not a second real-time database.

The central change is a new **rep work-state table keyed by `maintenance_cards.id`**:

- `available` — visible on the active route, no lock.
- `in_progress` — exclusively locked by one representative/device with a server-authoritative lease.
- `submitted` — a completed visit is waiting for supervisor review; hidden from every representative's active list immediately.
- `approved` — approved by the supervisor; hidden from the active list and kept in the completed/history view.
- `reshoot` — supervisor requested new photos; visible again on the active route.

`maintenance_cards.status` is **not** reused for this. Its current `CHECK` only allows `pending`, `completed`, and `excluded`, and changing its meaning would break review, export, and legacy behavior. The new table is additive and does not rewrite card history.

Real-time transport remains **SSE**:

- Browser/PWA already uses `GET /api/rep/events` with durable replay and `Last-Event-ID`.
- Standalone Android needs a small native SSE client because its `CapacitorHttp` transport does not proxy `EventSource`. A native plugin/service will consume the same endpoint and emit the same event objects into the WebView.
- SSE is one-way. Client actions remain ordinary authenticated HTTP requests. This is sufficient and avoids the operational cost and cloud dependency of Firebase or a separate WebSocket server.

The lock is a **lease**:

- Default TTL: 180 seconds.
- Heartbeat: every 45 seconds while the machine sheet is open.
- Server time is authoritative.
- An expired lock can be stolen atomically by the next representative; the old owner is notified on its next heartbeat/upload.
- Offline work is still possible, but the final upload must acquire or prove a valid lock. A conflict never deletes the representative's photos.

---

## 2. What exists today

### 2.1 Route behavior

`server/modules/rep/service.js` → `getRepTodayRoute()`:

- Selects cards by `maintenance_order_reps.user_id = rep.id`.
- Includes orders in `in_progress`, `review`, or archived today.
- Excludes deleted cards, excluded cards, inactive/deleted machines, and deleted clients.
- Computes `isCompleted` from the latest review (`approved`), with a legacy photo/audit fallback.
- Computes `isSubmitted` from the latest review not being `reshoot`.
- Keeps submitted cards in the response with `canVisit: false`.

That last behavior is exactly what requirement 1 changes.

### 2.2 Visit ingestion

`syncRepVisit()` currently:

1. Normalizes the visit and validates 3 Before photos and up to 3 After photos.
2. Computes a payload hash.
3. Finds the card and validates order assignment, region, machine state, correction state, and geofence.
4. Reserves a `rep_visits` row (`receiving`).
5. Writes photos to staging/final storage.
6. Calls `recordReceivedVisit()` in an `IMMEDIATE` transaction.
7. Returns `pending_review`, `approved`, or `reshoot_requested`.

The lock check must happen **before photo I/O** and be **re-validated and consumed inside `recordReceivedVisit()`** so two simultaneous uploads cannot both win.

### 2.3 Real-time

`server/modules/operations-events.js`:

- Persists events in `operations_events`.
- Fans out in-process to subscribers.
- Keeps the last 10,000 events.
- Supports `recipientUserIds` and `userId` filtering.

`server/modules/rep/routes.js` → `GET /events`:

- Streams `text/event-stream`.
- Replays after `Last-Event-ID`.
- Heartbeats every 25 seconds.
- Filters by recipient.

`client/src/modules/rep/RepApp.jsx`:

- Uses `EventSource` in the browser.
- Skips `EventSource` when the native app uses an HTTPS API base URL, because `CapacitorHttp` does not proxy it.
- Falls back to a 25-second route refresh.
- Already handles assignment, visit review, location review, and attendance events.

The native gap is the main reason requirement 2 is not “instant” on the standalone APK today.

### 2.4 Existing native queues

`RepLocalStore` (Android SQLite, currently DB v3) stores:

- `pending_visits`
- `pending_machine_actions`
- attendance actions
- GPS samples

`MadarSyncWorker` uploads visits and machine actions. A lock/conflict state must be added without deleting queued photos.

---

## 3. Requirements mapped to design

| Requirement | Design |
|---|---|
| Submitted machine disappears instantly for all reps | On successful `syncRepVisit`, transaction sets work state to `submitted`. Active route excludes `submitted`/`approved`. SSE `rep.card.state` tells every assigned rep immediately. |
| Real-time UI updates while multiple reps view the same region/folder | SSE event `rep.card.state` for lock, release, submit, approve, and reshoot. Browser uses `EventSource`; Android uses a native SSE plugin. 25-second polling remains the fallback. |
| Opening a machine locks it as “In Progress” | `POST /api/rep/cards/:cardId/lock` creates/renews an `in_progress` lease tied to user + device. Opening the sheet is blocked until this succeeds. |
| Second rep is blocked and notified | Lock endpoint returns HTTP 409 with `code: CARD_LOCKED` and owner details. Client shows an Arabic dialog and updates the card badge. |
| No duplicate submission | Lock is consumed atomically in the same SQLite transaction that completes the visit. A second upload gets 409 or an idempotent replay if it is the same `visitUuid`. |
| Offline field work remains usable | Offline visit is queued locally. Upload path acquires/refreshes the lock before sending. Conflict preserves photos and marks the queue item `conflicted`. |
| Zero-cloud constraint | No Firebase, no cloud push, no external realtime database. |

---

## 4. Architecture decisions

### D1 — Keep SSE; add a native SSE client for Android

**Decision:** SSE over the existing `/api/rep/events`.

Why:

- The server already has durable replay, recipient filtering, heartbeat, and a single-process fan-out.
- Client-to-server actions are already HTTP; bidirectional WebSocket is unnecessary.
- Firebase violates the zero-cloud requirement and would create two sources of truth.
- SSE reconnects automatically in the browser; native needs one OkHttp `EventSource` wrapper.

**Constraint:** PM2 runs one forked process. The in-process fan-out and SQLite assume a single app instance. If MADAR ever scales to multiple API processes, this design needs a shared event bus (for example Redis or Postgres `NOTIFY`). That is out of scope and should be documented as a deployment constraint.

### D2 — New `rep_card_work_state` table, not `maintenance_cards.status`

`maintenance_cards.status` remains the legacy card lifecycle (`pending` → `completed` on approval). Work state is a separate, additive projection that can be rebuilt from visits/reviews.

Benefits:

- No destructive migration and no change to the existing `CHECK`.
- Review/export/legacy queries keep working.
- State can be backfilled and audited independently.
- We can add `version` for optimistic client updates.

### D3 — Lock scope: card/work item, with a machine-level advisory

Default lock key: `card_id`.

Reasons:

- The route is a list of cards, and one machine can legitimately appear on more than one maintenance order.
- Locking `maintenance_cards.status` would conflate work state with approval state.
- Card-level locking is the smallest change that satisfies “same machine file” in the current UI.

If the product wants strict “one rep per physical machine at a time,” add a partial unique index on `machine_id` for active locks, or change the lock key to `machine_id`. That is a product decision, not a schema blocker. The schema keeps `machine_id` on every row so this can be enforced later.

### D4 — Server-authoritative lease, no long-held SQLite transaction during file I/O

- Acquire/release/heartbeat are short `IMMEDIATE` transactions.
- File staging happens outside any lock transaction.
- The final transaction re-checks the token and consumes the lock.
- Expiry is lazy: `acquire` can steal an expired lock; `heartbeat`/`submit` accept the token if nobody stole it.
- A periodic sweeper is optional and only for cleanup/telemetry, not correctness.

### D5 — Hide on submit; keep a completed/history view

The active route hides `submitted` and `approved` immediately. The existing “completed” tab is served from a separate `view=completed` request so the payload stays small and the default active list is correct even for older clients.

### D6 — Offline draft is allowed; offline final submission is not authoritative

A representative can open a cached machine while offline and prepare/capture photos. The upload path must acquire a lock when connectivity returns. If another representative submitted first:

- The upload returns 409 `CARD_LOCKED` or `CARD_ALREADY_SUBMITTED`.
- The local queue item is marked `conflicted`.
- Photos and notes are preserved for export/manual resolution.
- The app tells the representative that the machine was processed by someone else.

This is the only honest behavior under intermittent connectivity. The alternative—allowing offline submissions to overwrite each other—violates exclusivity.

---

## 5. Data model

### 5.1 `rep_card_work_state`

```sql
CREATE TABLE IF NOT EXISTS rep_card_work_state (
  card_id INTEGER PRIMARY KEY REFERENCES maintenance_cards(id) ON DELETE CASCADE,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  state TEXT NOT NULL DEFAULT 'available'
    CHECK (state IN ('available', 'in_progress', 'submitted', 'approved', 'reshoot')),

  lock_token TEXT,
  locked_by_user_id INTEGER REFERENCES users(id),
  locked_by_name TEXT,
  locked_device_id TEXT,
  lock_acquired_at TEXT,
  lock_expires_at_ms INTEGER,
  last_heartbeat_at TEXT,

  submitted_visit_id INTEGER REFERENCES rep_visits(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  state_changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CHECK (
    (state = 'in_progress'
      AND lock_token IS NOT NULL
      AND locked_by_user_id IS NOT NULL
      AND lock_expires_at_ms IS NOT NULL)
    OR
    (state <> 'in_progress'
      AND lock_token IS NULL
      AND locked_by_user_id IS NULL
      AND lock_expires_at_ms IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_rep_card_work_state_expiry
  ON rep_card_work_state(state, lock_expires_at_ms);
CREATE INDEX IF NOT EXISTS idx_rep_card_work_state_owner
  ON rep_card_work_state(locked_by_user_id, state);
CREATE INDEX IF NOT EXISTS idx_rep_card_work_state_machine
  ON rep_card_work_state(machine_id, state);
```

Notes:

- `lock_expires_at_ms` uses epoch milliseconds to avoid timezone parsing in lease comparisons. Display timestamps remain ISO text.
- `locked_by_name` is a snapshot for the conflict message; the client should not need a user lookup.
- The lock token is never returned in route payloads or logs. It is returned only from acquire/heartbeat.
- `version` increments on every state transition and is included in SSE events so clients can ignore out-of-order frames.

### 5.2 `rep_card_work_events` (domain audit)

```sql
CREATE TABLE IF NOT EXISTS rep_card_work_events (
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES maintenance_cards(id) ON DELETE CASCADE,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  event_type TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users(id),
  old_state TEXT,
  new_state TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rep_card_work_events_card
  ON rep_card_work_events(card_id, created_at, id);
```

`operations_events` is the transport/replay log and is pruned at 10,000 rows. `rep_card_work_events` is the durable domain history for lock/state transitions and admin debugging.

### 5.3 Migration and backfill

Add `migrateRepCardWorkState(database)` in `server/database/init.js`, called after `migrateRepVisitIngestion()`.

```sql
INSERT INTO rep_card_work_state
  (card_id, machine_id, state, submitted_visit_id, version, state_changed_at, updated_at)
SELECT
  card.id,
  card.machine_id,
  CASE
    WHEN latest.review_status = 'approved' THEN 'approved'
    WHEN latest.review_status = 'pending'  THEN 'submitted'
    WHEN latest.review_status = 'reshoot'  THEN 'reshoot'
    WHEN card.status = 'completed'         THEN 'approved'
    ELSE 'available'
  END,
  latest.visit_id,
  0,
  COALESCE(latest.reviewed_at, latest.created_at, CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM maintenance_cards card
LEFT JOIN (
  SELECT visit.card_id, visit.id AS visit_id, review.status AS review_status,
         review.reviewed_at, visit.created_at
  FROM rep_visits visit
  JOIN rep_visit_reviews review ON review.visit_id = visit.id
  WHERE visit.status = 'completed'
    AND visit.id = (
      SELECT newer.id
      FROM rep_visits newer
      WHERE newer.card_id = visit.card_id AND newer.status = 'completed'
      ORDER BY datetime(newer.created_at) DESC, newer.id DESC
      LIMIT 1
    )
) latest ON latest.card_id = card.id
WHERE card.deleted_at IS NULL
ON CONFLICT(card_id) DO NOTHING;
```

Migration rules:

- Record `repCardWorkStateMigration` in `schema_migrations`.
- Wrap the DDL, backfill, and migration marker in one transaction.
- `CREATE TABLE IF NOT EXISTS` makes the migration safe on fresh and existing installs.
- Do not update `maintenance_cards` and do not rewrite `rep_visits`.
- Cards with no completed visit become `available`.
- Cards completed through the legacy `maintenance_cards.status = 'completed'` path become `approved`.
- `submitted` is derived from the latest pending review, matching the current `getRepTodayRoute` ordering.

Also add the tables to `server/database/schema.sql` for fresh installs so schema integrity tests can assert their shape.

---

## 6. State machine

```
                    lock (TTL)
   available ─────────────────────► in_progress
       ▲                                │
       │ release / expiry / force-unlock│
       └────────────────────────────────┘
                                        │ submit (consume lock)
                                        ▼
                                    submitted
                                        │
                         approve ───────┴─────── reshoot
                            │                        │
                            ▼                        ▼
                        approved                  reshoot
                            │                        │
                            │                        │ lock + submit again
                            └──────────────► submitted
```

Rules:

- `available` → `in_progress`: acquire.
- `in_progress` → `available`: release, expiry steal, logout, or admin force-unlock.
- `in_progress` → `submitted`: successful visit ingestion.
- `submitted` → `approved`: supervisor approval.
- `submitted` → `reshoot`: supervisor requests new photos.
- `reshoot` → `in_progress`: acquire for a new visit.
- `approved` is terminal for the daily route.
- `submitted`, `approved`, and active `in_progress` are not lockable by another representative.
- `reshoot` is lockable again.

Derived “blocked” conditions are **not** stored in this table:

- card excluded/deleted
- order archived/deleted
- machine inactive/deleted
- correction pending
- visit row currently `receiving`

Those are checked by the lock/submit SQL every time. This avoids a second source of truth that can drift when an admin resolves a correction.

---

## 7. API contracts

All endpoints are under `/api/rep`, require an active rep session, and validate that the card is on the rep’s assigned route.

### 7.1 Acquire lock

```http
POST /api/rep/cards/:cardId/lock
Content-Type: application/json

{
  "deviceId": "install-uuid",
  "clientInstanceId": "session-uuid"
}
```

Success `200` or `201`:

```json
{
  "success": true,
  "lock": {
    "cardId": 42,
    "state": "in_progress",
    "token": "0f5c...",
    "acquiredAt": "2026-11-11T09:30:00.000Z",
    "expiresAt": "2026-11-11T09:33:00.000Z",
    "version": 12,
    "owner": { "userId": 7, "name": "أحمد" },
    "isMine": true
  }
}
```

Conflict `409`:

```json
{
  "error": "هذه الماكينة قيد المعالجة بواسطة مندوب آخر.",
  "code": "CARD_LOCKED",
  "lock": {
    "cardId": 42,
    "state": "in_progress",
    "acquiredAt": "2026-11-11T09:30:00.000Z",
    "expiresAt": "2026-11-11T09:33:00.000Z",
    "owner": { "userId": 9, "name": "سامي" },
    "isMine": false
  }
}
```

Other structured errors:

| HTTP | `code` | Meaning |
|---|---|---|
| 403 | `CARD_NOT_ASSIGNED` | Card/order is not assigned to this rep or is outside the rep’s regions. |
| 404 | `CARD_NOT_FOUND` | Card does not exist or is deleted. |
| 409 | `CARD_NOT_AVAILABLE` | Card is submitted, approved, excluded, archived, or has a pending correction. |
| 409 | `CARD_UPLOAD_IN_PROGRESS` | A `rep_visits` row for this card is `receiving`; a previous upload is still being processed. |
| 409 | `LOCKED_ON_ANOTHER_DEVICE` | Same rep, different device. |

### 7.2 Heartbeat

```http
POST /api/rep/cards/:cardId/lock/heartbeat
Content-Type: application/json

{ "lockToken": "0f5c..." }
```

Success:

```json
{
  "success": true,
  "lock": {
    "cardId": 42,
    "expiresAt": "2026-11-11T09:36:00.000Z",
    "version": 12,
    "isMine": true
  }
}
```

If the token is no longer the active owner, `409 LOCK_LOST` with the current owner (or `state: available`).

Heartbeat may renew an expired lease **only if the token still matches and nobody stole it**. This lets a client recover from a short network gap without blocking other reps forever.

### 7.3 Release

```http
POST /api/rep/cards/:cardId/unlock
Content-Type: application/json

{ "lockToken": "0f5c..." }
```

Success:

```json
{ "success": true, "released": true, "state": "available", "version": 13 }
```

Idempotent: releasing an already-available card returns `released: false`, not an error.

### 7.4 Work state read (reconciliation)

```http
GET /api/rep/cards/:cardId/work-state
```

Returns state, owner, expiry, version, and `canVisit` for the current rep. Used on app resume and after a lost SSE connection.

### 7.5 Admin force unlock

```http
POST /api/maintenance/cards/:cardId/force-unlock
Content-Type: application/json

{ "reason": "المندوب غادر الموقع" }
```

Admin-only. Records the previous owner and reason in `rep_card_work_events` and `audit_log`, releases the lease, and publishes `rep.card.state` with `state: available` to the order’s reps.

### 7.6 Route views

```http
GET /api/rep/today-route?view=active       # default
GET /api/rep/today-route?view=completed    # submitted + approved
GET /api/rep/today-route?view=all          # both
```

`view=active` returns cards in `available`, `in_progress`, and `reshoot`.

- `in_progress` cards remain visible with `canVisit: false` and a `lock` object so other reps can see who is working and why the card is disabled.
- `submitted` and `approved` cards are absent.
- `summary` is always computed over all states, so progress still moves after a card disappears.

`view=completed` returns `submitted` and `approved` cards for the history tab.

Backward compatibility:

- No `view` parameter means `active`.
- Older APKs will simply stop seeing submitted cards, which is the desired behavior.
- Older APKs will still upload; the server can auto-acquire a lock for a legacy upload (see §9.3).

---

## 8. Real-time event contract

### 8.1 Event type

```json
{
  "id": 12345,
  "type": "rep.card.state",
  "cardId": 42,
  "machineId": 7,
  "machineCode": "1434",
  "orderId": 3,
  "regionName": "المنطقة الشرقية",
  "state": "in_progress",
  "previousState": "available",
  "version": 12,
  "owner": { "userId": 7, "name": "أحمد" },
  "lockExpiresAt": "2026-11-11T09:33:00.000Z",
  "recipientUserIds": [7, 9, 12],
  "occurredAt": "2026-11-11T09:30:00.000Z"
}
```

`recipientUserIds` is the list of `maintenance_order_reps.user_id` for the card’s order. This is exactly the set of reps who can see the card. Do not broadcast to every rep in the database.

Events to publish:

| Event | When | State |
|---|---|---|
| `rep.card.state` | lock acquired/renewed | `in_progress` |
| `rep.card.state` | lock released/expired/force-unlocked | `available` |
| `rep.card.state` | visit submitted | `submitted` |
| `rep.card.state` | supervisor approved | `approved` |
| `rep.card.state` | supervisor requested reshoot | `reshoot` |
| `rep.card.state` | correction/location review changes availability | derived `available`/`blocked` hint |

Do not publish heartbeats. They would flood the 10,000-event replay log.

### 8.2 Durable publish after commit

Current `publishOperationsEvent()` inserts and fans out in one call. For lock transitions, split it:

```js
// operations-events.js
export function stageOperationsEvent(type, details, database = db) {
  // INSERT ... RETURNING event_id
  // returns the frozen event object, does not notify subscribers
}

export function broadcastOperationsEvent(event) {
  for (const listener of subscribers) {
    try { listener(event); } catch { subscribers.delete(listener); }
  }
}

export function publishOperationsEvent(type, details, database = db) {
  const event = stageOperationsEvent(type, details, database);
  broadcastOperationsEvent(event);
  return event;
}
```

Then:

```js
const transactionResult = database.transaction(() => {
  const state = consumeLockAndSubmit(...);
  const event = stageOperationsEvent('rep.card.state', payload, database);
  return { state, event };
}).immediate();

broadcastOperationsEvent(transactionResult.event);
```

This guarantees the event is in the replay log if the business transaction commits, and subscribers never see an event for a rollback.

### 8.3 SSE endpoint changes

`GET /api/rep/events` already supports recipients and replay. Keep it. Add:

- `Cache-Control: private, no-cache, no-transform` (already present).
- `X-Accel-Buffering: no` (already present).
- Heartbeat 25 seconds (already present).
- A `retry: 3000` hint (already present).
- Optional `event: operations` (already used).
- A comment frame `: connected` after headers for proxies that need an immediate flush.

No new endpoint is required.

---

## 9. Server logic

### 9.1 Authorization helper

```js
function findRepLockableCard(rep, cardId, database = db) {
  const card = database.prepare(`
    SELECT card.id AS card_id, card.order_id, card.machine_id, card.status AS card_status,
      card.deleted_at AS card_deleted_at,
      order_record.status AS order_status, order_record.deleted_at AS order_deleted_at,
      machine.code AS machine_code, machine.name_ar AS machine_name_ar,
      machine.area AS machine_area, machine.active AS machine_active,
      machine.deleted_at AS machine_deleted_at,
      client.deleted_at AS client_deleted_at,
      EXISTS (
        SELECT 1 FROM machine_correction_requests correction
        WHERE correction.machine_id = machine.id AND correction.status = 'pending'
      ) AS correction_pending,
      EXISTS (
        SELECT 1 FROM rep_visits visit
        WHERE visit.card_id = card.id AND visit.status = 'receiving'
      ) AS upload_in_progress
    FROM maintenance_cards card
    JOIN maintenance_orders order_record ON order_record.id = card.order_id
    JOIN machines machine ON machine.id = card.machine_id
    JOIN clients client ON client.id = order_record.client_id
    WHERE card.id = ? AND card.deleted_at IS NULL
  `).get(cardId);

  if (!card || card.card_deleted_at || card.order_deleted_at || card.machine_deleted_at
      || card.client_deleted_at) {
    throw new HttpError(404, 'Card not found.');
  }
  if (!card.machine_active || card.card_status === 'excluded' || card.order_status === 'archived') {
    throw new HttpError(409, 'This card is no longer available.');
  }
  if (card.correction_pending) {
    throw new HttpError(409, 'A wrong-machine report is awaiting review.');
  }
  if (!database.prepare(`
    SELECT 1 FROM maintenance_order_reps WHERE order_id = ? AND user_id = ?
  `).get(card.order_id, rep.id)) {
    throw new HttpError(403, 'This order is not assigned to your account.');
  }
  if (!hasUniversalAccess(rep.assignedRegions)) {
    const assigned = new Set(rep.assignedRegions.map(regionKey));
    if (!assigned.has(regionKey(card.machine_area))) {
      throw new HttpError(403, 'This machine is outside your assigned regions.');
    }
  }
  if (card.upload_in_progress) {
    throw new HttpError(409, 'A visit upload is already in progress for this card.');
  }
  return card;
}
```

### 9.2 Acquire lock

```js
export function acquireRepCardLock(rep, cardIdInput, input, database = db) {
  const cardId = positiveId(cardIdInput, 'cardId');
  const body = requireObject(input);
  allowOnlyKeys(body, ['deviceId', 'clientInstanceId']);
  const deviceId = requireText(body.deviceId, 'deviceId', { maxLength: 120 });
  const clientInstanceId = requireText(body.clientInstanceId, 'clientInstanceId', { maxLength: 120 });
  const card = findRepLockableCard(rep, cardId, database);

  const now = Date.now();
  const token = randomUUID();
  const expiresAt = now + LOCK_TTL_MS;

  const result = database.transaction(() => {
    const current = database.prepare(`
      SELECT * FROM rep_card_work_state WHERE card_id = ?
    `).get(cardId);

    // Fresh installs or a card created after the migration.
    if (!current) {
      database.prepare(`
        INSERT INTO rep_card_work_state
          (card_id, machine_id, state, lock_token, locked_by_user_id, locked_by_name,
           locked_device_id, lock_acquired_at, lock_expires_at_ms, last_heartbeat_at, version)
        VALUES (?, ?, 'in_progress', ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(cardId, card.machine_id, token, rep.id, rep.fullName ?? rep.username,
        deviceId, new Date(now).toISOString(), expiresAt, new Date(now).toISOString());
      return { acquired: true, previousState: 'available', version: 1 };
    }

    if (current.state === 'submitted' || current.state === 'approved') {
      throw new HttpError(409, 'This card has already been submitted.');
    }

    const sameOwner = Number(current.locked_by_user_id) === Number(rep.id);
    const sameDevice = current.locked_device_id === deviceId;
    const active = current.state === 'in_progress'
      && Number(current.lock_expires_at_ms) > now;

    if (active && !(sameOwner && sameDevice)) {
      const error = new HttpError(409, 'This machine is being processed by another representative.');
      error.code = sameOwner ? 'LOCKED_ON_ANOTHER_DEVICE' : 'CARD_LOCKED';
      error.details = {
        lock: {
          cardId,
          state: 'in_progress',
          owner: { userId: Number(current.locked_by_user_id), name: current.locked_by_name },
          acquiredAt: current.lock_acquired_at,
          expiresAt: new Date(Number(current.lock_expires_at_ms)).toISOString(),
          isMine: sameOwner,
        },
      };
      throw error;
    }

    // Same owner+device is an idempotent re-open. Expired locks are stolen atomically.
    const version = Number(current.version) + 1;
    database.prepare(`
      UPDATE rep_card_work_state
      SET state = 'in_progress', lock_token = ?, locked_by_user_id = ?, locked_by_name = ?,
          locked_device_id = ?, lock_acquired_at = ?, lock_expires_at_ms = ?,
          last_heartbeat_at = ?, version = ?, state_changed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE card_id = ? AND version = ?
    `).run(token, rep.id, rep.fullName ?? rep.username, deviceId,
      new Date(now).toISOString(), expiresAt, new Date(now).toISOString(),
      version, cardId, current.version);

    return {
      acquired: true,
      previousState: current.state,
      version,
    };
  }).immediate();

  const event = stageOperationsEvent('rep.card.state', {
    cardId,
    machineId: Number(card.machine_id),
    machineCode: card.machine_code,
    orderId: Number(card.order_id),
    regionName: card.machine_area,
    state: 'in_progress',
    previousState: result.previousState,
    version: result.version,
    owner: { userId: Number(rep.id), name: rep.fullName ?? rep.username },
    lockExpiresAt: new Date(expiresAt).toISOString(),
    recipientUserIds: repOrderRecipientIds(card.order_id, database),
  }, database);
  broadcastOperationsEvent(event);

  return {
    success: true,
    lock: {
      cardId,
      state: 'in_progress',
      token,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      version: result.version,
      owner: { userId: Number(rep.id), name: rep.fullName ?? rep.username },
      isMine: true,
    },
  };
}
```

Important concurrency detail: the `UPDATE ... WHERE version = ?` plus `BEGIN IMMEDIATE` serializes competing acquires. If two reps race, one updates and the other re-reads inside its own transaction and sees the active lock.

### 9.3 Submit integration

`syncRepVisit(rep, input, files, options)` gains a `lockToken` option. The route passes `req.get('x-madar-lock-token')`.

Before photo I/O:

```js
const initialCard = findRepVisitCard(rep, visit, database);
assertRepCardSubmitAllowed(rep, initialCard, lockToken, database);
```

`assertRepCardSubmitAllowed`:

```js
function assertRepCardSubmitAllowed(rep, card, lockToken, database) {
  const work = database.prepare('SELECT * FROM rep_card_work_state WHERE card_id = ?')
    .get(card.card_id);

  if (work?.state === 'submitted' || work?.state === 'approved') {
    throw new HttpError(409, 'This card has already been submitted.');
  }
  if (work?.state === 'in_progress') {
    const isOwner = Number(work.locked_by_user_id) === Number(rep.id);
    const tokenMatches = lockToken && work.lock_token === lockToken;
    if (!isOwner || !tokenMatches) {
      const error = new HttpError(409, 'This machine is being processed by another representative.');
      error.code = 'CARD_LOCKED';
      error.details = { lock: publicLock(work) };
      throw error;
    }
  }
  // No lock row or state available/reshoot: legacy upload path is allowed.
}
```

Inside `recordReceivedVisit()` (same `IMMEDIATE` transaction that completes the visit):

```js
function consumeLockAndSubmit(rep, cardId, visitId, lockToken, database) {
  const work = database.prepare('SELECT * FROM rep_card_work_state WHERE card_id = ?')
    .get(cardId);

  // Already submitted by the same visit: idempotent replay.
  if (work?.state === 'submitted' && Number(work.submitted_visit_id) === Number(visitId)) {
    return { state: 'submitted', version: Number(work.version), idempotent: true };
  }

  if (work?.state === 'submitted' || work?.state === 'approved') {
    throw new HttpError(409, 'This card has already been submitted.');
  }

  if (work?.state === 'in_progress') {
    const tokenMatches = lockToken && work.lock_token === lockToken
      && Number(work.locked_by_user_id) === Number(rep.id);
    if (!tokenMatches) {
      const error = new HttpError(409, 'This machine is being processed by another representative.');
      error.code = 'CARD_LOCKED';
      error.details = { lock: publicLock(work) };
      throw error;
    }
  }

  // Atomic consume. The WHERE clause is the final race guard.
  const update = database.prepare(`
    UPDATE rep_card_work_state
    SET state = 'submitted', lock_token = NULL, locked_by_user_id = NULL,
        locked_by_name = NULL, locked_device_id = NULL, lock_acquired_at = NULL,
        lock_expires_at_ms = NULL, last_heartbeat_at = NULL,
        submitted_visit_id = ?, version = version + 1,
        state_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE card_id = ?
      AND state IN ('available', 'reshoot', 'in_progress')
      AND (state <> 'in_progress' OR lock_token = ?)
  `).run(visitId, cardId, lockToken ?? '');

  if (update.changes !== 1) {
    throw new HttpError(409, 'The card changed while the visit was uploading. Refresh and try again.');
  }

  const next = database.prepare('SELECT * FROM rep_card_work_state WHERE card_id = ?').get(cardId);
  return { state: 'submitted', version: Number(next.version) };
}
```

Notes:

- The update allows `available`/`reshoot` without a token for legacy clients. This is intentional during rollout. Once all clients send a token, tighten the WHERE clause with an env flag.
- If the card is in `in_progress` by the same rep but the token is missing, reject; the rep must reopen/heartbeat.
- `visitId` is the `rep_visits.id` reserved earlier.
- The visit row is completed in the same transaction. If the lock update fails, the transaction rolls back, and the existing catch block marks the visit `failed` and cleans files.

After the transaction commits, stage and broadcast:

```js
const event = stageOperationsEvent('rep.card.state', {
  cardId: card.card_id,
  machineId: card.machine_id,
  machineCode: card.machine_code,
  orderId: card.order_id,
  regionName: card.machine_area,
  state: 'submitted',
  previousState: 'in_progress',
  version: result.version,
  owner: null,
  lockExpiresAt: null,
  recipientUserIds: repOrderRecipientIds(card.order_id, database),
}, database);
broadcastOperationsEvent(event);
```

The route currently publishes `rep.visit.submitted` after `syncRepVisit`. Keep it for supervisor/analytics, but add `cardId`, `machineId`, `recipientUserIds`, and `state` so clients can use either event. The canonical client event is `rep.card.state`.

### 9.4 Route filtering

Add a `LEFT JOIN rep_card_work_state work ON work.card_id = card.id` and select:

```sql
work.state AS work_state,
work.locked_by_user_id AS lock_user_id,
work.locked_by_name AS lock_user_name,
work.lock_expires_at_ms AS lock_expires_at_ms,
work.version AS work_version
```

Filtering:

```sql
AND (
  :view = 'all'
  OR (:view = 'active' AND COALESCE(work.state, 'available') NOT IN ('submitted', 'approved'))
  OR (:view = 'completed' AND COALESCE(work.state, 'available') IN ('submitted', 'approved'))
)
```

Mapping per card:

```js
const workState = row.work_state ?? 'available';
const lockActive = workState === 'in_progress'
  && Number(row.lock_expires_at_ms) > Date.now();
const isLockedByOther = lockActive
  && Number(row.lock_user_id) !== Number(rep.id);

const isCompleted = workState === 'approved';
const isSubmitted = workState === 'submitted' || workState === 'approved';
const canVisit = row.order_status !== 'archived'
  && !isCompleted
  && !isSubmitted
  && !correctionPending
  && !isLockedByOther
  && workState !== 'in_progress';

const lock = workState === 'in_progress' ? {
  userId: Number(row.lock_user_id),
  name: row.lock_user_name,
  expiresAt: new Date(Number(row.lock_expires_at_ms)).toISOString(),
  isMine: Number(row.lock_user_id) === Number(rep.id),
  expired: !lockActive,
} : null;
```

The route response adds:

```json
{
  "workState": "in_progress",
  "lock": { "userId": 9, "name": "سامي", "expiresAt": "...", "isMine": false, "expired": false },
  "canVisit": false
}
```

`summary` counts:

- `totalMachines`: all cards in the rep’s assigned scope, including submitted/approved.
- `completed`: `approved`.
- `pendingReview`: `submitted`.
- `pending`: `totalMachines - completed` (keep the current meaning for backward compatibility).
- Add `active`: cards with `available`/`reshoot`/`in_progress`.

### 9.5 Review integration

`server/modules/supervisor/service.js` → `reviewRepVisit()`:

- Fetch the work row in the same transaction.
- If `state === 'submitted'` and `submitted_visit_id !== visitId`, reject `409 STALE_VISIT` (a newer visit is active).
- On approve: update work state to `approved`, set `submitted_visit_id = visitId`, increment `version`, keep `maintenance_cards.status = 'completed'`.
- On reshoot: update work state to `reshoot`, keep `submitted_visit_id` for history, increment `version`.
- Return `cardId` and `machineId` for both actions (currently only approve returns `cardId`).
- `supervisor/routes.js` stages and broadcasts `rep.card.state` with recipients after the transaction.

### 9.6 Expiry and cleanup

No correctness-critical sweeper is required:

- `acquire` steals an expired active lock.
- `heartbeat` renews if the token still matches.
- `submit` accepts the token if nobody stole it.
- Route treats an expired `in_progress` lock as not blocking (`expired: true`, `canVisit: true`) so another rep can acquire it.

Add an optional interval (60 seconds, `unref()`) for:

- Publishing `rep.card.state` with `state: available` for locks expired more than 15 minutes.
- Deleting `rep_card_work_events` older than 365 days if retention is desired.
- Logging counts of active/expired locks.

Do not rely on the sweeper for concurrency correctness.

### 9.7 Error payload support

`HttpError` currently only carries `status` and `message`, and `errorHandler` only emits `{ error }`.

Extend both:

```js
export class HttpError extends Error {
  constructor(status, message, { code = null, details = null } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
```

```js
res.status(status).json({
  error: ...,
  ...(error.code ? { code: error.code } : {}),
  ...(error.details && status < 500 ? error.details : {}),
});
```

This is backward-compatible: existing clients still read `error`.

---

## 10. Client logic (browser and standalone)

### 10.1 Open machine

```js
const deviceId = getOrCreateDeviceId(); // localStorage, random UUID per install

async function openMachine(machine) {
  if (openingCardId) return; // double-tap guard
  if (machine.workState === 'in_progress' && machine.lock && !machine.lock.isMine) {
    showLockedDialog(machine.lock);
    return;
  }

  setOpeningCardId(machine.cardId);
  try {
    const result = await api.post(`/api/rep/cards/${machine.cardId}/lock`, {
      deviceId,
      clientInstanceId: getClientInstanceId(),
    }, { timeoutMs: 8000 });

    setActiveLock({
      cardId: machine.cardId,
      token: result.lock.token,
      expiresAt: result.lock.expiresAt,
      version: result.lock.version,
    });
    setSelectedMachine({ ...machine, ...result.lock, workState: 'in_progress' });
    setRoute((current) => applyLockToCard(current, result.lock));
  } catch (error) {
    if (error.code === 'CARD_LOCKED' || error.code === 'LOCKED_ON_ANOTHER_DEVICE') {
      showLockedDialog(error.lock);
      setRoute((current) => applyLockToCard(current, error.lock));
    } else if (error.code === 'CARD_NOT_AVAILABLE' || error.code === 'CARD_UPLOAD_IN_PROGRESS') {
      setToast(error.message);
      void refreshData();
    } else {
      setToast(error.message || 'تعذر فتح الماكينة. تحقق من الاتصال وحاول مجدداً.');
    }
  } finally {
    setOpeningCardId(null);
  }
}
```

The sheet must not render until `activeLock.token` exists. This is the “status immediately becomes In Progress” guarantee.

### 10.2 Heartbeat

```js
useEffect(() => {
  if (!activeLock) return undefined;
  let stopped = false;

  const beat = async () => {
    try {
      const result = await api.post(
        `/api/rep/cards/${activeLock.cardId}/lock/heartbeat`,
        { lockToken: activeLock.token },
        { timeoutMs: 8000 },
      );
      if (!stopped) {
        setActiveLock((current) => current ? {
          ...current,
          expiresAt: result.lock.expiresAt,
          version: result.lock.version,
        } : current);
      }
    } catch (error) {
      if (stopped) return;
      if (error.code === 'LOCK_LOST' || error.status === 409) {
        setLockLost(true);
        setToast('انتهت جلسة العمل على هذه الماكينة. أُغلقت للقراءة فقط؛ لم تُفقد صورك المحفوظة.');
      }
    }
  };

  const timer = window.setInterval(beat, 45_000);
  return () => { stopped = true; window.clearInterval(timer); };
}, [activeLock]);
```

On `LOCK_LOST`:

- Keep the sheet visible in read-only mode so the rep can export notes/photos if needed.
- Disable submit.
- Offer “إعادة فتح الماكينة” which calls `openMachine` again; if another rep owns it, show the conflict dialog.

### 10.3 Close and submit

```js
async function closeMachine() {
  const lock = activeLock;
  setSelectedMachine(null);
  setActiveLock(null);
  setLockLost(false);
  if (!lock) return;
  try {
    await api.post(`/api/rep/cards/${lock.cardId}/unlock`, { lockToken: lock.token }, { timeoutMs: 5000 });
  } catch {
    // Lease expiry is the fallback. Do not block closing the UI.
    queuePendingLockRelease(lock); // optional IndexedDB queue, flushed on reconnect
  }
}
```

Submit:

1. Upload with `X-Madar-Lock-Token: activeLock.token`.
2. On success (`pending_review`):
   - `removeCardFromActiveRoute(cardId)`.
   - `clearActiveLock()`.
   - Close sheet, show toast.
   - Refresh `view=completed` if the history tab is open.
3. On `CARD_LOCKED`/`CARD_ALREADY_SUBMITTED`:
   - Keep the draft and photos locally.
   - Mark the queued visit `conflicted`.
   - Show the owner and a clear message.
4. On network error:
   - Queue as today, storing `lockToken` and `lockExpiresAt` on the queued visit.
   - The drain worker will refresh/heartbeat the lock before upload or acquire a new one.

### 10.4 Event handling

Refactor the existing `onOperationsEvent` into one shared function used by both transports.

```js
function handleOperationsEvent(event) {
  if (event.type === 'rep.card.state') {
    const knownVersion = cardVersionsRef.current.get(event.cardId) ?? -1;
    if (Number(event.version) <= knownVersion) return;
    cardVersionsRef.current.set(event.cardId, Number(event.version));

    if (event.state === 'submitted' || event.state === 'approved') {
      removeCardFromActiveRoute(event.cardId);
      addCardToCompletedCache(event); // if the completed tab is loaded
      if (selectedMachine?.cardId === event.cardId) closeSheetReadOnly(event);
      setToast(event.state === 'approved'
        ? `اعتمد المشرف الماكينة ${event.machineCode}.`
        : `رُفعت الماكينة ${event.machineCode} وبانتظار المراجعة.`);
      return;
    }

    if (event.state === 'in_progress') {
      setRoute((current) => applyRemoteLock(current, event));
      if (selectedMachine?.cardId === event.cardId
          && Number(event.owner?.userId) !== userId) {
        closeSheetReadOnly(event);
      }
      return;
    }

    if (event.state === 'available' || event.state === 'reshoot') {
      setRoute((current) => applyRemoteState(current, event));
      if (event.state === 'reshoot') {
        setToast(`أعاد المشرف فتح الماكينة ${event.machineCode} لالتقاط صور جديدة.`);
      }
      // The card may not be in the local cache; ask the server once.
      if (!routeHasCard(routeRef.current, event.cardId)) scheduleRouteRefresh();
    }
    return;
  }

  // Existing assignment, review, location, attendance handling.
  if (event.type === 'maintenance.order.assigned') { ... }
  if (event.type === 'rep.visit.reviewed') { ... }
  if (event.type === 'rep.machine.location-reviewed') { ... }
  if (event.type === 'attendance.changed') { ... }
}
```

`applyRemoteLock`:

- Sets `workState: 'in_progress'`.
- Sets `lock` from the event.
- Sets `canVisit: false` for anyone except the owner (the owner may still be in the sheet).
- Updates the card badge to “🔒 قيد المعالجة · {name}”.
- Does not reorder the card; the server order is stable.

`removeCardFromActiveRoute`:

- Removes the card from `route.regions`.
- Recomputes `summary` locally.
- Does not remove it from the completed cache.

### 10.5 Transport selection

```js
useEffect(() => {
  if (offlineOnly || serverState !== 'online') return undefined;

  if (nativeApp) {
    let handle;
    void startNativeEventStream().then((h) => { handle = h; });
    const listener = addNativeEventListener((event) => handleOperationsEvent(event));
    return () => {
      listener.remove();
      void stopNativeEventStream();
    };
  }

  if (apiUrl('/api').startsWith('https://')) return undefined; // old native fallback
  const events = new EventSource(apiUrl('/api/rep/events'), { withCredentials: true });
  events.addEventListener('operations', (message) => {
    try { handleOperationsEvent(JSON.parse(message.data)); } catch {}
  });
  return () => events.close();
}, [nativeApp, offlineOnly, serverState]);
```

Keep the 25-second `refreshData()` poll as a safety net. If the native stream is connected, the poll can be relaxed to 60 seconds, but do not remove it: it repairs gaps after process death, network changes, and proxy timeouts.

### 10.6 Route tabs

- `remaining` / default: `view=active`.
- `completed`: fetch `view=completed` on first use, then keep it updated from `rep.card.state`.
- `all`: optional; if kept, fetch `view=all` and accept a larger payload. The recommended UI is “المتبقية” + “المكتملة” only.

The current `visitSubmitted()` helper treats submitted and approved as completed. Keep it for the completed tab only.

---

## 11. Android native design

### 11.1 Native SSE plugin

Add `com.squareup.okhttp3:okhttp-sse:4.12.0` to `android/app/build.gradle`.

New plugin methods, either on `RepNativeEnginePlugin` or a dedicated `RepEventsPlugin`:

```java
@PluginMethod public void start(PluginCall call) { ... }
@PluginMethod public void stop(PluginCall call) { ... }
@PluginMethod public void status(PluginCall call) { ... }
```

Behavior:

- Read `RepAuthStore.token(context)`.
- Build `GET {REP_SERVER_URL}/api/rep/events` with `Authorization: Bearer ...`.
- Add `Last-Event-ID` from `SharedPreferences`.
- Use `EventSources.createFactory(okHttpClient).newEventSource(request, listener)`.
- On `onEvent`, parse JSON, persist `event.id`, and `notifyListeners("operations", json)`.
- On `onFailure`, emit a `status` event (`reconnecting`/`unauthorized`) and retry with exponential backoff (1s, 2s, 5s, 15s, 30s, jitter).
- On `onOpen`, emit `status: connected`.
- On `onClosed`, emit `status: disconnected`.
- On HTTP 401, do not loop forever; notify JS so the existing auth-expired flow can run.

`native-bridges.js`:

```js
export async function startNativeEventStream() {
  if (!isNativeRepApp()) return null;
  return RepEvents.start();
}
export async function stopNativeEventStream() {
  if (!isNativeRepApp()) return;
  return RepEvents.stop();
}
export function addNativeEventListener(listener) {
  return RepEvents.addListener('operations', listener);
}
```

### 11.2 Foreground vs background

Requirement 2 is about users viewing the app. The minimal correct implementation is an app-scoped SSE connection while the WebView/app is active.

For “real-time while the phone is in the representative’s pocket,” add a foreground service:

- `RepRealtimeService`, `foregroundServiceType="dataSync"`.
- Start when the rep clocks in or when the app is in the foreground and on duty.
- Stop on clock-out/logout.
- Persistent notification: “MADAR — تحديثات الميدان مباشرة”.
- Manifest permissions: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `POST_NOTIFICATIONS` (Android 13+ runtime).
- Do not start a second connection if the service is already running.

This is best-effort. Android can still kill the process. True background wakeups require FCM (cloud) and are out of scope for the zero-cloud deployment. WorkManager’s 15-minute sync remains the durable fallback.

### 11.3 Native lock and conflict handling

`RepLocalStore` DB version 4 (additive migration):

- `pending_visits`: add `lock_token TEXT`, `lock_expires_at_ms INTEGER`, `conflict_code TEXT`, `conflict_message TEXT`, `conflict_at TEXT`.
- Status values: add `conflicted` (or keep `blocked` with `conflict_code` set; a distinct status is easier to surface).
- `pending_visits` index on `(repId, status, createdAt)`.

`MadarSyncWorker` before upload:

```java
Long cardId = visit.payload.optLong("cardId", 0);
String token = store.lockToken(visit.visitUuid);

if (token == null || store.lockExpiresAt(visit.visitUuid) <= now + 30_000) {
  LockResult lock = lockClient.acquire(cardId, deviceId);
  if (lock.conflict) {
    store.markConflicted(visit.visitUuid, lock.code, lock.message);
    notifyRepresentative(lock.message);
    continue; // do not delete photos
  }
  token = lock.token;
  store.saveLock(visit.visitUuid, token, lock.expiresAt);
}

if (store.lockExpiresAt(visit.visitUuid) <= now + 30_000) {
  lockClient.heartbeat(cardId, token); // refresh before the multipart upload
}

Request upload = new Request.Builder()
  .url(baseUrl + "/api/rep/sync-visit")
  .header("X-Madar-Lock-Token", token)
  .post(multipart.build())
  .build();
```

On `409 CARD_LOCKED` / `CARD_ALREADY_SUBMITTED`:

- `markConflicted(...)`.
- Keep the visit and photos.
- Post a local notification: “الماكينة {code} عالجها مندوب آخر. لم تُفقد صورك.”
- Do not auto-retry forever. The rep can view the conflict, export it, or delete it after confirmation.

On `409 LOCK_LOST`:

- Clear the stored token.
- Try one re-acquire.
- If re-acquire conflicts, mark `conflicted`.

On network/5xx:

- Keep the lock token and retry later.
- If the token expires, re-acquire on the next attempt.

### 11.4 Native lock client

A small `RepLockClient` using the same OkHttp client/token:

```java
POST {base}/api/rep/cards/{cardId}/lock
{ "deviceId": ..., "clientInstanceId": ... }

POST {base}/api/rep/cards/{cardId}/lock/heartbeat
{ "lockToken": ... }
```

Do not put the lock token in the visit JSON; it is transport metadata and must not change the payload hash.

### 11.5 Foreground upload path

For browser/PWA and the JS drain queue:

- Store `lockToken` and `lockExpiresAt` on the queued visit when submitting online.
- Before `api.upload('/api/rep/sync-visit', formData)`, if the token is missing/expired, call the lock endpoint.
- Send the token in the `X-Madar-Lock-Token` header.
- On `409`, mark the queued visit `blocked`/`conflicted` and show the owner message.
- Never delete the queued visit or photos on a conflict.

---

## 12. Concurrency and edge cases

### 12.1 Two reps open at the same time

Both requests enter `BEGIN IMMEDIATE`; one inserts/updates, the other sees the active lock and gets 409. SQLite serializes writers. No application-level mutex is required.

### 12.2 Lock expires while the sheet is open

Heartbeat every 45 seconds prevents this. If the phone sleeps and the lease expires:

- Another rep can acquire.
- The first rep’s next heartbeat gets `LOCK_LOST`.
- The sheet becomes read-only; submit is disabled.
- The rep can re-open if the machine is still available, or export the draft.

### 12.3 Submit after the lease expired but before another rep steals it

Allowed if the token still matches. The token is proof of ownership; the expiry only decides whether another rep may steal. This avoids losing a long upload due to a missed heartbeat.

### 12.4 Submit after another rep steals

The token no longer matches; `consumeLockAndSubmit` returns 409 `CARD_LOCKED`. The visit transaction rolls back; the catch block marks the visit `failed` and cleans staged files. The client keeps its local queue copy and photos.

### 12.5 Duplicate upload / idempotent retry

`rep_visits.visit_uuid` is unique and the payload hash is checked. If the visit is already `completed`:

- Same rep, same payload → idempotent success, no second lock consumption.
- Different rep or different payload → 409.

If the card is already `submitted` by the same `visitId`, `consumeLockAndSubmit` is idempotent.

### 12.6 Same rep on two devices

- Same `deviceId`: re-acquire returns a fresh token and extends the lease (idempotent).
- Different `deviceId`: 409 `LOCKED_ON_ANOTHER_DEVICE` with `isMine: true`. The second device shows “الماكينة مفتوحة على جهازك الآخر.”
- This prevents two phones from editing the same card simultaneously.

### 12.7 App killed / phone dies

The lease expires. Another rep can steal it. No manual cleanup is required. The old device’s next request gets `LOCK_LOST`.

### 12.8 Offline second rep

The second rep can prepare a draft from the cached route. On upload, the server rejects if the first rep submitted or still holds a valid lock. The app marks the queue item `conflicted` and preserves the photos. “Instant” removal cannot apply to an offline device until it reconnects; this is a physical limitation, not a design gap.

### 12.9 Supervisor approves while the card is locked

Approval only applies to a `submitted` visit. A locked `in_progress` card has no pending review. If a stale approval arrives, the `STALE_VISIT` check rejects it.

### 12.10 Reshoot

On `reshoot`, state becomes `reshoot`, the card reappears on the active route, and the lock is free. The original rep and other assigned reps can acquire it, depending on the product decision in §16.

### 12.11 Correction pending

`findRepLockableCard` rejects with `CARD_NOT_AVAILABLE`. When the correction is resolved, the card becomes lockable again without a work-state mutation.

### 12.12 Multiple cards for the same machine

Card-level lock means two different cards for the same machine can be locked by different reps. If the product wants strict machine exclusivity, add:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_card_work_state_machine_lock
  ON rep_card_work_state(machine_id)
  WHERE state = 'in_progress';
```

and acquire by `machine_id` instead of `card_id`. This is a product decision; see §16.

### 12.13 Server restart

Locks persist in SQLite. On startup:

- Do not clear active locks.
- Optionally mark locks expired more than 15 minutes as `available` and publish events.
- Clients reconnect SSE and call `refreshData()`; heartbeats resume.

### 12.14 SSE replay gap

If `Last-Event-ID` is older than the retained 10,000 events, the server returns the oldest available events. The client should detect a large gap (for example, event IDs jumping by more than 1,000) and force `refreshData()`. Always refresh on app resume and on `visibilitychange`.

### 12.15 Time zones

Leases use epoch milliseconds and `Date.now()` on the server. Display strings use ISO UTC. SQLite `CURRENT_TIMESTAMP` remains UTC for audit columns. Do not compare local business-day strings to lease timestamps.

---

## 13. Security and audit

- Use the authenticated rep session; never trust a `userId` from the body.
- Validate order assignment and region on every lock/heartbeat/unlock/submit.
- Lock tokens are 128-bit random UUIDs, returned only to the owner, never logged, never included in route payloads.
- Rate-limit lock attempts (for example, 60 per rep per minute) and heartbeats (for example, 120 per rep per minute) with a small in-memory limiter. Single-process deployment makes this sufficient.
- `recipientUserIds` must be derived server-side from `maintenance_order_reps`, never from the client.
- Do not expose other reps’ personal data beyond `full_name`, which is already visible in assignment UI.
- Record lock/state transitions in `rep_card_work_events` with actor, old/new state, timestamp, and metadata (device ID, token fingerprint—not the token).
- Record submit/approve/reshoot in `audit_log` as today. Lock events are high-volume; keep them in the domain table.
- Admin force-unlock requires a reason and writes both tables.
- The existing `/api/rep/events` endpoint must continue to filter by recipient. A lock event must never be broadcast to unassigned reps.

---

## 14. Observability

Add structured logs (no tokens):

```
rep.lock.acquired card=42 rep=7 device=ab12 expires=...
rep.lock.conflict card=42 rep=9 owner=7
rep.lock.released card=42 rep=7 reason=close
rep.lock.expired card=42 owner=7
rep.card.submitted card=42 rep=7 visit=...
rep.card.approved card=42 visit=...
rep.card.reshoot card=42 visit=...
```

Admin-only diagnostics:

```http
GET /api/maintenance/rep-locks?state=in_progress
```

Returns card, machine, owner, acquired/expiry, and age. Optional admin UI column “قيد المعالجة بواسطة”.

Health:

- `/api/health` can include `realtimeSubscribers` (in-process count) and `activeLocks` (SQL count) without leaking user data.
- Log SSE connect/disconnect at debug level, not per heartbeat.

---

## 15. Tests

### 15.1 Schema/migration

- `migration.test.js`: seed cards with no visit, pending review, approved review, reshoot review, legacy completed card; run `initializeDatabase`; assert states and `submitted_visit_id`.
- `schema-integrity.test.js`: assert the new table, check constraints, and indexes.
- Idempotency: run the migration twice; no duplicate rows, no errors.

### 15.2 Lock API

- Acquire on an assigned available card → 200, state `in_progress`, token present.
- Second rep acquires → 409 `CARD_LOCKED` with owner name and expiry.
- Same rep same device acquires again → 200, idempotent/renewed.
- Same rep different device → 409 `LOCKED_ON_ANOTHER_DEVICE`.
- Heartbeat with the right token extends expiry.
- Heartbeat with a stale token after a steal → 409 `LOCK_LOST`.
- Release → 200; another rep can acquire.
- Release twice → idempotent.
- Unassigned rep → 403.
- Archived order, excluded card, inactive machine, pending correction → 409.
- `receiving` visit → 409 `CARD_UPLOAD_IN_PROGRESS`.
- Expired lock can be stolen; old token cannot submit.

### 15.3 Submit/auto-removal

- Rep A locks and submits; response `pending_review`.
- Active route for A and B does not contain the card.
- Completed view contains it with `workState: submitted`.
- B’s active route does not contain it.
- `rep.card.state` event is emitted to both assigned reps.
- Duplicate upload with the same `visitUuid` → idempotent success.
- Different visit for a submitted card → 409.
- Supervisor approves → state `approved`; active route still hides; completed view shows approved.
- Supervisor requests reshoot → state `reshoot`; active route for A/B contains the card; lock can be acquired again.
- Lock is released/cleared on submit; no stale token remains.

### 15.4 SSE

- Two reps connect to `/api/rep/events`.
- Lock by A produces one event for A and B, none for an unassigned rep.
- Event is replayable with `Last-Event-ID`.
- Heartbeat is not persisted as an event.
- Submit event includes `cardId`, `machineId`, `state`, `version`, and recipients.
- Disconnect/reconnect replays missed events.

### 15.5 Concurrency

- Fire two lock requests in parallel with `Promise.all`; exactly one 200 and one 409.
- Fire lock and submit in parallel; no lost update.
- Force an expired lease, steal, then submit with the old token → 409.

### 15.6 Client

- `npm run build` (Vite) passes.
- Manual browser test with two sessions:
  - Both see the same active card.
  - A opens → B sees “قيد المعالجة” within one SSE frame.
  - B taps → conflict dialog with A’s name.
  - A closes → B can open after the release event.
  - A submits → card disappears from B’s active list without refresh.
  - B’s completed tab shows it after fetching `view=completed`.
- Verify the 25-second polling fallback still removes the card if SSE is blocked.

### 15.7 Android

- `android-packaging.test.js` remains green.
- Manual device test:
  - Native SSE connects; Events log shows `operations`.
  - Lock acquired from the APK; second device gets conflict.
  - Airplane mode: prepare a visit, queue it, reconnect, lock is acquired, upload succeeds.
  - Race: A queues offline, B submits online, A reconnects → A’s visit is marked `conflicted`, photos remain.
  - App killed while sheet open → lock expires; another rep can acquire.
  - Foreground service notification appears on duty (if implemented).
- Check `version.properties` remains the version source and the APK has no embedded `server.url`.

### 15.8 Regression

- Existing `rep-api.test.js` tests that expect submitted cards in the route must be updated to the new `view` semantics.
- Existing supervisor approval/reshoot tests must still pass.
- Attendance, GPS, corrections, and location review tests must not change.
- Full suite: `npm test` (currently 105 tests), `npm run check`, `npm run build`.

---

## 16. Product decisions required

These are the decisions that change behavior. Recommended defaults are listed first.

### 16.1 Hide on submit vs hide on approval

**Recommendation:** hide on **submit** (requirement 1). Keep it in `view=completed` as “بانتظار الاعتماد”.

If the business wants submitted cards to remain visible until approval, change the active filter to hide only `approved` and show `submitted` with a “بانتظار المراجعة” badge. The rest of the design is unchanged.

### 16.2 Lock scope: card vs physical machine

**Recommendation:** card-level for v1, because the route is card-based and one machine can have multiple maintenance orders.

If the business wants “only one rep at the physical machine,” enable the machine-level unique partial index in §12.12. This blocks a second card for the same machine while one is `in_progress`.

### 16.3 Lock lease and heartbeat

**Recommendation:** 180-second TTL, 45-second heartbeat, token valid for submit even if the lease just expired and nobody stole it.

Shorter TTL (60–120s) frees abandoned locks faster but is more sensitive to background throttling. Longer TTL (5–10 min) is more forgiving but blocks other reps longer after a crash.

### 16.4 Same rep, second device

**Recommendation:** block with `LOCKED_ON_ANOTHER_DEVICE`. One rep should not edit the same card from two phones. Allow re-entry only from the same `deviceId`.

### 16.5 Offline opening

**Recommendation:** allow a read-only/draft view from the cached route, but do not show the machine as “In Progress” on the server until a lock is acquired. The upload path acquires the lock when online. A conflict preserves the draft and photos.

Strict alternative: block opening entirely when offline. This is simpler but hurts field usability.

### 16.6 Background real-time

**Recommendation:** app-scoped real-time plus an optional data-sync foreground service while on duty. No cloud push.

If the business requires immediate notifications when the app is killed, that requires FCM or another push service, which conflicts with the zero-cloud requirement. Escalate before promising it.

### 16.7 Reshoot visibility

**Recommendation:** show `reshoot` to all reps assigned to the order, not only the original rep. If accountability requires the original rep, add `assigned_rep_user_id` to the work state and filter the route.

### 16.8 Region-level shared pool

**Recommendation:** keep the current `maintenance_order_reps` visibility. “All representatives” means all reps assigned to the same order/card, not every rep in the region.

If the business wants any rep in a region to see any machine in that region, that is a separate assignment/pool feature and should not be mixed into the locking change.

---

## 17. Phased rollout

### Phase 0 — Schema and read-only projection

- Add `rep_card_work_state` and `rep_card_work_events`.
- Backfill from existing visits/reviews.
- Add `workState`/`lock` fields to the route without changing filtering.
- Add tests for migration and schema.
- No behavior change; safe to deploy.

### Phase 1 — Auto-removal and real-time events

- Filter `submitted`/`approved` out of `view=active`.
- Add `view=completed`.
- Publish `rep.card.state` on submit/approve/reshoot.
- Add client event handling and completed-tab fetch.
- Add native SSE plugin and transport selection.
- Keep 25-second polling.
- This delivers requirements 1 and 2 for online clients.

### Phase 2 — Exclusive locking

- Add lock/heartbeat/unlock/work-state endpoints.
- Add client open/close/heartbeat/conflict UI.
- Lock is **advisory** for legacy uploads: no token still works if the card is available, but a valid lock held by another rep blocks.
- Add admin force-unlock.
- Add concurrency tests.
- This delivers requirement 3.

### Phase 3 — Native offline conflict handling

- `RepLocalStore` v4 with lock/conflict fields.
- `MadarSyncWorker` acquires/heartbeats before upload.
- `conflicted` queue UI and local notification.
- Foreground data-sync service (optional).
- This closes the field/offline gap.

### Phase 4 — Enforcement and cleanup

- After adoption is confirmed (app version telemetry), require `X-Madar-Lock-Token` on `sync-visit` for new clients via `REP_REQUIRE_LOCK_TOKEN=true`.
- Add lock metrics/admin diagnostics.
- Decide whether to enable machine-level locking.
- Add retention for `rep_card_work_events`.

Feature flags:

```
REP_CARD_LOCKS_ENABLED=true
REP_REQUIRE_LOCK_TOKEN=false        # true after all APKs are upgraded
REP_LOCK_TTL_SECONDS=180
REP_LOCK_SCOPE=card                 # card | machine (future)
```

Keep defaults conservative. A server restart should not break old clients.

---

## 18. File-by-file change list

### Server

- `server/database/init.js`
  - Add `migrateRepCardWorkState(database)`.
  - Call it after `migrateRepVisitIngestion(database)`.
  - Add optional cleanup/expiry interval.
- `server/database/schema.sql`
  - Add the two tables and indexes for fresh installs.
- `server/modules/rep/work-state.js` (new)
  - `findRepLockableCard`
  - `acquireRepCardLock`
  - `heartbeatRepCardLock`
  - `releaseRepCardLock`
  - `consumeLockAndSubmit`
  - `getRepCardWorkState`
  - `repOrderRecipientIds`
  - `publicLock`
  - `publishRepCardState`
- `server/modules/rep/service.js`
  - `getRepTodayRoute`: join/filter/select work state, `view` parameter, lock fields, summary counts.
  - `syncRepVisit`: accept `lockToken`; validate before photo I/O; pass to `recordReceivedVisit`.
  - `recordReceivedVisit`: call `consumeLockAndSubmit` inside the existing `IMMEDIATE` transaction.
- `server/modules/rep/routes.js`
  - `POST /cards/:cardId/lock`
  - `POST /cards/:cardId/lock/heartbeat`
  - `POST /cards/:cardId/unlock`
  - `GET /cards/:cardId/work-state`
  - Read `view` in `/today-route`.
  - Pass `X-Madar-Lock-Token` to `syncRepVisit`.
  - Add `recipientUserIds` to correction/location events.
- `server/modules/operations-events.js`
  - `stageOperationsEvent` + `broadcastOperationsEvent`.
- `server/modules/supervisor/service.js`
  - Update work state on approve/reshoot.
  - Return `cardId`/`machineId`; add stale-visit guard.
- `server/modules/supervisor/routes.js`
  - Publish `rep.card.state` after review.
- `server/modules/maintenance/routes.js`
  - Admin force-unlock and optional lock list.
- `server/modules/http.js` and `server/middleware/error-handler.js`
  - Structured `code`/`details`.

### Client

- `client/src/modules/rep/RepApp.jsx`
  - `openMachine`, `closeMachine`, heartbeat, lock-lost read-only state.
  - `handleOperationsEvent` shared by SSE/native.
  - `applyRemoteLock`, `removeCardFromActiveRoute`, completed cache.
  - Tab/view fetching.
  - Upload header and conflict handling.
- `client/src/modules/rep/native-bridges.js`
  - Native SSE start/stop/listener methods.
- `client/src/modules/rep/offline-store.js`
  - Store `lockToken`/`lockExpiresAt` on queued visits.
  - Optional `pending_lock_releases` store (DB version bump).
- `client/src/modules/rep/MachineVisitSheet` (wherever defined)
  - Disable submit on lock loss.
  - Show owner/conflict message.
  - Preserve draft.

### Android

- `android/app/build.gradle`
  - Add `okhttp-sse`.
- `android/app/src/main/AndroidManifest.xml`
  - Add `RepRealtimeService` and foreground-service permissions (if background phase is enabled).
- `android/app/src/main/java/com/madar/rep/app/RepNativeEnginePlugin.java`
  - Register SSE plugin methods/events.
- New `RepEventStreamPlugin.java` / `RepRealtimeService.java` (or extend the existing plugin).
- `android/app/src/main/java/com/madar/rep/app/RepLocalStore.java`
  - DB v4: lock/conflict columns and status.
- `android/app/src/main/java/com/madar/rep/app/MadarSyncWorker.java`
  - Acquire/heartbeat lock before upload; handle 409; mark `conflicted`.
- `android/app/src/main/java/com/madar/rep/app/RepLockClient.java` (new)
  - Lock/heartbeat HTTP client.

### Tests/docs

- `test/rep-api.test.js`
- `test/operations-events.test.js`
- `test/migration.test.js`
- `test/schema-integrity.test.js`
- `test/android-packaging.test.js` (source-level checks for the new native classes)
- `FIELD_REP_MOBILE_ROADMAP.md` (status update after implementation)
- `ANDROID_PACKAGING.md` (native SSE/service permissions and release notes)

---

## 19. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Lock lease expires during a long upload | Heartbeat before upload; token still valid for submit if nobody stole it; keep photos locally. |
| Android kills the app/SSE | 25-second polling fallback; WorkManager 15-minute sync; refresh on resume. |
| SSE proxy buffering/timeouts | `X-Accel-Buffering: no`, 25-second heartbeat, `retry: 3000`, test through Tailscale Funnel. |
| Old APKs break when locks are enforced | Advisory lock phase; `REP_REQUIRE_LOCK_TOKEN=false` until adoption; legacy uploads auto-acquire. |
| Two reps on the same physical machine via different cards | Product decision; optional machine-level unique index. |
| Event log grows/prunes | Heartbeats are not events; 10k retention; domain audit in `rep_card_work_events`. |
| Clock skew | Server epoch milliseconds; client only displays server expiry. |
| SQLite writer contention | Short `IMMEDIATE` transactions; no file I/O inside transactions; `busy_timeout=5000` already set. |
| Duplicate visit upload | Unique `visit_uuid` + payload hash + idempotent lock consumption. |
| Admin force-unlock abuse | Reason required, audit trail, admin-only, event published. |
| Photos lost on conflict | Never delete on 409; mark `conflicted`; export path remains. |

---

## 20. Definition of done

- [ ] Migration/backfill runs on a copy of the production DB without changing IDs or history.
- [ ] Active route hides submitted/approved cards for every assigned rep.
- [ ] Completed view still shows submitted/approved cards.
- [ ] Lock acquire/heartbeat/release works for two simultaneous browser sessions.
- [ ] Second rep gets a clear Arabic conflict message with the owner’s name.
- [ ] Submit consumes the lock atomically; duplicate upload is idempotent.
- [ ] Reshoot reopens the card and allows a new lock.
- [ ] SSE events reach all assigned reps and replay after reconnect.
- [ ] Standalone APK receives events via native SSE (foreground), with polling fallback.
- [ ] Offline queued visit conflicts preserve photos and show `conflicted`.
- [ ] Admin force-unlock is audited.
- [ ] `npm test`, `npm run check`, `npm run build`, and `android-packaging.test.js` pass.
- [ ] Two-device manual test passes on the Tailscale Funnel URL.
- [ ] No Firebase, no cloud storage, no embedded `server.url` in the APK.
