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
            execSQL("INSERT INTO visits (visitUuid,repId,cardId,machineId,machineCode,machineName,regionName,areaName,clientName,address,geofenceRadiusMeters,state,condition,reasonIdsCsv,maintenanceLinesJson,notes,capturedAt,attempts,nextAttemptAt,createdAt,updatedAt) VALUES ('legacy-visit',7,9,2,'M-2','آلة','القاهرة','','عميل','','50','draft','working','','[]','',100,0,0,100,100)")
            close()
        }

        val migrated = helper.runMigrationsAndValidate(
            TEST_DATABASE,
            2,
            true,
            MadarDatabase.MIGRATION_1_2,
        )
        migrated.query("SELECT visitUuid,repId,state FROM visits").use { cursor ->
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

    companion object { private const val TEST_DATABASE = "madar-room-v1-upgrade-test" }
}
