package com.madar.rep.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Native SQLite cache and durable queue. Source photos live under filesDir/MADAR/uploads. */
final class RepLocalStore extends SQLiteOpenHelper {
    private static final String DATABASE_NAME = "madar_rep_local.db";
    private static final int DATABASE_VERSION = 4;

    RepLocalStore(Context context) {
        super(context.getApplicationContext(), DATABASE_NAME, null, DATABASE_VERSION);
        setWriteAheadLoggingEnabled(true);
    }

    @Override
    public void onCreate(SQLiteDatabase database) {
        database.execSQL("CREATE TABLE machines (rep_id INTEGER NOT NULL, machine_id INTEGER NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY(rep_id, machine_id))");
        database.execSQL("CREATE TABLE fault_reasons (rep_id INTEGER NOT NULL, reason_id INTEGER NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY(rep_id, reason_id))");
        database.execSQL("CREATE TABLE route_snapshots (rep_id INTEGER PRIMARY KEY, route_json TEXT NOT NULL, cached_at TEXT NOT NULL)");
        database.execSQL("CREATE TABLE pending_visits (visit_uuid TEXT PRIMARY KEY, rep_id INTEGER NOT NULL, rep_username TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)");
        database.execSQL("CREATE INDEX pending_visits_by_rep_status_created ON pending_visits(rep_id, status, created_at)");
        database.execSQL("CREATE TABLE visit_photos (visit_uuid TEXT NOT NULL REFERENCES pending_visits(visit_uuid) ON DELETE CASCADE, phase TEXT NOT NULL, photo_index INTEGER NOT NULL, path TEXT NOT NULL, captured_at TEXT NOT NULL, PRIMARY KEY(visit_uuid, phase, photo_index))");
        createAttendanceQueue(database);
        createMachineActionQueue(database);
        createRecoveryImportLedger(database);
    }

    @Override
    public void onUpgrade(SQLiteDatabase database, int oldVersion, int newVersion) {
        if (oldVersion < 2) createAttendanceQueue(database);
        if (oldVersion < 3) createMachineActionQueue(database);
        if (oldVersion < 4) createRecoveryImportLedger(database);
    }

    private static void createAttendanceQueue(SQLiteDatabase database) {
        database.execSQL("CREATE TABLE IF NOT EXISTS pending_attendance_actions ("
            + "action_uuid TEXT PRIMARY KEY, rep_id INTEGER NOT NULL, action TEXT NOT NULL CHECK (action IN ('in', 'out')), "
            + "payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending_attendance_sync', "
            + "attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)");
        database.execSQL("CREATE INDEX IF NOT EXISTS pending_attendance_by_rep_created "
            + "ON pending_attendance_actions(rep_id, occurred_at, created_at)");
    }

    private static void createMachineActionQueue(SQLiteDatabase database) {
        database.execSQL("CREATE TABLE IF NOT EXISTS pending_machine_actions ("
            + "action_uuid TEXT PRIMARY KEY, rep_id INTEGER NOT NULL, action_type TEXT NOT NULL "
            + "CHECK (action_type IN ('confirm_location', 'report_correction')), "
            + "machine_id INTEGER NOT NULL, card_id INTEGER NOT NULL, payload_json TEXT NOT NULL, "
            + "evidence_path TEXT NOT NULL DEFAULT '', evidence_content_type TEXT NOT NULL DEFAULT '', "
            + "status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, "
            + "last_error TEXT NOT NULL DEFAULT '', correction_id INTEGER, server_status TEXT NOT NULL DEFAULT '', "
            + "review_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)");
        database.execSQL("CREATE INDEX IF NOT EXISTS pending_machine_actions_by_rep_status "
            + "ON pending_machine_actions(rep_id, status, created_at)");
        database.execSQL("CREATE INDEX IF NOT EXISTS pending_machine_actions_by_card "
            + "ON pending_machine_actions(rep_id, card_id, status)");
    }

    private static void createRecoveryImportLedger(SQLiteDatabase database) {
        database.execSQL("CREATE TABLE IF NOT EXISTS recovery_imports ("
            + "rep_id INTEGER NOT NULL, source_session_id TEXT NOT NULL, item_type TEXT NOT NULL, "
            + "item_id TEXT NOT NULL, identity_hash TEXT NOT NULL, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            + "PRIMARY KEY(rep_id, source_session_id, item_type, item_id))");
    }

    synchronized String recoveryImportHash(long repId, String sourceSessionId, String itemType, String itemId) {
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT identity_hash FROM recovery_imports WHERE rep_id = ? AND source_session_id = ? AND item_type = ? AND item_id = ?",
            new String[] { String.valueOf(repId), sourceSessionId, itemType, itemId })) {
            return cursor.moveToFirst() ? cursor.getString(0) : null;
        }
    }

    synchronized void recordRecoveryImport(long repId, String sourceSessionId, String itemType,
        String itemId, String identityHash) {
        ContentValues values = new ContentValues();
        values.put("rep_id", repId);
        values.put("source_session_id", sourceSessionId);
        values.put("item_type", itemType);
        values.put("item_id", itemId);
        values.put("identity_hash", identityHash);
        getWritableDatabase().insertOrThrow("recovery_imports", null, values);
    }

    synchronized void cacheRoute(long repId, String routeJson) throws Exception {
        JSONObject route = new JSONObject(routeJson);
        JSONArray regions = route.optJSONArray("regions");
        SQLiteDatabase database = getWritableDatabase();
        database.beginTransaction();
        try {
            database.delete("machines", "rep_id = ?", new String[] { String.valueOf(repId) });
            if (regions != null) {
                for (int regionIndex = 0; regionIndex < regions.length(); regionIndex += 1) {
                    JSONObject region = regions.optJSONObject(regionIndex);
                    JSONArray machines = region == null ? null : region.optJSONArray("machines");
                    if (machines == null) continue;
                    for (int machineIndex = 0; machineIndex < machines.length(); machineIndex += 1) {
                        JSONObject machine = machines.optJSONObject(machineIndex);
                        if (machine == null || machine.optLong("machineId", 0L) < 1L) continue;
                        ContentValues values = new ContentValues();
                        values.put("rep_id", repId);
                        values.put("machine_id", machine.optLong("machineId"));
                        values.put("data_json", machine.toString());
                        database.insertWithOnConflict("machines", null, values, SQLiteDatabase.CONFLICT_REPLACE);
                    }
                }
            }
            ContentValues snapshot = new ContentValues();
            snapshot.put("rep_id", repId);
            snapshot.put("route_json", route.toString());
            snapshot.put("cached_at", route.optString("cachedAt", ""));
            database.insertWithOnConflict("route_snapshots", null, snapshot, SQLiteDatabase.CONFLICT_REPLACE);
            database.setTransactionSuccessful();
        } finally {
            database.endTransaction();
        }
    }

    synchronized void cacheReasons(long repId, String reasonsJson) throws Exception {
        JSONObject response = new JSONObject(reasonsJson);
        JSONArray reasons = response.optJSONArray("reasons");
        SQLiteDatabase database = getWritableDatabase();
        database.beginTransaction();
        try {
            database.delete("fault_reasons", "rep_id = ?", new String[] { String.valueOf(repId) });
            if (reasons != null) {
                for (int index = 0; index < reasons.length(); index += 1) {
                    JSONObject reason = reasons.optJSONObject(index);
                    if (reason == null || reason.optLong("id", 0L) < 1L) continue;
                    ContentValues values = new ContentValues();
                    values.put("rep_id", repId);
                    values.put("reason_id", reason.optLong("id"));
                    values.put("data_json", reason.toString());
                    database.insertWithOnConflict("fault_reasons", null, values, SQLiteDatabase.CONFLICT_REPLACE);
                }
            }
            database.setTransactionSuccessful();
        } finally {
            database.endTransaction();
        }
    }

    synchronized JSONObject cachedData(long repId) throws Exception {
        JSONObject result = new JSONObject();
        SQLiteDatabase database = getReadableDatabase();
        try (Cursor cursor = database.rawQuery("SELECT route_json FROM route_snapshots WHERE rep_id = ?", new String[] { String.valueOf(repId) })) {
            if (cursor.moveToFirst()) result.put("route", new JSONObject(cursor.getString(0)));
        }
        JSONArray reasons = new JSONArray();
        try (Cursor cursor = database.rawQuery("SELECT data_json FROM fault_reasons WHERE rep_id = ? ORDER BY reason_id", new String[] { String.valueOf(repId) })) {
            while (cursor.moveToNext()) reasons.put(new JSONObject(cursor.getString(0)));
        }
        result.put("reasons", reasons);
        return result;
    }

    synchronized void assertVisitPhotoEditable(String visitUuid) {
        try(Cursor row=getReadableDatabase().rawQuery("SELECT 1 FROM pending_visits WHERE visit_uuid=? AND status!='synced'",new String[]{visitUuid})) {
            if(row.moveToFirst())throw new IllegalStateException("الصور مرتبطة بزيارة محفوظة للمزامنة؛ أرسل زيارة جديدة عند طلب إعادة التصوير.");
        }
    }

    synchronized void enqueueVisit(Context context, JSONObject visit) throws Exception {
        String visitUuid = visit.getString("visitUuid");
        if (!visitUuid.matches("(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")) {
            throw new IllegalArgumentException("A valid visit UUID is required.");
        }
        long repId = visit.getLong("repId");
        String username = visit.optString("repUsername", "");
        String createdAt = visit.optString("createdAt", "");
        JSONObject payload = visit.getJSONObject("payload");
        JSONArray before = visit.optJSONArray("beforePhotos");
        JSONArray after = visit.optJSONArray("afterPhotos");
        if (before == null || before.length() != 3 || after == null || after.length() > 3) {
            throw new IllegalArgumentException("Exactly three before photos and up to three optional after photos are allowed.");
        }

        List<Photo> photos = new ArrayList<>();
        collectPhotos(context, visitUuid, "before", before, photos);
        collectPhotos(context, visitUuid, "after", after, photos);

        SQLiteDatabase database = getWritableDatabase();
        database.beginTransaction();
        try {
            try (Cursor existing = database.rawQuery("SELECT rep_id, payload_json FROM pending_visits WHERE visit_uuid = ?", new String[] { visitUuid })) {
                if (existing.moveToFirst()) {
                    if (existing.getLong(0) != repId || !existing.getString(1).equals(payload.toString())) {
                        throw new IllegalStateException("This visit UUID already has different local data.");
                    }
                    database.setTransactionSuccessful();
                    return;
                }
            }
            ContentValues row = new ContentValues();
            row.put("visit_uuid", visitUuid);
            row.put("rep_id", repId);
            row.put("rep_username", username);
            row.put("payload_json", payload.toString());
            row.put("status", "pending");
            row.put("created_at", createdAt);
            database.insertOrThrow("pending_visits", null, row);
            for (Photo photo : photos) {
                ContentValues values = new ContentValues();
                values.put("visit_uuid", visitUuid);
                values.put("phase", photo.phase);
                values.put("photo_index", photo.index);
                values.put("path", photo.path);
                values.put("captured_at", photo.capturedAt);
                database.insertOrThrow("visit_photos", null, values);
            }
            database.setTransactionSuccessful();
        } finally {
        database.endTransaction();
    }
}

/** Return true for an identical existing visit; reject changed UUID content before imported bytes are staged. */
synchronized boolean assertVisitImportCompatible(long repId, JSONObject visit) throws Exception {
    String uuid = visit.getString("visitUuid");
    SQLiteDatabase database = getReadableDatabase();
    try (Cursor row = database.rawQuery("SELECT rep_id, payload_json FROM pending_visits WHERE visit_uuid = ?",
        new String[] { uuid })) {
        if (!row.moveToFirst()) return false;
        if (row.getLong(0) != repId || !RepRecoveryValidator.canonical(new JSONObject(row.getString(1))).equals(RepRecoveryValidator.canonical(visit.getJSONObject("payload")))) {
            throw new IllegalStateException("This visit UUID already has different local content.");
        }
}
for (String phase : new String[] { "before", "after" }) {
    JSONArray incoming = visit.optJSONArray("before".equals(phase) ? "beforePhotos" : "afterPhotos");
    if (incoming == null) throw new IllegalArgumentException("Recovery visit photos are missing.");
    try (Cursor saved = database.rawQuery("SELECT photo_index, path, captured_at FROM visit_photos WHERE visit_uuid = ? AND phase = ? ORDER BY photo_index",
        new String[] { uuid, phase })) {
        if (saved.getCount() != incoming.length()) throw new IllegalStateException("This visit UUID already has different local evidence.");
        int position = 0;
        while (saved.moveToNext()) {
            JSONObject photo = incoming.getJSONObject(position++);
            byte[] incomingBytes = android.util.Base64.decode(photo.getString("bytesBase64"), android.util.Base64.DEFAULT);
            if (!saved.getString(2).equals(photo.optString("capturedAt", "")) || !new File(saved.getString(1)).isFile()
                || !java.util.Arrays.equals(incomingBytes, readEvidenceBytes(new File(saved.getString(1))))) {
                throw new IllegalStateException("This visit UUID already has different local evidence.");
            }
        }
        }
    }
    return true;
}

private static void collectPhotos(Context context, String visitUuid, String phase, JSONArray entries, List<Photo> output) throws Exception {
    File uploadsRoot = new File(new File(context.getFilesDir(), "MADAR"), "uploads").getCanonicalFile();
    File legacyDirectory = new File(new File(context.getFilesDir(), "visits"), visitUuid).getCanonicalFile();
    String phaseDirectory = "before".equals(phase) ? "Before" : "After";
        Set<String> seenPaths = new HashSet<>();
        for (int index = 0; index < entries.length(); index += 1) {
            JSONObject entry = entries.getJSONObject(index);
            File photoFile = new File(entry.getString("path")).getCanonicalFile();
            boolean validNewFilename = false;
            for (int slot = 1; slot <= 3; slot += 1) {
                String slotFilename = visitUuid + "_" + String.format(java.util.Locale.US, "%04d", slot) + ".jpg";
                if (slotFilename.equals(photoFile.getName())) validNewFilename = true;
            }
            boolean newLayout = photoFile.getPath().startsWith(uploadsRoot.getPath() + File.separator)
                && phaseDirectory.equals(photoFile.getParentFile().getName())
                && validNewFilename;
            boolean legacyLayout = legacyDirectory.equals(photoFile.getParentFile())
                && photoFile.getPath().startsWith(legacyDirectory.getPath() + File.separator)
                && (phase + "_" + index + ".jpg").equals(photoFile.getName());
            if ((!newLayout && !legacyLayout) || !photoFile.isFile()
                || photoFile.length() < 1L || photoFile.length() > 3L * 1024L * 1024L
                || !seenPaths.add(photoFile.getPath())) {
                throw new IllegalArgumentException("A visit image is missing, outside app storage, or exceeds 3 MiB.");
            }
            // The array order is the rep's visible order; filenames identify stable local slots only.
            output.add(new Photo(phase, index, photoFile.getAbsolutePath(), entry.optString("capturedAt", "")));
        }
    }

    synchronized Visit nextVisit(long repId, Set<Long> excludedCardIds) throws Exception {
        SQLiteDatabase database = getWritableDatabase();
        try (Cursor cursor = database.rawQuery(
            "SELECT visit_uuid, rep_id, payload_json FROM pending_visits WHERE rep_id = ? AND status IN ('pending', 'uploading') ORDER BY created_at ASC LIMIT 500",
            new String[] { String.valueOf(repId) }
        )) {
            while (cursor.moveToNext()) {
                JSONObject candidatePayload = new JSONObject(cursor.getString(2));
                long cardId = candidatePayload.optLong("cardId", 0L);
                if (excludedCardIds != null && cardId > 0L && excludedCardIds.contains(cardId)) continue;
                String uuid = cursor.getString(0);
                List<Photo> photos = new ArrayList<>();
                try (Cursor photoCursor = database.rawQuery(
                    "SELECT phase, photo_index, path, captured_at FROM visit_photos WHERE visit_uuid = ? ORDER BY CASE phase WHEN 'before' THEN 0 ELSE 1 END, photo_index",
                    new String[] { uuid }
                )) {
                    while (photoCursor.moveToNext()) photos.add(new Photo(photoCursor.getString(0), photoCursor.getInt(1), photoCursor.getString(2), photoCursor.getString(3)));
                }
                return new Visit(uuid, cursor.getLong(1), candidatePayload, photos);
            }
            return null;
        }
    }

    synchronized void markUploading(String visitUuid) {
        getWritableDatabase().execSQL("UPDATE pending_visits SET status = 'uploading', attempts = attempts + 1 WHERE visit_uuid = ?", new Object[] { visitUuid });
    }

    synchronized void markRetry(String visitUuid, String error) {
        ContentValues values = new ContentValues();
        values.put("status", "pending");
        values.put("last_error", error == null ? "" : error);
        databaseUpdate(visitUuid, values);
    }

    synchronized void markBlocked(String visitUuid, String error) {
        ContentValues values = new ContentValues();
        values.put("status", "blocked");
        values.put("last_error", error == null ? "" : error);
        databaseUpdate(visitUuid, values);
    }

    synchronized boolean requeueVisit(String visitUuid, long repId) {
        ContentValues values = new ContentValues();
        values.put("status", "pending");
        values.put("last_error", "");
        return getWritableDatabase().update("pending_visits", values,
            "visit_uuid = ? AND rep_id = ? AND status = 'blocked'",
            new String[] { visitUuid, String.valueOf(repId) }) == 1;
    }

    synchronized boolean enqueueAttendanceAction(JSONObject action) throws Exception {
        String actionUuid = action.getString("actionUuid");
        if (!actionUuid.matches("(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")) {
            throw new IllegalArgumentException("A valid attendance action UUID is required.");
        }
        long repId = action.getLong("repId");
        String kind = action.getString("action");
        if (repId < 1L || !("in".equals(kind) || "out".equals(kind))) {
            throw new IllegalArgumentException("The representative and attendance action are invalid.");
        }
        if (!action.optBoolean("biometricVerified", false)) throw new IllegalArgumentException("Device authentication is required.");
        String occurredAt = action.getString("occurredAt");
        if (occurredAt.length() < 20 || !occurredAt.matches("^\\d{4}-\\d{2}-\\d{2}T.*(?:Z|[+-]\\d{2}:?\\d{2})$")) {
            throw new IllegalArgumentException("The attendance timestamp is invalid.");
        }
        JSONObject location = action.optJSONObject("location");
        if (location == null) throw new IllegalArgumentException("A GPS fix is required for attendance.");
        double latitude = location.optDouble("latitude", Double.NaN);
        double longitude = location.optDouble("longitude", Double.NaN);
        double accuracy = location.optDouble("accuracy", Double.NaN);
        if (!Double.isFinite(latitude) || latitude < -90 || latitude > 90
            || !Double.isFinite(longitude) || longitude < -180 || longitude > 180
            || !Double.isFinite(accuracy) || accuracy < 0 || accuracy > 250) {
            throw new IllegalArgumentException("The attendance GPS fix must be accurate to 250 meters or better.");
        }

        SQLiteDatabase database = getWritableDatabase();
        database.beginTransaction();
        try {
            try (Cursor existing = database.rawQuery(
                "SELECT rep_id, payload_json FROM pending_attendance_actions WHERE action_uuid = ?",
                new String[] { actionUuid }
            )) {
                if (existing.moveToFirst()) {
                    if (existing.getLong(0) != repId || !RepRecoveryValidator.canonical(new JSONObject(existing.getString(1))).equals(RepRecoveryValidator.canonical(action))) {
                        throw new IllegalStateException("This attendance action UUID already has different local data.");
                    }
                    database.setTransactionSuccessful();
                    return false;
                }
            }
            ContentValues values = new ContentValues();
            values.put("action_uuid", actionUuid);
            values.put("rep_id", repId);
            values.put("action", kind);
            values.put("payload_json", action.toString());
            values.put("occurred_at", occurredAt);
            values.put("status", "pending_attendance_sync");
            java.text.SimpleDateFormat createdAtFormat = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
            createdAtFormat.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            values.put("created_at", createdAtFormat.format(new java.util.Date()));
            database.insertOrThrow("pending_attendance_actions", null, values);
            database.setTransactionSuccessful();
        } finally {
            database.endTransaction();
        }
        return true;
}

    synchronized AttendanceAction nextAttendanceAction(long repId) throws Exception {
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT action_uuid, rep_id, payload_json, attempts FROM pending_attendance_actions "
                + "WHERE rep_id = ? AND status = 'pending_attendance_sync' ORDER BY occurred_at, created_at LIMIT 1",
            new String[] { String.valueOf(repId) }
        )) {
            if (!cursor.moveToFirst()) return null;
            return new AttendanceAction(cursor.getString(0), cursor.getLong(1), new JSONObject(cursor.getString(2)), cursor.getInt(3));
        }
    }

    synchronized JSONArray listAttendanceActions(long repId) throws Exception {
        JSONArray actions = new JSONArray();
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT action_uuid, payload_json, status, attempts, last_error, created_at "
                + "FROM pending_attendance_actions WHERE rep_id = ? ORDER BY occurred_at, created_at",
            new String[] { String.valueOf(repId) }
        )) {
            while (cursor.moveToNext()) {
                JSONObject action = new JSONObject(cursor.getString(1));
                action.put("payload", new JSONObject(cursor.getString(1)));
                action.put("status", cursor.getString(2));
                action.put("attempts", cursor.getInt(3));
                action.put("lastError", cursor.getString(4));
                action.put("createdAt", cursor.getString(5));
                actions.put(action);
            }
        }
        return actions;
    }

    synchronized void markAttendanceRetry(String actionUuid, String error) {
        getWritableDatabase().execSQL("UPDATE pending_attendance_actions SET attempts = attempts + 1, last_error = ? WHERE action_uuid = ?",
            new Object[] { error == null ? "" : error, actionUuid });
    }

    /**
     * Permanently rejected attendance must not be retried ahead of every later
     * visit. Keep the row and its reason for review while unblocking the worker.
     */
    synchronized void markAttendanceRejected(String actionUuid, String error) {
        getWritableDatabase().execSQL("UPDATE pending_attendance_actions SET status = 'attendance_rejected', "
                + "attempts = attempts + 1, last_error = ? WHERE action_uuid = ?",
            new Object[] { error == null ? "" : error, actionUuid });
    }

    synchronized boolean enqueueMachineAction(Context context, JSONObject action) throws Exception {
        String actionUuid = action.getString("actionUuid");
        if (!actionUuid.matches("(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")) {
            throw new IllegalArgumentException("A valid machine action UUID is required.");
        }
        long repId = action.getLong("repId");
        String type = action.getString("type");
        long machineId = action.getLong("machineId");
        JSONObject payload = action.getJSONObject("payload");
        long cardId = payload.optLong("cardId", 0L);
        if (repId < 1L || machineId < 1L || cardId < 1L
            || !("confirm_location".equals(type) || "report_correction".equals(type))) {
            throw new IllegalArgumentException("The representative, machine, card, or action type is invalid.");
        }
        String createdAt = action.optString("createdAt", "");
        if (createdAt.isEmpty()) {
            java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
            format.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            createdAt = format.format(new java.util.Date());
        }

    String evidencePath = "";
    String evidenceContentType = action.optString("evidenceMimeType", "");
    String evidenceBase64 = action.optString("evidenceBase64", "");
    // Check UUID identity before touching the deterministic evidence filename. A
    // changed retry must never overwrite bytes referenced by an existing row.
    try (Cursor existing = getReadableDatabase().rawQuery(
        "SELECT rep_id, machine_id, card_id, payload_json, evidence_path, evidence_content_type "
            + "FROM pending_machine_actions WHERE action_uuid = ?", new String[] { actionUuid })) {
        if (existing.moveToFirst()) {
            if (existing.getLong(0) != repId || existing.getLong(1) != machineId || existing.getLong(2) != cardId
                || !RepRecoveryValidator.canonical(new JSONObject(existing.getString(3))).equals(RepRecoveryValidator.canonical(payload))
                || !existing.getString(5).equals(evidenceContentType)) {
                throw new IllegalStateException("This machine action UUID already has different local data.");
            }
            String oldPath = existing.getString(4);
            if (evidenceBase64.isEmpty()) {
                if (oldPath != null && !oldPath.isEmpty()) throw new IllegalStateException("This machine action UUID already has different evidence.");
            } else {
                byte[] incoming = android.util.Base64.decode(evidenceBase64, android.util.Base64.DEFAULT);
                if (oldPath == null || oldPath.isEmpty() || !new File(oldPath).isFile()
                    || !java.util.Arrays.equals(incoming, readEvidenceBytes(new File(oldPath)))) {
                    throw new IllegalStateException("This machine action UUID already has different evidence.");
                }
            }
            return false;
        }
    }
    if (!evidenceBase64.isEmpty()) {
        if (!("report_correction".equals(type))) {
            throw new IllegalArgumentException("Only machine correction reports may carry evidence.");
        }
            if (!("image/jpeg".equals(evidenceContentType) || "image/png".equals(evidenceContentType)
                || "image/webp".equals(evidenceContentType))) {
                throw new IllegalArgumentException("Evidence must be a JPEG, PNG, or WebP image.");
            }
            byte[] evidence = android.util.Base64.decode(evidenceBase64, android.util.Base64.DEFAULT);
            if (evidence.length < 1 || evidence.length > 4L * 1024L * 1024L) {
                throw new IllegalArgumentException("Evidence must be between 1 byte and 4 MiB.");
            }
            File directory = new File(new File(context.getFilesDir(), "MADAR"), "machine-actions");
            if (!directory.isDirectory() && !directory.mkdirs()) {
                throw new IllegalStateException("Could not create the machine-action evidence directory.");
            }
            String extension = "image/png".equals(evidenceContentType) ? "png"
                : "image/webp".equals(evidenceContentType) ? "webp" : "jpg";
            File evidenceFile = new File(directory, actionUuid + "_" + RepRecoveryValidator.hash(evidence) + "." + extension).getCanonicalFile();
            if (!evidenceFile.getPath().startsWith(directory.getCanonicalPath() + File.separator)) {
                throw new IllegalArgumentException("Evidence path is outside app storage.");
            }
            RepEvidenceFile.write(evidenceFile, evidence);
            evidencePath = evidenceFile.getAbsolutePath();
        }

        SQLiteDatabase database = getWritableDatabase();
        database.beginTransaction();
        try {
            try (Cursor existing = database.rawQuery(
                "SELECT rep_id, machine_id, card_id, payload_json, evidence_path, evidence_content_type, action_type FROM pending_machine_actions WHERE action_uuid = ?",
                new String[] { actionUuid }
            )) {
                if (existing.moveToFirst()) {
                    if (existing.getLong(0) != repId || existing.getLong(1) != machineId
                        || existing.getLong(2) != cardId || !RepRecoveryValidator.canonical(new JSONObject(existing.getString(3))).equals(RepRecoveryValidator.canonical(payload))) {
                        throw new IllegalStateException("This machine action UUID already has different local data.");
                    }
                    if (!type.equals(existing.getString(6)) || !evidenceContentType.equals(existing.getString(5))
                        || (!evidencePath.isEmpty() && !java.util.Arrays.equals(readEvidenceBytes(new File(evidencePath)),readEvidenceBytes(new File(existing.getString(4)))))
                        || (evidencePath.isEmpty() != existing.getString(4).isEmpty())) {
                        throw new IllegalStateException("This machine action UUID already has different evidence or type.");
                    }
                    database.setTransactionSuccessful();
                    return false;
                }
            }
            ContentValues values = new ContentValues();
            values.put("action_uuid", actionUuid);
            values.put("rep_id", repId);
            values.put("action_type", type);
            values.put("machine_id", machineId);
            values.put("card_id", cardId);
            values.put("payload_json", payload.toString());
            values.put("evidence_path", evidencePath);
            values.put("evidence_content_type", evidenceContentType);
            values.put("status", "queued");
            values.put("created_at", createdAt);
            database.insertOrThrow("pending_machine_actions", null, values);
            database.setTransactionSuccessful();
        } finally {
        database.endTransaction();
    }
    return true;
}

private static byte[] readEvidenceBytes(File file) throws Exception {
    try (java.io.FileInputStream input = new java.io.FileInputStream(file);
         java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        return output.toByteArray();
    }
}

synchronized MachineAction nextMachineAction(long repId) throws Exception {
    try (Cursor cursor = getReadableDatabase().rawQuery(
        "SELECT action_uuid, rep_id, action_type, machine_id, card_id, payload_json, evidence_path, "
            + "evidence_content_type, attempts FROM pending_machine_actions "
                + "WHERE rep_id = ? AND status IN ('queued', 'syncing') ORDER BY created_at, action_uuid LIMIT 1",
            new String[] { String.valueOf(repId) }
        )) {
            if (!cursor.moveToFirst()) return null;
            return new MachineAction(cursor.getString(0), cursor.getLong(1), cursor.getString(2),
                cursor.getLong(3), cursor.getLong(4), new JSONObject(cursor.getString(5)),
                cursor.getString(6), cursor.getString(7), cursor.getInt(8));
        }
    }

    synchronized void markMachineActionSyncing(String actionUuid) {
        getWritableDatabase().execSQL("UPDATE pending_machine_actions SET status = 'syncing', attempts = attempts + 1 WHERE action_uuid = ?",
            new Object[] { actionUuid });
    }

    synchronized void markMachineActionPendingApproval(String actionUuid, long correctionId, String serverStatus) {
        ContentValues values = new ContentValues();
        values.put("status", "pending_approval");
        values.put("correction_id", correctionId);
        values.put("server_status", serverStatus == null ? "" : serverStatus);
    values.put("last_error", "");
    getWritableDatabase().update("pending_machine_actions", values, "action_uuid = ?", new String[] { actionUuid });
}

synchronized boolean updateMachineActionReview(String actionUuid, long repId, String status, long correctionId, String reviewNote) {
    if (!("queued".equals(status) || "pending_approval".equals(status) || "approved".equals(status)
        || "rejected".equals(status) || "blocked".equals(status) || "superseded".equals(status))) {
        throw new IllegalArgumentException("Invalid machine-action review status.");
    }
    ContentValues values = new ContentValues();
    values.put("status", status);
    values.put("correction_id", correctionId);
    values.put("server_status", status);
    values.put("review_note", reviewNote == null ? "" : reviewNote);
    return getWritableDatabase().update("pending_machine_actions", values, "action_uuid = ? AND rep_id = ?",
        new String[] { actionUuid, String.valueOf(repId) }) == 1;
}

synchronized void markMachineActionRetry(String actionUuid, String error) {
    ContentValues values = new ContentValues();
        values.put("status", "queued");
    values.put("last_error", error == null ? "" : error);
    getWritableDatabase().update("pending_machine_actions", values, "action_uuid = ?", new String[] { actionUuid });
}

synchronized boolean retryMachineAction(String actionUuid, long repId) {
    SQLiteDatabase database = getWritableDatabase();
    try (Cursor cursor = database.rawQuery(
        "SELECT rep_id, status, server_status FROM pending_machine_actions WHERE action_uuid = ?",
        new String[] { actionUuid })) {
        if (!cursor.moveToFirst()) return false;
        if (cursor.getLong(0) != repId) throw new SecurityException("This machine action belongs to another representative.");
        if (!"blocked".equals(cursor.getString(1))) throw new IllegalStateException("Only a blocked machine action can be retried.");
        if ("rejected".equalsIgnoreCase(cursor.getString(2))) {
            throw new IllegalStateException("A rejected supervisor decision requires a corrected action with a new UUID.");
        }
    }
    ContentValues values = new ContentValues();
    values.put("status", "queued");
    values.put("last_error", "");
    return database.update("pending_machine_actions", values,
        "action_uuid = ? AND rep_id = ? AND status = 'blocked' AND lower(server_status) != 'rejected'",
        new String[] { actionUuid, String.valueOf(repId) }) == 1;
}

synchronized void restoreMachineActionState(String actionUuid, long repId, JSONObject state) {
    String status = state.optString("status", "queued");
    if (!("queued".equals(status) || "syncing".equals(status) || "blocked".equals(status)
        || "pending_approval".equals(status) || "approved".equals(status)
        || "rejected".equals(status) || "superseded".equals(status))) {
        throw new IllegalArgumentException("Recovery machine-action status is invalid.");
    }
    ContentValues values = new ContentValues();
    values.put("status", "syncing".equals(status) ? "queued" : status);
    values.put("attempts", Math.max(0, state.optInt("attempts", 0)));
    values.put("last_error", state.optString("lastError", ""));
    values.put("server_status", state.optString("serverStatus", ""));
    values.put("review_note", state.optString("reviewNote", ""));
    if (state.has("correctionId") && !state.isNull("correctionId")) values.put("correction_id", state.optLong("correctionId"));
    getWritableDatabase().update("pending_machine_actions", values,
        "action_uuid = ? AND rep_id = ?", new String[] { actionUuid, String.valueOf(repId) });
}

synchronized void restoreAttendanceActionState(String actionUuid, long repId, JSONObject state) {
    String status = state.optString("status", "pending_attendance_sync");
    if (!("pending_attendance_sync".equals(status) || "attendance_rejected".equals(status))) {
        throw new IllegalArgumentException("Recovery attendance status is invalid.");
    }
    ContentValues values = new ContentValues();
    values.put("status", "syncing".equals(status) ? "queued" : status);
    values.put("attempts", Math.max(0, state.optInt("attempts", 0)));
    values.put("last_error", state.optString("lastError", ""));
    getWritableDatabase().update("pending_attendance_actions", values,
        "action_uuid = ? AND rep_id = ?", new String[] { actionUuid, String.valueOf(repId) });
}

synchronized void restoreVisitState(String visitUuid, long repId, JSONObject state) {
    String status = state.optString("status", "queued");
    if (!("queued".equals(status) || "syncing".equals(status) || "blocked".equals(status))) {
        throw new IllegalArgumentException("Recovery visit status is invalid.");
    }
    ContentValues values = new ContentValues();
    values.put("status", "blocked".equals(status) ? "blocked" : "pending");
    values.put("attempts", Math.max(0, state.optInt("attempts", 0)));
    values.put("last_error", state.optString("lastError", ""));
    getWritableDatabase().update("pending_visits", values,
        "visit_uuid = ? AND rep_id = ?", new String[] { visitUuid, String.valueOf(repId) });
}

synchronized void markMachineActionBlocked(String actionUuid, String error) {
    ContentValues values = new ContentValues();
    values.put("status", "blocked");
    values.put("last_error", error == null ? "" : error);
        getWritableDatabase().update("pending_machine_actions", values, "action_uuid = ?", new String[] { actionUuid });
    }

    synchronized void deleteMachineAction(String actionUuid, long repId) {
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT evidence_path FROM pending_machine_actions WHERE action_uuid = ? AND rep_id = ?",
            new String[] { actionUuid, String.valueOf(repId) }
        )) {
            if (cursor.moveToFirst()) {
                String path = cursor.getString(0);
                if (path != null && !path.isEmpty()) new File(path).delete();
            }
        }
        getWritableDatabase().delete("pending_machine_actions", "action_uuid = ? AND rep_id = ?",
            new String[] { actionUuid, String.valueOf(repId) });
    }

    synchronized Set<Long> blockingMachineCardIds(long repId) {
        Set<Long> cardIds = new HashSet<>();
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT action.card_id FROM pending_machine_actions action "
                + "WHERE action.rep_id = ? AND action.rowid = ("
                + "  SELECT candidate.rowid FROM pending_machine_actions candidate "
                + "  WHERE candidate.rep_id = action.rep_id AND candidate.card_id = action.card_id "
                + "    AND candidate.action_type = action.action_type "
                + "  ORDER BY candidate.rowid DESC LIMIT 1) "
                + "AND ("
                + "(action.action_type = 'confirm_location' AND action.status IN ('queued', 'syncing', 'pending_approval', 'blocked', 'rejected')) "
                + "OR (action.action_type = 'report_correction' AND action.status IN ('queued', 'syncing', 'blocked')))",
            new String[] { String.valueOf(repId) }
        )) {
            while (cursor.moveToNext()) cardIds.add(cursor.getLong(0));
        }
        return cardIds;
    }

    /**
     * A newer successful report supersedes older blocked/rejected reports for the
     * same card so they cannot keep the visit blocked forever. Rows are preserved
     * with status `superseded` instead of being deleted.
     */
    synchronized void supersedeMachineActions(long repId, long cardId, String type, String exceptActionUuid) {
        ContentValues values = new ContentValues();
        values.put("status", "superseded");
        getWritableDatabase().update("pending_machine_actions", values,
            "rep_id = ? AND card_id = ? AND action_type = ? AND action_uuid != ? "
                + "AND status IN ('queued', 'syncing', 'pending_approval', 'blocked', 'rejected')",
            new String[] { String.valueOf(repId), String.valueOf(cardId), type,
                exceptActionUuid == null ? "" : exceptActionUuid });
    }

    synchronized JSONArray listMachineActions(long repId) throws Exception {
        JSONArray actions = new JSONArray();
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT action_uuid, action_type, machine_id, card_id, payload_json, evidence_path, "
                + "evidence_content_type, status, attempts, last_error, correction_id, server_status, "
                + "review_note, created_at FROM pending_machine_actions WHERE rep_id = ? "
                + "ORDER BY created_at, action_uuid",
            new String[] { String.valueOf(repId) }
        )) {
            while (cursor.moveToNext()) {
                JSONObject action = new JSONObject();
            action.put("actionUuid", cursor.getString(0));
            action.put("repId", repId);
            action.put("type", cursor.getString(1));
            action.put("machineId", cursor.getLong(2));
            action.put("cardId", cursor.getLong(3));
            action.put("payload", new JSONObject(cursor.getString(4)));
            action.put("status", cursor.getString(7));
            action.put("attempts", cursor.getInt(8));
            action.put("lastError", cursor.getString(9));
                if (!cursor.isNull(10)) action.put("correctionId", cursor.getLong(10));
                action.put("serverStatus", cursor.getString(11));
            action.put("reviewNote", cursor.getString(12));
            action.put("createdAt", cursor.getString(13));
            action.put("evidencePath", cursor.getString(5));
            action.put("evidenceContentType", cursor.getString(6));
            action.put("evidenceAvailable", cursor.getString(5) != null && !cursor.getString(5).isEmpty()
                && new File(cursor.getString(5)).isFile());
            actions.put(action);
        }
    }
    return actions;
    }

    synchronized boolean deleteAttendanceAction(String actionUuid, long repId) {
        return getWritableDatabase().delete("pending_attendance_actions", "action_uuid = ? AND rep_id = ?",
            new String[] { actionUuid, String.valueOf(repId) }) == 1;
    }

    synchronized List<String> markSynced(String visitUuid) {
        SQLiteDatabase database = getWritableDatabase();
        List<String> paths = new ArrayList<>();
        database.beginTransaction();
        try {
            try (Cursor cursor = database.rawQuery("SELECT path FROM visit_photos WHERE visit_uuid = ?", new String[] { visitUuid })) {
                while (cursor.moveToNext()) paths.add(cursor.getString(0));
            }
            ContentValues values = new ContentValues();
            values.put("status", "synced");
            values.put("last_error", "");
            database.update("pending_visits", values, "visit_uuid = ?", new String[] { visitUuid });
            database.delete("visit_photos", "visit_uuid = ?", new String[] { visitUuid });
            database.setTransactionSuccessful();
        } finally {
            database.endTransaction();
        }
        return paths;
    }

    synchronized JSONArray listVisits(long repId) throws Exception {
        JSONArray visits = new JSONArray();
        SQLiteDatabase database = getReadableDatabase();
        try (Cursor cursor = database.rawQuery(
            "SELECT visit_uuid, rep_username, payload_json, status, attempts, last_error, created_at FROM pending_visits WHERE rep_id = ? ORDER BY created_at ASC",
            new String[] { String.valueOf(repId) }
        )) {
            while (cursor.moveToNext()) {
                String uuid = cursor.getString(0);
                JSONObject visit = new JSONObject();
                visit.put("visitUuid", uuid);
                visit.put("repId", repId);
                visit.put("repUsername", cursor.getString(1));
                visit.put("payload", new JSONObject(cursor.getString(2)));
                String status = cursor.getString(3);
                visit.put("status", "pending".equals(status) ? "queued" : "uploading".equals(status) ? "syncing" : status);
                visit.put("attempts", cursor.getInt(4));
                visit.put("lastError", cursor.getString(5));
                visit.put("createdAt", cursor.getString(6));
                visit.put("nativeStoragePath", "internal://visits/" + uuid);
                JSONArray before = new JSONArray();
                JSONArray after = new JSONArray();
                try (Cursor photos = database.rawQuery("SELECT phase, photo_index, path, captured_at FROM visit_photos WHERE visit_uuid = ? ORDER BY phase, photo_index", new String[] { uuid })) {
                    while (photos.moveToNext()) {
                        JSONObject photo = new JSONObject();
                        photo.put("index", photos.getInt(1));
                        photo.put("path", photos.getString(2));
                        photo.put("capturedAt", photos.getString(3));
                        ("before".equals(photos.getString(0)) ? before : after).put(photo);
                    }
                }
                visit.put("beforePhotos", before);
                visit.put("afterPhotos", after);
                visits.put(visit);
            }
        }
        return visits;
    }

    private void databaseUpdate(String visitUuid, ContentValues values) {
        getWritableDatabase().update("pending_visits", values, "visit_uuid = ?", new String[] { visitUuid });
    }

    static final class Photo {
        final String phase;
        final int index;
        final String path;
        final String capturedAt;
        Photo(String phase, int index, String path, String capturedAt) {
            this.phase = phase; this.index = index; this.path = path; this.capturedAt = capturedAt;
        }
    }

    static final class Visit {
        final String visitUuid;
        final long repId;
        final JSONObject payload;
        final List<Photo> photos;
        Visit(String visitUuid, long repId, JSONObject payload, List<Photo> photos) {
            this.visitUuid = visitUuid; this.repId = repId; this.payload = payload; this.photos = photos;
        }
    }

    static final class AttendanceAction {
        final String actionUuid;
        final long repId;
        final JSONObject payload;
        final int attempts;
        AttendanceAction(String actionUuid, long repId, JSONObject payload, int attempts) {
            this.actionUuid = actionUuid;
            this.repId = repId;
            this.payload = payload;
            this.attempts = attempts;
        }
    }

    static final class MachineAction {
        final String actionUuid;
        final long repId;
        final String type;
        final long machineId;
        final long cardId;
        final JSONObject payload;
        final String evidencePath;
        final String evidenceContentType;
        final int attempts;
        MachineAction(String actionUuid, long repId, String type, long machineId, long cardId,
            JSONObject payload, String evidencePath, String evidenceContentType, int attempts) {
            this.actionUuid = actionUuid;
            this.repId = repId;
            this.type = type;
            this.machineId = machineId;
            this.cardId = cardId;
            this.payload = payload;
            this.evidencePath = evidencePath;
            this.evidenceContentType = evidenceContentType;
            this.attempts = attempts;
        }
    }
}
