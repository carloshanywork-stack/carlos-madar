package com.madar.rep.app.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface VisitDao {
    @Upsert
    suspend fun upsert(visit: VisitEntity)

    @Upsert
    suspend fun upsertAll(visits: List<VisitEntity>)

    @Update
    suspend fun update(visit: VisitEntity)

    @Query("SELECT * FROM visits WHERE visitUuid = :uuid")
    suspend fun find(uuid: String): VisitEntity?

    @Query("SELECT * FROM visits WHERE visitUuid = :uuid")
    fun observe(uuid: String): Flow<VisitEntity?>

    @Query("SELECT * FROM visits WHERE ownerRepId = :repId ORDER BY createdAt DESC")
    fun observeForOwner(repId: Long): Flow<List<VisitEntity>>

    @Query("SELECT * FROM visits WHERE ownerRepId = :repId ORDER BY createdAt DESC")
    suspend fun listForOwner(repId: Long): List<VisitEntity>

    @Query("SELECT * FROM visits WHERE ownerRepId = :repId AND cardId = :cardId AND state = 'draft' ORDER BY createdAt DESC LIMIT 1")
    suspend fun findDraft(repId: Long, cardId: Long): VisitEntity?

    @Query("SELECT * FROM visits WHERE ownerRepId = :repId AND state = 'draft' ORDER BY createdAt DESC LIMIT 1")
    suspend fun latestDraft(repId: Long): VisitEntity?

    @Query("SELECT * FROM visits WHERE ownerRepId = :repId AND state IN ('draft','queued','retry_wait','processing','syncing','needs_login','needs_review') ORDER BY createdAt DESC")
    fun observeOpen(repId: Long): Flow<List<VisitEntity>>

    @Query(
        """
        SELECT * FROM visits
        WHERE ownerRepId = :repId
          AND state IN ('queued', 'retry_wait', 'processing', 'syncing')
          AND nextAttemptAt <= :now
        ORDER BY createdAt
        LIMIT :limit
        """
    )
    suspend fun dueForSync(repId: Long, now: Long, limit: Int = 10): List<VisitEntity>

    @Query("SELECT COUNT(*) FROM visits WHERE ownerRepId = :repId AND state IN ('queued','retry_wait','processing','syncing','needs_login','needs_review')")
    fun observePendingCount(repId: Long): Flow<Int>

    @Query("SELECT COUNT(*) FROM visits WHERE ownerRepId = :repId AND state = :state")
    suspend fun countByState(repId: Long, state: String): Int

    @Query("UPDATE visits SET state = 'queued', nextAttemptAt = :now, lastError = NULL, updatedAt = :now WHERE (ownerRepId = :repId OR ownerRepId = :scopeId) AND state = 'needs_login'")
    suspend fun requeueNeedsLogin(repId: Long, scopeId: Long = repId, now: Long = System.currentTimeMillis()): Int

    @Query("UPDATE visits SET state = 'queued', nextAttemptAt = :now, lastError = NULL, updatedAt = :now WHERE visitUuid = :uuid AND state IN ('needs_login','needs_review','retry_wait','failed')")
    suspend fun retryNow(uuid: String, now: Long): Int

    @Query("SELECT COUNT(*) FROM visits WHERE ownerRepId = :repId AND state = :state")
    fun observeCountByState(repId: Long, state: String): Flow<Int>

    @Query("SELECT COUNT(*) FROM visits WHERE ownerRepId = :repId AND state IN ('queued','retry_wait','processing','syncing')")
    suspend fun countPending(repId: Long): Int

    @Query("UPDATE visits SET state = :state, lastError = :error, attempts = :attempts, nextAttemptAt = :nextAttemptAt, serverStatus = :serverStatus, updatedAt = :now WHERE visitUuid = :uuid")
    suspend fun updateSyncState(
        uuid: String,
        state: String,
        error: String?,
        attempts: Int,
        nextAttemptAt: Long,
        serverStatus: String?,
        now: Long,
    )

    @Query("UPDATE visits SET state = :state, lastError = :error, serverStatus = :serverStatus, updatedAt = :now WHERE visitUuid = :uuid")
    suspend fun updateState(uuid: String, state: String, error: String?, serverStatus: String?, now: Long)

    @Query("UPDATE visits SET lastError = :error, updatedAt = :now WHERE visitUuid = :uuid")
    suspend fun setError(uuid: String, error: String?, now: Long)

    @Query("DELETE FROM visits WHERE visitUuid = :uuid")
    suspend fun delete(uuid: String)

    @Query("SELECT * FROM visits WHERE ownerRepId != :repId AND state IN ('draft','queued','syncing','processing','retry_wait','needs_login','needs_review')")
    suspend fun pendingForOtherOwners(repId: Long): List<VisitEntity>

    @Query("SELECT * FROM visits WHERE ownerRepId = :repId AND state IN ('draft','needs_login','needs_review','failed') ORDER BY createdAt DESC")
    suspend fun blockedForOwner(repId: Long): List<VisitEntity>
}

@Dao
interface PhotoDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(photo: PhotoEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(photos: List<PhotoEntity>)

    @Query("SELECT * FROM photos WHERE visitUuid = :uuid ORDER BY phase, position")
    suspend fun forVisit(uuid: String): List<PhotoEntity>

    @Query("SELECT * FROM photos WHERE id = :id")
    suspend fun find(id: String): PhotoEntity?

    @Query("SELECT * FROM photos WHERE visitUuid = :uuid AND phase = :phase ORDER BY position")
    suspend fun forPhase(uuid: String, phase: String): List<PhotoEntity>

    @Query("SELECT * FROM photos WHERE visitUuid = :uuid AND phase = :phase ORDER BY position")
    fun observePhase(uuid: String, phase: String): Flow<List<PhotoEntity>>

    @Query("UPDATE photos SET uploaded = 1 WHERE visitUuid = :uuid")
    suspend fun markUploaded(uuid: String)

    @Query("UPDATE photos SET originalPath = :path WHERE id = :id")
    suspend fun updateOriginalPath(id: String, path: String)

    @Query("DELETE FROM photos WHERE visitUuid = :uuid")
    suspend fun deleteForVisit(uuid: String)

    @Query("DELETE FROM photos WHERE id = :id")
    suspend fun delete(id: String)

    @Query("SELECT COUNT(*) FROM photos WHERE visitUuid = :uuid")
    suspend fun countForVisit(uuid: String): Int
}

@Dao
interface DraftDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(draft: MachineDraftEntity)

    @Query("SELECT * FROM machine_drafts WHERE cardId = :cardId AND ownerRepId = :repId")
    suspend fun find(cardId: Long, repId: Long): MachineDraftEntity?

    @Query("DELETE FROM machine_drafts WHERE cardId = :cardId AND ownerRepId = :repId")
    suspend fun delete(cardId: Long, repId: Long)
}

@Dao
interface NotificationDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(notifications: List<NotificationEntity>)

    @Query("SELECT * FROM notifications WHERE ownerRepId = :repId AND dismissed = 0 ORDER BY occurredAt DESC, id DESC")
    fun observe(repId: Long): Flow<List<NotificationEntity>>

    @Query("SELECT COUNT(*) FROM notifications WHERE ownerRepId = :repId AND read = 0 AND dismissed = 0")
    fun observeUnread(repId: Long): Flow<Int>

    @Query("SELECT * FROM notifications WHERE ownerRepId = :repId")
    suspend fun list(repId: Long): List<NotificationEntity>

    @Query("SELECT * FROM notifications WHERE ownerRepId = :repId AND id = :id")
    suspend fun find(repId: Long, id: Long): NotificationEntity?

    @Query("UPDATE notifications SET read = 1, readAt = :readAt WHERE ownerRepId = :repId AND id = :id")
    suspend fun markRead(repId: Long, id: Long, readAt: String)

    @Query("UPDATE notifications SET read = 1, readAt = :readAt WHERE ownerRepId = :repId")
    suspend fun markAllRead(repId: Long, readAt: String)

    @Query("UPDATE notifications SET dismissed = 1 WHERE ownerRepId = :repId AND id = :id")
    suspend fun dismiss(repId: Long, id: Long)

    @Query("DELETE FROM notifications WHERE ownerRepId = :repId AND id NOT IN (:ids)")
    suspend fun deleteMissing(repId: Long, ids: List<Long>)
}

@Dao
interface RouteDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(snapshot: RouteSnapshotEntity)

    @Query("SELECT * FROM route_snapshots WHERE ownerRepId = :repId")
    suspend fun get(repId: Long): RouteSnapshotEntity?

    @Query("DELETE FROM route_snapshots")
    suspend fun clear()

    @Query("DELETE FROM route_snapshots WHERE ownerRepId = :repId")
    suspend fun clearForOwner(repId: Long)

    @Query("SELECT * FROM route_snapshots WHERE ownerRepId = :repId")
    fun observe(repId: Long): Flow<RouteSnapshotEntity?>
}

@Dao
interface FaultReasonDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(snapshot: FaultReasonSnapshotEntity)

    @Query("SELECT * FROM fault_reason_snapshots WHERE ownerRepId = :repId")
    suspend fun get(repId: Long): FaultReasonSnapshotEntity?
}

@Dao
interface MachineActionDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(action: MachineActionEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(actions: List<MachineActionEntity>)

    @Query("SELECT * FROM machine_actions WHERE ownerRepId = :repId AND state IN ('queued','retry_wait','syncing') AND nextAttemptAt <= :now ORDER BY createdAt LIMIT :limit")
    suspend fun dueForSync(repId: Long, now: Long, limit: Int = 10): List<MachineActionEntity>

    @Query("SELECT * FROM machine_actions WHERE ownerRepId = :repId ORDER BY createdAt DESC")
    suspend fun listForOwner(repId: Long): List<MachineActionEntity>

    @Query("SELECT * FROM machine_actions WHERE ownerRepId = :repId ORDER BY createdAt DESC")
    fun observeForOwner(repId: Long): Flow<List<MachineActionEntity>>

    @Query("SELECT * FROM machine_actions WHERE actionUuid = :uuid")
    suspend fun find(uuid: String): MachineActionEntity?

    @Query("SELECT COUNT(*) FROM machine_actions WHERE ownerRepId = :repId AND state IN ('queued','retry_wait','syncing')")
    suspend fun countPending(repId: Long): Int

    @Query("UPDATE machine_actions SET state = :state, lastError = :error, attempts = :attempts, nextAttemptAt = :nextAttemptAt, correctionId = :correctionId, serverStatus = :serverStatus, updatedAt = :now WHERE actionUuid = :uuid")
    suspend fun updateState(
        uuid: String,
        state: String,
        error: String?,
        attempts: Int,
        nextAttemptAt: Long,
        correctionId: Long?,
        serverStatus: String?,
        now: Long,
    )

    @Query("UPDATE machine_actions SET state = 'queued', nextAttemptAt = :now, lastError = NULL, updatedAt = :now WHERE (ownerRepId = :repId OR ownerRepId = :scopeId) AND state = 'needs_login'")
    suspend fun requeueNeedsLogin(repId: Long, scopeId: Long = repId, now: Long = System.currentTimeMillis()): Int

    @Query("UPDATE machine_actions SET state = 'queued', nextAttemptAt = :now, lastError = NULL, updatedAt = :now WHERE actionUuid = :uuid AND state IN ('needs_login','needs_review','retry_wait','failed')")
    suspend fun retryNow(uuid: String, now: Long): Int
}

@Dao
interface AttendanceActionDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(action: AttendanceActionEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(actions: List<AttendanceActionEntity>)

    @Query("SELECT * FROM attendance_actions WHERE ownerRepId = :repId AND state IN ('queued','retry_wait','syncing') AND nextAttemptAt <= :now ORDER BY occurredAtMillis LIMIT :limit")
    suspend fun dueForSync(repId: Long, now: Long, limit: Int = 10): List<AttendanceActionEntity>

    @Query("SELECT * FROM attendance_actions WHERE actionUuid = :uuid")
    suspend fun find(uuid: String): AttendanceActionEntity?

    @Query("SELECT * FROM attendance_actions WHERE ownerRepId = :repId ORDER BY occurredAtMillis DESC")
    suspend fun listForOwner(repId: Long): List<AttendanceActionEntity>

    @Query("SELECT * FROM attendance_actions WHERE ownerRepId = :repId ORDER BY occurredAtMillis DESC")
    fun observeForOwner(repId: Long): Flow<List<AttendanceActionEntity>>

    @Query("SELECT COUNT(*) FROM attendance_actions WHERE ownerRepId = :repId")
    suspend fun countForOwner(repId: Long): Int

    @Query("UPDATE attendance_actions SET state = :state, lastError = :error, attempts = :attempts, nextAttemptAt = :nextAttemptAt, updatedAt = :now WHERE actionUuid = :uuid")
    suspend fun updateState(
        uuid: String,
        state: String,
        error: String?,
        attempts: Int,
        nextAttemptAt: Long,
        now: Long,
    )

    @Query("UPDATE attendance_actions SET state = 'queued', nextAttemptAt = :now, lastError = NULL, updatedAt = :now WHERE (ownerRepId = :repId OR ownerRepId = :scopeId) AND state = 'needs_login'")
    suspend fun requeueNeedsLogin(repId: Long, scopeId: Long = repId, now: Long = System.currentTimeMillis()): Int

    @Query("UPDATE attendance_actions SET state = 'queued', nextAttemptAt = :now, lastError = NULL, updatedAt = :now WHERE actionUuid = :uuid AND state IN ('needs_login','needs_review','retry_wait','failed')")
    suspend fun retryNow(uuid: String, now: Long): Int
}

@Dao
interface AttendanceSnapshotDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(snapshot: AttendanceSnapshotEntity)

    @Query("SELECT * FROM attendance_snapshots WHERE ownerRepId = :repId")
    suspend fun get(repId: Long): AttendanceSnapshotEntity?

    @Query("SELECT * FROM attendance_snapshots WHERE ownerRepId = :repId")
    fun observe(repId: Long): Flow<AttendanceSnapshotEntity?>
}

@Dao
interface MapPackDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(pack: MapPackEntity)

    @Query("SELECT * FROM map_packs ORDER BY name")
    fun observeAll(): Flow<List<MapPackEntity>>

    @Query("SELECT * FROM map_packs WHERE id = :id")
    suspend fun find(id: String): MapPackEntity?

    @Query("SELECT * FROM map_packs WHERE state = 'verified' ORDER BY updatedAt DESC LIMIT 1")
    suspend fun active(): MapPackEntity?

    @Query("SELECT * FROM map_packs WHERE state = 'verified' ORDER BY updatedAt DESC")
    suspend fun verified(): List<MapPackEntity>
}

@Dao
interface LegacyImportDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(entry: LegacyImportEntity)

    @Query("SELECT * FROM legacy_imports WHERE source = :source AND itemType = :itemType AND itemId = :itemId")
    suspend fun find(source: String, itemType: String, itemId: String): LegacyImportEntity?

    @Query("SELECT COUNT(*) FROM legacy_imports WHERE source = :source")
    suspend fun countForSource(source: String): Int
}

@Dao
interface MigrationDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(state: MigrationEntity)

    @Query("SELECT * FROM migration_state WHERE key = :key")
    suspend fun get(key: String): MigrationEntity?

    @Query("SELECT * FROM migration_state")
    suspend fun all(): List<MigrationEntity>
}

@Dao
interface GpsPointDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(point: GpsPointEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(point: GpsPointEntity)

    @Query("SELECT * FROM gps_points WHERE (ownerScopeId = :scopeId OR repId = :repId) AND state != 'acknowledged' ORDER BY updatedAt")
    fun observeForOwner(scopeId: Long, repId: Long = scopeId): Flow<List<GpsPointEntity>>

    @Query("SELECT * FROM gps_points WHERE (ownerScopeId = :scopeId OR repId = :repId) AND state IN ('queued','syncing','retry_wait','needs_login') AND nextAttemptAt <= :now ORDER BY updatedAt LIMIT :limit")
    suspend fun pending(scopeId: Long, repId: Long = scopeId, now: Long = System.currentTimeMillis(), limit: Int = 25): List<GpsPointEntity>

    @Update
    suspend fun update(point: GpsPointEntity)

    @Query("SELECT COUNT(*) FROM gps_points WHERE (ownerScopeId = :scopeId OR repId = :repId) AND state IN ('queued','syncing','retry_wait','needs_login')")
    suspend fun countPending(scopeId: Long, repId: Long = scopeId): Int

    @Query("UPDATE gps_points SET state = 'queued', nextAttemptAt = 0, lastError = NULL WHERE clientPointId = :clientPointId AND (ownerScopeId = :scopeId OR repId = :scopeId) AND state IN ('needs_login','needs_review','retry_wait')")
    suspend fun retryNow(clientPointId: String, scopeId: Long): Int

    @Query("UPDATE gps_points SET state = 'queued', nextAttemptAt = 0, lastError = NULL WHERE (ownerScopeId = :scopeId OR repId = :repId) AND state = 'needs_login'")
    suspend fun requeueNeedsLogin(scopeId: Long, repId: Long = scopeId): Int
}

@Dao
interface SupportReportDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(report: SupportReportEntity)

    @Query("SELECT * FROM support_reports WHERE ownerRepId = :repId ORDER BY createdAt DESC")
    fun observeForOwner(repId: Long): Flow<List<SupportReportEntity>>

    @Query("SELECT * FROM support_reports WHERE ownerRepId = :repId AND state IN ('queued','retry_wait','syncing','needs_login') AND nextAttemptAt <= :now ORDER BY createdAt LIMIT :limit")
    suspend fun dueForSync(repId: Long, now: Long, limit: Int = 20): List<SupportReportEntity>

    @Query("UPDATE support_reports SET state = :state, lastError = :error, attempts = :attempts, nextAttemptAt = :nextAttemptAt, updatedAt = :now WHERE reportUuid = :uuid")
    suspend fun updateState(uuid: String, state: String, error: String?, attempts: Int, nextAttemptAt: Long, now: Long)

    @Query("SELECT COUNT(*) FROM support_reports WHERE ownerRepId = :repId AND state IN ('queued','retry_wait','syncing','needs_login')")
    suspend fun countPending(repId: Long): Int

    @Query("UPDATE support_reports SET state = 'queued', nextAttemptAt = :now, lastError = NULL, updatedAt = :now WHERE (ownerRepId = :repId OR ownerRepId = :scopeId) AND state = 'needs_login'")
    suspend fun requeueNeedsLogin(repId: Long, scopeId: Long = repId, now: Long = System.currentTimeMillis()): Int
}
