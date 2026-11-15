package com.madar.rep.app.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

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
    ],
    version = 1,
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

    companion object {
        @Volatile private var instance: MadarDatabase? = null

        fun get(context: Context): MadarDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                MadarDatabase::class.java,
                "madar-native.db"
            )
                .setJournalMode(JournalMode.WRITE_AHEAD_LOGGING)
                .build()
                .also { instance = it }
        }
    }
}
