package com.madar.rep.app.core

import android.content.Context
import java.util.UUID

/**
 * Manages an app-scoped, persistent installation identifier.
 *
 * Requirements:
 * - Unique random UUID per app installation.
 * - Survives app updates and reboots in SharedPreferences.
 * - Strictly isolated to MADAR: Does NOT use IMEI, Android ID, MAC address, or hardware serials.
 * - Cannot be used for tracking outside the MADAR application.
 */
class InstallationManager(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    val installationId: String
        get() {
            var id = prefs.getString(KEY_INSTALLATION_ID, null)
            if (id.isNullOrBlank()) {
                synchronized(this) {
                    id = prefs.getString(KEY_INSTALLATION_ID, null)
                    if (id.isNullOrBlank()) {
                        id = UUID.randomUUID().toString()
                        prefs.edit().putString(KEY_INSTALLATION_ID, id).apply()
                    }
                }
            }
            return id!!
        }

    companion object {
        private const val PREFS_NAME = "madar.installation"
        private const val KEY_INSTALLATION_ID = "app_installation_uuid"
    }
}
