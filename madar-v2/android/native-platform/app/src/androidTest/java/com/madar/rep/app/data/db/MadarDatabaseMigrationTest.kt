package com.madar.rep.app.data.db

import androidx.room.testing.MigrationTestHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
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

    companion object {
        private const val TEST_DATABASE = "madar-room-v1-upgrade-test"
        private const val TEST_DATABASE_V2 = "madar-room-v2-upgrade-test"
    }
}
