package com.madar.rep.app;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.location.Location;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Durable, acknowledged-on-delivery GPS queue for native background tracking. */
public final class RepTrackStore extends SQLiteOpenHelper {
    private static final String DATABASE_NAME = "madar_rep_tracking.db";
    private static final int DATABASE_VERSION = 3;
    private static final String TABLE = "breadcrumbs";
    private static final String REJECTED_TABLE = "rejected_breadcrumbs";
    private static final int READ_BATCH_LIMIT = 20000;

    private static boolean isFinite(double value) {
        return !Double.isNaN(value) && !Double.isInfinite(value);
    }

    public RepTrackStore(Context context) {
        super(context.getApplicationContext(), DATABASE_NAME, null, DATABASE_VERSION);
        setWriteAheadLoggingEnabled(true);
        migrateLegacyTrail(context.getApplicationContext());
    }

    @Override
    public void onCreate(SQLiteDatabase database) {
        createBreadcrumbTable(database);
        createRejectedTable(database);
    }

    private static void createBreadcrumbTable(SQLiteDatabase database) {
        database.execSQL("CREATE TABLE IF NOT EXISTS " + TABLE + " ("
            + "_id INTEGER PRIMARY KEY AUTOINCREMENT, "
            + "rep_id INTEGER NOT NULL DEFAULT 0, "
            + "timestamp INTEGER NOT NULL, "
            + "latitude REAL NOT NULL, "
            + "longitude REAL NOT NULL, "
            + "accuracy REAL NOT NULL, "
            + "speed REAL NOT NULL DEFAULT 0, "
            + "UNIQUE(rep_id, timestamp, latitude, longitude, accuracy, speed)"
            + ")");
        database.execSQL("CREATE INDEX IF NOT EXISTS idx_breadcrumbs_rep_id ON " + TABLE + "(rep_id, _id)");
    }

    private static void createRejectedTable(SQLiteDatabase database) {
        database.execSQL("CREATE TABLE IF NOT EXISTS " + REJECTED_TABLE + " ("
            + "_id INTEGER PRIMARY KEY AUTOINCREMENT, "
            + "source_track_id INTEGER NOT NULL, "
            + "rep_id INTEGER NOT NULL, "
            + "timestamp INTEGER NOT NULL, "
            + "latitude REAL NOT NULL, "
            + "longitude REAL NOT NULL, "
            + "accuracy REAL NOT NULL, "
            + "speed REAL NOT NULL DEFAULT 0, "
            + "reason TEXT NOT NULL DEFAULT '', "
            + "rejected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"
            + ")");
        database.execSQL("CREATE INDEX IF NOT EXISTS idx_rejected_breadcrumbs_rep ON "
            + REJECTED_TABLE + "(rep_id, rejected_at)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase database, int oldVersion, int newVersion) {
        if (oldVersion < 2) {
            createBreadcrumbTable(database);
            // Preserve every point queued by the previous app version before switching the writer.
            database.execSQL("INSERT OR IGNORE INTO " + TABLE
                + " (timestamp, latitude, longitude, accuracy, speed)"
                + " SELECT timestamp, latitude, longitude, accuracy, speed FROM gps_points");
        }
        if (oldVersion < 3) {
            createRejectedTable(database);
            migrateBreadcrumbIdentity(database);
        }
    }

    /**
     * Add representative identity to the local trail. Rows written by older app
     * versions remain explicitly unattributed (rep_id = 0); they are preserved and
     * are never uploaded under whichever account happens to log in later.
     */
    private static void migrateBreadcrumbIdentity(SQLiteDatabase database) {
        try (Cursor columns = database.rawQuery("PRAGMA table_info(" + TABLE + ")", null)) {
            boolean hasRepId = false;
            while (columns.moveToNext()) {
                if ("rep_id".equals(columns.getString(1))) {
                    hasRepId = true;
                    break;
                }
            }
            if (hasRepId) return;
        }
        database.execSQL("ALTER TABLE " + TABLE + " RENAME TO breadcrumbs_legacy");
        database.execSQL("DROP INDEX IF EXISTS idx_breadcrumbs_rep_id");
        createBreadcrumbTable(database);
        database.execSQL("INSERT OR IGNORE INTO " + TABLE
            + " (rep_id, timestamp, latitude, longitude, accuracy, speed)"
            + " SELECT 0, timestamp, latitude, longitude, accuracy, speed FROM breadcrumbs_legacy");
        database.execSQL("DROP TABLE breadcrumbs_legacy");
    }

    /** Append a point only for an authenticated representative; unattributed points are never guessed. */
    public long append(Location location, long repId) {
        if (repId < 1L) return -1L;
        ContentValues values = new ContentValues();
        values.put("rep_id", repId);
        values.put("timestamp", location.getTime());
        values.put("latitude", location.getLatitude());
        values.put("longitude", location.getLongitude());
        values.put("accuracy", (double) location.getAccuracy());
        values.put("speed", location.hasSpeed() ? (double) location.getSpeed() : 0.0);
        return getWritableDatabase().insertWithOnConflict(TABLE, null, values, SQLiteDatabase.CONFLICT_IGNORE);
    }

    public JSONArray pendingTrail(long repId) throws JSONException {
        JSONArray points = new JSONArray();
        if (repId < 1L) return points;
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT _id, timestamp, latitude, longitude, accuracy, speed FROM " + TABLE
                + " WHERE rep_id = ? ORDER BY _id ASC LIMIT " + READ_BATCH_LIMIT,
            new String[] { String.valueOf(repId) }
        )) {
            while (cursor.moveToNext()) {
                JSONObject point = new JSONObject();
                point.put("trackId", cursor.getLong(0));
                point.put("repId", repId);
                point.put("timestamp", cursor.getLong(1));
                point.put("latitude", cursor.getDouble(2));
                point.put("longitude", cursor.getDouble(3));
                point.put("accuracy", cursor.getDouble(4));
                point.put("speed", cursor.getDouble(5));
                point.put("mocked", false);
                points.put(point);
            }
        }
        return points;
    }

    public int pendingCount(long repId) {
        if (repId < 1L) return 0;
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT COUNT(*) FROM " + TABLE + " WHERE rep_id = ?",
            new String[] { String.valueOf(repId) }
        )) {
            return cursor.moveToFirst() ? cursor.getInt(0) : 0;
        }
    }

    public int unattributedCount() {
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT COUNT(*) FROM " + TABLE + " WHERE rep_id < 1", null
        )) {
            return cursor.moveToFirst() ? cursor.getInt(0) : 0;
        }
    }

    public int acknowledgeThrough(long trackId, long repId) {
        if (trackId < 1 || repId < 1L) return 0;
        return getWritableDatabase().delete(TABLE, "_id <= ? AND rep_id = ?",
            new String[] { String.valueOf(trackId), String.valueOf(repId) });
    }

    public int acknowledgePoint(long trackId, long repId) {
        if (trackId < 1L || repId < 1L) return 0;
        return getWritableDatabase().delete(TABLE, "_id = ? AND rep_id = ?",
            new String[] { String.valueOf(trackId), String.valueOf(repId) });
    }

    /** Move a permanently rejected point into a review table instead of deleting movement history. */
    public boolean rejectPoint(long trackId, long repId, String reason) {
        if (trackId < 1L || repId < 1L) return false;
        SQLiteDatabase database = getWritableDatabase();
        database.beginTransaction();
        try (Cursor cursor = database.rawQuery(
            "SELECT timestamp, latitude, longitude, accuracy, speed FROM " + TABLE
                + " WHERE _id = ? AND rep_id = ?",
            new String[] { String.valueOf(trackId), String.valueOf(repId) }
        )) {
            if (!cursor.moveToFirst()) return false;
            ContentValues values = new ContentValues();
            values.put("source_track_id", trackId);
            values.put("rep_id", repId);
            values.put("timestamp", cursor.getLong(0));
            values.put("latitude", cursor.getDouble(1));
            values.put("longitude", cursor.getDouble(2));
            values.put("accuracy", cursor.getDouble(3));
            values.put("speed", cursor.getDouble(4));
            values.put("reason", reason == null ? "" : reason);
            database.insertOrThrow(REJECTED_TABLE, null, values);
            database.delete(TABLE, "_id = ? AND rep_id = ?",
                new String[] { String.valueOf(trackId), String.valueOf(repId) });
            database.setTransactionSuccessful();
            return true;
        } finally {
            database.endTransaction();
        }
    }

    private void migrateLegacyTrail(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(RepLocationService.PREFERENCES_NAME, Context.MODE_PRIVATE);
        if (preferences.getBoolean("duty_trail_sqlite_migrated", false)) return;

        SQLiteDatabase database = getWritableDatabase();
        database.beginTransaction();
        try {
            JSONArray oldTrail = new JSONArray(preferences.getString("duty_trail_json", "[]"));
            for (int index = 0; index < oldTrail.length(); index += 1) {
                JSONObject point = oldTrail.optJSONObject(index);
                if (point == null) continue;
                double latitude = point.optDouble("latitude", Double.NaN);
                double longitude = point.optDouble("longitude", Double.NaN);
                double accuracy = point.optDouble("accuracy", Double.NaN);
                long timestamp = point.optLong("timestamp", 0L);
                if (timestamp <= 0L || !isFinite(latitude) || latitude < -90 || latitude > 90
                    || !isFinite(longitude) || longitude < -180 || longitude > 180
                    || !isFinite(accuracy) || accuracy < 0 || accuracy > 100000) continue;
                ContentValues values = new ContentValues();
                values.put("rep_id", 0L);
                values.put("timestamp", timestamp);
                values.put("latitude", latitude);
                values.put("longitude", longitude);
                values.put("accuracy", accuracy);
                values.put("speed", point.optDouble("speed", 0.0));
                database.insertWithOnConflict(TABLE, null, values, SQLiteDatabase.CONFLICT_IGNORE);
            }
            database.setTransactionSuccessful();
        } catch (JSONException ignored) {
            // A malformed legacy preference should not prevent the new durable queue from opening.
        } finally {
            database.endTransaction();
        }
        preferences.edit().putBoolean("duty_trail_sqlite_migrated", true).putString("duty_trail_json", "[]").apply();
    }
}
