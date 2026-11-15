package com.madar.rep.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import com.madar.rep.app.migration.LegacyMigrationActivity
import com.madar.rep.app.ui.MadarRoot
import com.madar.rep.app.ui.theme.MadarTheme
import kotlinx.coroutines.launch

/**
 * A FragmentActivity is required because attendance uses the real
 * [androidx.biometric.BiometricPrompt] and no software bypass is permitted.
 *
 * Migration is offered once per process, before the rep starts working, but only
 * when a legacy SQLite queue actually exists. A brand-new install must not be
 * interrupted by an empty migration wizard. The manual entry stays available on
 * the sync screen for browser-only legacy data.
 */
class MainActivity : FragmentActivity() {
    private val container: AppContainer by lazy { (application as MadarApplication).container }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MadarTheme {
                MadarRoot(container)
            }
        }
        lifecycleScope.launch {
            if (!container.migrationPrompted.compareAndSet(false, true)) return@launch
            if (!container.migrationManager.shouldRun()) return@launch
            if (!container.migrationManager.legacyDatabaseExists() && !container.migrationManager.needsBrowserBridge()) return@launch
            startActivity(Intent(this@MainActivity, LegacyMigrationActivity::class.java))
        }
    }
}
