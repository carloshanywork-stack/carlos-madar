package com.madar.rep.app.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        VisitEntity::class,
        PhotoEntity::class,
        MachineDraftEntity::class,
        NotificationEntity::class,
        MigrationEntity::class,
        RouteSnapshotEntity::class,
        FaultReasonSnapshotEntity::class,
        MachineActionEntity::class,
        AttendanceActionEntity::class,
        AttendanceSnapshotEntity::class,
        MapPackEntity::class,
        LegacyImportEntity::class,
        GpsPointEntity::class,
        SupportReportEntity::class,
    ],
    version = 3,
    exportSchema = true,
)
abstract class MadarDatabase : RoomDatabase() {
    abstract fun visits(): VisitDao
    abstract fun photos(): PhotoDao
    abstract fun drafts(): DraftDao
    abstract fun notifications(): NotificationDao
    abstract fun routes(): RouteDao
    abstract fun faultReasons(): FaultReasonDao
    abstract fun machineActions(): MachineActionDao
    abstract fun attendanceActions(): AttendanceActionDao
    abstract fun attendanceSnapshots(): AttendanceSnapshotDao
    abstract fun mapPacks(): MapPackDao
    abstract fun legacyImports(): LegacyImportDao
    abstract fun migration(): MigrationDao
    abstract fun gpsPoints(): GpsPointDao
    abstract fun supportReports(): SupportReportDao

    companion object {
        @Volatile private var instance: MadarDatabase? = null

        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    """CREATE TABLE IF NOT EXISTS gps_points (
                        clientPointId TEXT NOT NULL PRIMARY KEY,
                        repId INTEGER NOT NULL,
                        latitude REAL NOT NULL,
                        longitude REAL NOT NULL,
                        accuracy REAL NOT NULL,
                        speed REAL NOT NULL,
                        updatedAt TEXT NOT NULL,
                        state TEXT NOT NULL,
                        contentHash TEXT NOT NULL,
                        attempts INTEGER NOT NULL,
                        lastError TEXT,
                        nextAttemptAt INTEGER NOT NULL,
                        createdAt INTEGER NOT NULL
                    )""".trimIndent()
                )
                database.execSQL("CREATE INDEX IF NOT EXISTS index_gps_points_repId ON gps_points (repId)")
                database.execSQL("CREATE INDEX IF NOT EXISTS index_gps_points_repId_state_updatedAt ON gps_points (repId, state, updatedAt)")
            }
        }

        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL("""CREATE TABLE IF NOT EXISTS support_reports (
                    reportUuid TEXT NOT NULL PRIMARY KEY,
                    ownerRepId INTEGER NOT NULL,
                    payloadJson TEXT NOT NULL,
                    attachmentPath TEXT,
                    state TEXT NOT NULL,
                    attempts INTEGER NOT NULL,
                    nextAttemptAt INTEGER NOT NULL,
                    lastError TEXT,
                    createdAt INTEGER NOT NULL,
                    updatedAt INTEGER NOT NULL
                )""".trimIndent())
                database.execSQL("CREATE INDEX IF NOT EXISTS index_support_reports_ownerRepId ON support_reports (ownerRepId)")
                database.execSQL("CREATE INDEX IF NOT EXISTS index_support_reports_ownerRepId_state_nextAttemptAt ON support_reports (ownerRepId, state, nextAttemptAt)")
            }
        }

        fun get(context: Context): MadarDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                MadarDatabase::class.java,
                "madar-native.db"
            )
                .setJournalMode(JournalMode.WRITE_AHEAD_LOGGING)
                .addMigrations(MIGRATION_1_2)
                .addMigrations(MIGRATION_2_3)
                .build()
                .also { instance = it }
        }
    }
}
