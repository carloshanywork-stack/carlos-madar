package com.madar.rep.app;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

/** Small encrypted store for the representative's background-sync credential. */
final class RepAuthStore {
    private static final String FILE_NAME = "madar_rep_auth_secure";
    private static volatile SharedPreferences preferences;

    private RepAuthStore() {}

    private static SharedPreferences preferences(Context context) throws Exception {
        SharedPreferences current = preferences;
        if (current != null) return current;
        synchronized (RepAuthStore.class) {
            if (preferences == null) {
                Context appContext = context.getApplicationContext();
                MasterKey masterKey = new MasterKey.Builder(appContext)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build();
                preferences = EncryptedSharedPreferences.create(
                    appContext,
                    FILE_NAME,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                );
            }
            return preferences;
        }
    }

    static void save(Context context, String token, long repId, String username) throws Exception {
        if (token == null || token.trim().isEmpty() || repId < 1) throw new IllegalArgumentException("A valid representative session is required.");
        preferences(context).edit()
            .putString("auth_token", token)
            .putLong("rep_id", repId)
            .putString("rep_username", username == null ? "" : username)
            .apply();
    }

    static String token(Context context) {
        try { return preferences(context).getString("auth_token", null); }
        catch (Exception error) { return null; }
    }

    static long repId(Context context) {
        try { return preferences(context).getLong("rep_id", 0L); }
        catch (Exception error) { return 0L; }
    }

    static String username(Context context) {
        try { return preferences(context).getString("rep_username", ""); }
        catch (Exception error) { return ""; }
    }

    static void clear(Context context) throws Exception {
        preferences(context).edit().clear().commit();
    }
}
