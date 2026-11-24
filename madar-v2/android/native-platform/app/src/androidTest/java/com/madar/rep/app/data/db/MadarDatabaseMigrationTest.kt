package com.madar.rep.app.data.db

import androidx.room.testing.MigrationTestHelper
import androidx.room.Room
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MadarDatabaseMigrationTest {
    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        MadarDatabase::class.java,
        emptyList(),
        FrameworkSQLiteOpenHelperFactory(),
    )

    @Test
    fun v1QueueAndHistorySurviveAdditiveGpsMigration() {
        helper.createDatabase(TEST_DATABASE, 1).apply {
            execSQL(
                "INSERT INTO visits (visitUuid,ownerRepId,cardId,machineCode,machineName,regionName,areaName,clientName,address," +
                    "geofenceRadiusMeters,locationLocked,machineCondition,reasonIdsCsv,maintenanceLinesJson,notes,capturedAt," +
                    "beforeCapturedAtCsv,afterCapturedAtCsv,photoPolicyVersion,state,attempts,nextAttemptAt,contentHash,createdAt,updatedAt) " +
                    "VALUES ('legacy-visit',7,9,'M-2','آلة','القاهرة','','عميل','',50,0,'working','','[]','',100,'','',1,'draft',0,0,'hash',100,100)",
            )
            close()
        }

        val migrated = helper.runMigrationsAndValidate(
            TEST_DATABASE,
            2,
            true,
            MadarDatabase.MIGRATION_1_2,
        )
        migrated.query("SELECT visitUuid,ownerRepId,state FROM visits").use { cursor ->
            check(cursor.moveToFirst())
            assertEquals("legacy-visit", cursor.getString(0))
            assertEquals(7L, cursor.getLong(1))
            assertEquals("draft", cursor.getString(2))
        }
        migrated.query("SELECT COUNT(*) FROM gps_points").use { cursor ->
            check(cursor.moveToFirst())
            assertEquals(0, cursor.getInt(0))
        }
        migrated.close()
    }

    @Test
    fun v2SupportOutboxMigrationIsAdditiveAndPreservesExistingRows() {
        helper.createDatabase(TEST_DATABASE_V2, 2).apply {
            execSQL("INSERT INTO migration_state (key,value,updatedAt) VALUES ('legacy','preserved',123)")
            close()
        }

        val migrated = helper.runMigrationsAndValidate(
            TEST_DATABASE_V2,
            3,
            true,
            MadarDatabase.MIGRATION_2_3,
        )
        migrated.query("SELECT value,updatedAt FROM migration_state WHERE key = 'legacy'").use { cursor ->
            check(cursor.moveToFirst())
            assertEquals("preserved", cursor.getString(0))
            assertEquals(123L, cursor.getLong(1))
        }
        migrated.query("SELECT COUNT(*) FROM support_reports").use { cursor ->
            check(cursor.moveToFirst())
            assertEquals(0, cursor.getInt(0))
        }
        migrated.close()
    }

    @Test
    fun v4MigrationPreservesDraftCoordinatesAndBackfillsPendingOutbox() {
        helper.createDatabase(TEST_DATABASE_V4, 4).apply {
            for (state in listOf(VisitState.DRAFT, VisitState.QUEUED, VisitState.FAILED)) {
                execSQL(
                    """INSERT INTO visits (visitUuid,ownerRepId,cardId,machineCode,machineName,regionName,areaName,clientName,address,
                        geofenceRadiusMeters,locationLocked,machineCondition,reasonIdsCsv,maintenanceLinesJson,notes,capturedAt,
                        beforeCapturedAtCsv,afterCapturedAtCsv,photoPolicyVersion,state,attempts,nextAttemptAt,contentHash,createdAt,updatedAt,
                        latitude,longitude)
                        VALUES (?,7,9,'M-2','','القاهرة','','','',50,1,'working','','[]','',100,'','',2,?,0,0,'hash',100,100,30.0,31.0)""",
                    arrayOf(state, state),
                )
            }
            close()
        }
        helper.runMigrationsAndValidate(TEST_DATABASE_V4, 5, true, MadarDatabase.MIGRATION_4_5).use { migrated ->
            migrated.query("SELECT latitude, longitude, arrivalConfirmedAt FROM visits WHERE visitUuid = 'draft'").use { cursor ->
                check(cursor.moveToFirst())
                assertEquals(30.0, cursor.getDouble(0), 0.0)
                assertEquals(31.0, cursor.getDouble(1), 0.0)
                assertNull(cursor.getString(2))
            }
            migrated.query("SELECT actionUuid, contentHash, type FROM action_queue").use { cursor ->
                assertEquals(1, cursor.count)
                check(cursor.moveToFirst())
                assertEquals(VisitState.QUEUED, cursor.getString(0))
                assertEquals("hash", cursor.getString(1))
                assertEquals("visit", cursor.getString(2))
            }
        }
    }

    @Test
    fun stalePhotoProcessingCannotResurrectAnExcludedShotOrReplaceItsSlot() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val database = Room.inMemoryDatabaseBuilder(context, MadarDatabase::class.java).build()
        try {
            val visit = VisitEntity("visit", 1, 2, "M-2", regionName = "", capturedAt = 100, createdAt = 100, updatedAt = 100)
            database.visits().upsert(visit)
            val original = PhotoEntity(
                "original", visit.visitUuid, "before", 0, "/original.jpg", "/processed.jpg", 100, createdAt = 100,
            )
            database.photos().insertNew(original)
            database.photos().delete(original.id)
            val replacement = original.copy(id = "replacement", originalPath = "/replacement.jpg")
            database.photos().insertNew(replacement)
            assertEquals(-1L, database.photos().insertNew(original))
            assertEquals(0, database.photos().updateProcessed(original.id, "/old.jpg", "old", "sha", 100))
            assertEquals(listOf(replacement), database.photos().forPhase(visit.visitUuid, "before"))
        } finally { database.close() }
    }

    @Test
    fun retriedOrImportedVisitsGetOneImmutableOutboxRecord() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val database = Room.inMemoryDatabaseBuilder(context, MadarDatabase::class.java).build()
        try {
            val visit = VisitEntity(
                "legacy", 1, 2, "M-2", regionName = "", capturedAt = 100, createdAt = 100, updatedAt = 100,
                state = VisitState.FAILED,
            )
            database.visits().upsert(visit)
            database.visits().retryNow(visit.visitUuid, 123)
            assertEquals(emptyList<VisitEntity>(), database.visits().dueForSync(1, 123))
            database.actionQueue().appendLegacyVisits(1)
            database.actionQueue().appendLegacyVisits(1)
            assertEquals(listOf(visit.visitUuid), database.visits().dueForSync(1, 123).map { it.visitUuid })
            database.openHelper.readableDatabase.query("SELECT queuedAt FROM action_queue").use {
                assertEquals(1, it.count)
                check(it.moveToFirst())
                assertEquals(123L, it.getLong(0))
            }
        } finally { database.close() }
    }

    companion object {
        private const val TEST_DATABASE = "madar-room-v1-upgrade-test"
        private const val TEST_DATABASE_V2 = "madar-room-v2-upgrade-test"
        private const val TEST_DATABASE_V4 = "madar-room-v4-upgrade-test"
    }
}
