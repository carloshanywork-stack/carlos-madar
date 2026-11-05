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
    private static final int DATABASE_VERSION = 1;

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
    }

    @Override
    public void onUpgrade(SQLiteDatabase database, int oldVersion, int newVersion) {
        // Local business evidence is preserved; future native schema changes are additive.
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

    synchronized Visit nextVisit(long repId) throws Exception {
        SQLiteDatabase database = getWritableDatabase();
        try (Cursor cursor = database.rawQuery(
            "SELECT visit_uuid, rep_id, payload_json FROM pending_visits WHERE rep_id = ? AND status IN ('pending', 'uploading') ORDER BY created_at ASC LIMIT 1",
            new String[] { String.valueOf(repId) }
        )) {
            if (!cursor.moveToFirst()) return null;
            String uuid = cursor.getString(0);
            JSONObject payload = new JSONObject(cursor.getString(2));
            List<Photo> photos = new ArrayList<>();
            try (Cursor photoCursor = database.rawQuery(
                "SELECT phase, photo_index, path, captured_at FROM visit_photos WHERE visit_uuid = ? ORDER BY CASE phase WHEN 'before' THEN 0 ELSE 1 END, photo_index",
                new String[] { uuid }
            )) {
                while (photoCursor.moveToNext()) photos.add(new Photo(photoCursor.getString(0), photoCursor.getInt(1), photoCursor.getString(2), photoCursor.getString(3)));
            }
            return new Visit(uuid, cursor.getLong(1), payload, photos);
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
            "SELECT visit_uuid, rep_username, payload_json, status, attempts, last_error, created_at FROM pending_visits WHERE rep_id = ? ORDER BY created_at ASC LIMIT 500",
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
}
