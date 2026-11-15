package com.madar.rep.app.data.migration

import android.content.Context
import com.madar.rep.app.core.GovernorateIndex
import com.madar.rep.app.data.db.MadarDatabase
import com.madar.rep.app.data.db.MigrationEntity
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json

data class MigrationProgress(
    val running: Boolean = false,
    val phase: String = "",
    val current: String = "",
    val counts: MigrationCounts = MigrationCounts(),
    val warnings: List<String> = emptyList(),
    val errors: List<String> = emptyList(),
    val sqliteDone: Boolean = false,
    val browserDone: Boolean = false,
    val finished: Boolean = false,
)

/**
 * Coordinates the one-time legacy import. It is intentionally separate from the
 * normal app flow: a failure leaves the old files and the native queue untouched,
 * records the reason, and lets the same screen retry after fixing storage.
 */
class MigrationManager(
    private val context: Context,
    private val database: MadarDatabase,
    governorates: GovernorateIndex,
) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val sqlite = LegacySqliteImporter(context, database, governorates, json)
    private val browser = IndexedDbImporter(context, database, governorates, json)
    private val _state = MutableStateFlow(MigrationProgress())
    val state: StateFlow<MigrationProgress> = _state.asStateFlow()

    suspend fun refreshMarkers() {
        _state.value = _state.value.copy(
            sqliteDone = marker(SQLITE_DONE) == "1",
            browserDone = marker(BROWSER_DONE) == "1",
            finished = marker(MIGRATION_DONE) == "1",
        )
    }

    suspend fun shouldRun(): Boolean = marker(MIGRATION_DONE) != "1"

    suspend fun needsBrowserBridge(): Boolean = marker(BROWSER_DONE) != "1"

    fun legacyDatabaseExists(): Boolean = sqlite.legacyDatabase().isFile

    suspend fun runSqlite(): MigrationCounts {
        if (marker(SQLITE_DONE) == "1") {
            _state.value = _state.value.copy(sqliteDone = true)
            return _state.value.counts
        }
        _state.value = _state.value.copy(running = true, phase = "sqlite", current = "", errors = emptyList())
        return try {
            val counts = sqlite.import { kind ->
                _state.value = _state.value.copy(current = kind)
            }
            database.migration().put(MigrationEntity(SQLITE_DONE, "1", System.currentTimeMillis()))
            _state.value = _state.value.copy(
                running = false,
                phase = "",
                current = "",
                sqliteDone = true,
                counts = merge(_state.value.counts, counts),
            )
            writeReport()
            _state.value.counts
        } catch (error: Exception) {
            val message = "تعذر ترحيل قاعدة البيانات القديمة: ${error.message ?: error.javaClass.simpleName}"
            _state.value = _state.value.copy(running = false, phase = "", errors = _state.value.errors + message)
            writeReport()
            throw error
        }
    }

    suspend fun runBrowser(rawJson: String?): MigrationCounts {
        if (marker(BROWSER_DONE) == "1") {
            _state.value = _state.value.copy(browserDone = true)
            return _state.value.counts
        }
        _state.value = _state.value.copy(running = true, phase = "browser", current = "")
        return try {
            val counts = if (rawJson.isNullOrBlank()) {
                MigrationCounts()
            } else {
                browser.import(rawJson) { kind ->
                    _state.value = _state.value.copy(current = kind)
                }
            }
            database.migration().put(MigrationEntity(BROWSER_DONE, "1", System.currentTimeMillis()))
            _state.value = _state.value.copy(
                running = false,
                phase = "",
                current = "",
                browserDone = true,
                counts = merge(_state.value.counts, counts),
            )
            writeReport()
            _state.value.counts
        } catch (error: Exception) {
            val message = "تعذر ترحيل تخزين المتصفح القديم: ${error.message ?: error.javaClass.simpleName}"
            _state.value = _state.value.copy(running = false, phase = "", errors = _state.value.errors + message)
            writeReport()
            throw error
        }
    }

    suspend fun finish() {
        database.migration().put(MigrationEntity(MIGRATION_DONE, "1", System.currentTimeMillis()))
        _state.value = _state.value.copy(finished = true, running = false, phase = "")
        writeReport()
    }

    fun addWarning(message: String) {
        _state.value = _state.value.copy(warnings = _state.value.warnings + message)
    }

    fun reportFile(): File = File(context.filesDir, "migration-report.txt")

    fun writeReport() {
        val state = _state.value
        val legacy = sqlite.legacyDatabase()
        val text = buildString {
            appendLine("MADAR Native migration report")
            appendLine("generated: ${utcNow()}")
            appendLine("app package: ${context.packageName}")
            appendLine("legacy SQLite: ${legacy.absolutePath}")
            appendLine("legacy SQLite present: ${legacy.isFile}")
            if (legacy.isFile) appendLine("legacy SQLite bytes: ${legacy.length()}")
            appendLine("sqlite completed: ${state.sqliteDone}")
            appendLine("browser completed: ${state.browserDone}")
            appendLine("finished: ${state.finished}")
            appendLine("imported visits: ${state.counts.visits}")
            appendLine("imported photos: ${state.counts.photos}")
            appendLine("imported attendance actions: ${state.counts.attendance}")
            appendLine("imported machine actions: ${state.counts.machineActions}")
            appendLine("imported route snapshots: ${state.counts.routeSnapshots}")
            appendLine("imported fault reasons: ${state.counts.reasons}")
            appendLine("skipped duplicate items: ${state.counts.skipped}")
            if (state.warnings.isNotEmpty()) {
                appendLine("warnings:")
                state.warnings.forEach { appendLine("- $it") }
            }
            if (state.errors.isNotEmpty()) {
                appendLine("errors:")
                state.errors.forEach { appendLine("- $it") }
            }
        }
        runCatching { reportFile().writeText(text) }
    }

    private fun merge(left: MigrationCounts, right: MigrationCounts): MigrationCounts = MigrationCounts(
        visits = left.visits + right.visits,
        photos = left.photos + right.photos,
        attendance = left.attendance + right.attendance,
        machineActions = left.machineActions + right.machineActions,
        routeSnapshots = left.routeSnapshots + right.routeSnapshots,
        reasons = left.reasons + right.reasons,
        skipped = left.skipped + right.skipped,
    )

    private suspend fun marker(key: String): String? = database.migration().get(key)?.value

    private fun utcNow(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }.format(Date())

    companion object {
        const val SQLITE_DONE = "legacy.sqlite.done"
        const val BROWSER_DONE = "legacy.browser.done"
        const val MIGRATION_DONE = "legacy.migration.done"
    }
}
