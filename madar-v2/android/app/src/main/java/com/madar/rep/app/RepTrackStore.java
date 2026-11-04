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
    private static final int DATABASE_VERSION = 1;
    private static final String TABLE = "gps_points";
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
        database.execSQL("CREATE TABLE " + TABLE + " ("
            + "_id INTEGER PRIMARY KEY AUTOINCREMENT, "
            + "timestamp INTEGER NOT NULL, "
            + "latitude REAL NOT NULL, "
            + "longitude REAL NOT NULL, "
            + "accuracy REAL NOT NULL, "
            + "speed REAL NOT NULL DEFAULT 0, "
            + "UNIQUE(timestamp, latitude, longitude, accuracy, speed)"
            + ")");
    }

    @Override
    public void onUpgrade(SQLiteDatabase database, int oldVersion, int newVersion) {
        // This local queue is removed only after server acknowledgment; future upgrades must be additive.
    }

    public long append(Location location) {
        ContentValues values = new ContentValues();
        values.put("timestamp", location.getTime());
        values.put("latitude", location.getLatitude());
        values.put("longitude", location.getLongitude());
        values.put("accuracy", (double) location.getAccuracy());
        values.put("speed", location.hasSpeed() ? (double) location.getSpeed() : 0.0);
        return getWritableDatabase().insertWithOnConflict(TABLE, null, values, SQLiteDatabase.CONFLICT_IGNORE);
    }

    public JSONArray pendingTrail() throws JSONException {
        JSONArray points = new JSONArray();
        try (Cursor cursor = getReadableDatabase().rawQuery(
            "SELECT _id, timestamp, latitude, longitude, accuracy, speed FROM " + TABLE
                + " ORDER BY _id ASC LIMIT " + READ_BATCH_LIMIT,
            null
        )) {
            while (cursor.moveToNext()) {
                JSONObject point = new JSONObject();
                point.put("trackId", cursor.getLong(0));
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

    public int acknowledgeThrough(long trackId) {
        if (trackId < 1) return 0;
        return getWritableDatabase().delete(TABLE, "_id <= ?", new String[] { String.valueOf(trackId) });
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
