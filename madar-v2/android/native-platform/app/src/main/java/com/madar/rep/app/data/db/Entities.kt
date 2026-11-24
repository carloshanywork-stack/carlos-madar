package com.madar.rep.app.data.db

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

object VisitState {
    const val DRAFT = "draft"
    const val QUEUED = "queued"
    const val SYNCING = "syncing"
    const val PROCESSING = "processing"
    const val PENDING_REVIEW = "pending_review"
    const val APPROVED = "approved"
    const val RESHOOT = "reshoot"
    const val NEEDS_LOGIN = "needs_login"
    const val NEEDS_REVIEW = "needs_review"
    const val RETRY_WAIT = "retry_wait"
    const val FAILED = "failed"

    val submittable = setOf(QUEUED, SYNCING, PROCESSING, RETRY_WAIT)
    val open = setOf(DRAFT, QUEUED, SYNCING, PROCESSING, RETRY_WAIT, NEEDS_LOGIN, NEEDS_REVIEW)
}

object MachineActionState {
    const val QUEUED = "queued"
    const val SYNCING = "syncing"
    const val PENDING_APPROVAL = "pending_approval"
    const val APPROVED = "approved"
    const val REJECTED = "rejected"
    const val RETRY_WAIT = "retry_wait"
    const val NEEDS_LOGIN = "needs_login"
    const val NEEDS_REVIEW = "needs_review"
    const val FAILED = "failed"
}

@Entity(tableName = "action_queue")
data class ActionQueueEntity(
    @PrimaryKey val actionUuid: String,
    val ownerRepId: Long,
    val type: String,
    val contentHash: String,
    val queuedAt: Long,
)

object AttendanceActionState {
    const val QUEUED = "queued"
    const val SYNCING = "syncing"
    const val RETRY_WAIT = "retry_wait"
    const val NEEDS_LOGIN = "needs_login"
    const val NEEDS_REVIEW = "needs_review"
    const val FAILED = "failed"
}

object MapPackState {
    const val NOT_DOWNLOADED = "not_downloaded"
    const val DOWNLOADING = "downloading"
    const val VERIFIED = "verified"
    const val FAILED = "failed"
}

object GpsPointState {
    const val QUEUED = "queued"
    const val SYNCING = "syncing"
    const val RETRY_WAIT = "retry_wait"
    const val NEEDS_LOGIN = "needs_login"
    const val NEEDS_REVIEW = "needs_review"
    const val ACKNOWLEDGED = "acknowledged"
}

object SupportReportState {
    const val QUEUED = "queued"
    const val SYNCING = "syncing"
    const val RETRY_WAIT = "retry_wait"
    const val NEEDS_LOGIN = "needs_login"
    const val NEEDS_REVIEW = "needs_review"
    const val SENT = "sent"
}

@Entity(
    tableName = "support_reports",
    indices = [Index("ownerRepId"), Index(value = ["ownerRepId", "state", "nextAttemptAt"])],
)
data class SupportReportEntity(
    @PrimaryKey val reportUuid: String,
    val ownerRepId: Long,
    val payloadJson: String,
    val attachmentPath: String? = null,
    val state: String = SupportReportState.QUEUED,
    val attempts: Int = 0,
    val nextAttemptAt: Long = 0,
    val lastError: String? = null,
    val createdAt: Long,
    val updatedAt: Long,
)

@Entity(
    tableName = "visits",
    indices = [Index("ownerRepId"), Index("state"), Index(value = ["ownerRepId", "state"])],
)
data class VisitEntity(
    @PrimaryKey val visitUuid: String,
    val ownerRepId: Long,
    val cardId: Long,
    val machineCode: String,
    val machineName: String = "",
    val regionName: String,
    val areaName: String = "",
    val clientName: String = "",
    val address: String = "",
    val machineLatitude: Double? = null,
    val machineLongitude: Double? = null,
    val geofenceRadiusMeters: Double = 50.0,
    val locationLocked: Boolean = false,
    val machineCondition: String = "working",
    val reasonIdsCsv: String = "",
    val maintenanceLinesJson: String = "[]",
    val notes: String = "",
    val capturedAt: Long,
    val beforeCapturedAtCsv: String = "",
    val afterCapturedAtCsv: String = "",
    val latitude: Double? = null,
    val longitude: Double? = null,
    val locationAccuracy: Float? = null,
    val locationCapturedAt: Long? = null,
    val locationProvider: String? = null,
    val governorate: String? = null,
    val photoPolicyVersion: Int = 2,
    val state: String = VisitState.DRAFT,
    val serverStatus: String? = null,
    val lastError: String? = null,
    val attempts: Int = 0,
    val nextAttemptAt: Long = 0,
    val bookingExpiresAt: Long? = null,
    val contentHash: String = "",
    val createdAt: Long,
    val updatedAt: Long,
    val arrivalConfirmedAt: Long? = null,
) {
    val isTerminal: Boolean get() = state == VisitState.APPROVED
}

@Entity(
    tableName = "photos",
    foreignKeys = [
        ForeignKey(
            entity = VisitEntity::class,
            parentColumns = ["visitUuid"],
            childColumns = ["visitUuid"],
            onDelete = ForeignKey.CASCADE,
        )
    ],
    indices = [Index("visitUuid"), Index(value = ["visitUuid", "phase", "position"], unique = true)],
)
data class PhotoEntity(
    @PrimaryKey val id: String,
    val visitUuid: String,
    val phase: String,
    val position: Int,
    val originalPath: String,
    val processedPath: String,
    val capturedAt: Long,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val accuracy: Float? = null,
    val provider: String? = null,
    val governorate: String? = null,
    val watermarkText: String = "",
    val sha256: String = "",
    val sizeBytes: Long = 0,
    val mimeType: String = "image/jpeg",
    val uploaded: Boolean = false,
    val createdAt: Long,
)

@Entity(
    tableName = "machine_drafts",
    primaryKeys = ["cardId", "ownerRepId"],
    indices = [Index("ownerRepId")],
)
data class MachineDraftEntity(
    val cardId: Long,
    val ownerRepId: Long,
    val payloadJson: String,
    val updatedAt: Long,
)

@Entity(
    tableName = "notifications",
    indices = [Index(value = ["ownerRepId", "id"], unique = true)],
)
data class NotificationEntity(
    val id: Long,
    val ownerRepId: Long,
    val eventId: Long? = null,
    val type: String = "",
    val message: String = "",
    val href: String? = null,
    val occurredAt: String = "",
    val read: Boolean = false,
    val readAt: String? = null,
    val dismissed: Boolean = false,
    val createdAt: String = "",
    @PrimaryKey val localKey: String = "$ownerRepId:$id",
)

@Entity(tableName = "migration_state")
data class MigrationEntity(
    @PrimaryKey val key: String,
    val value: String,
    val updatedAt: Long,
)

@Entity(tableName = "route_snapshots")
data class RouteSnapshotEntity(
    @PrimaryKey val ownerRepId: Long,
    val routeJson: String,
    val fetchedAt: Long,
    val lastReconciledAt: Long = 0,
)

@Entity(tableName = "fault_reason_snapshots")
data class FaultReasonSnapshotEntity(
    @PrimaryKey val ownerRepId: Long,
    val reasonsJson: String,
    val fetchedAt: Long,
)

@Entity(
    tableName = "machine_actions",
    indices = [Index("ownerRepId"), Index(value = ["ownerRepId", "state"]), Index("cardId")],
)
data class MachineActionEntity(
    @PrimaryKey val actionUuid: String,
    val ownerRepId: Long,
    val type: String,
    val machineId: Long,
    val cardId: Long,
    val payloadJson: String,
    val evidencePath: String? = null,
    val evidenceContentType: String? = null,
    val state: String = MachineActionState.QUEUED,
    val attempts: Int = 0,
    val nextAttemptAt: Long = 0,
    val lastError: String? = null,
    val correctionId: Long? = null,
    val serverStatus: String? = null,
    val createdAt: Long,
    val updatedAt: Long,
)

@Entity(
    tableName = "attendance_actions",
    indices = [Index("ownerRepId"), Index(value = ["ownerRepId", "state"])],
)
data class AttendanceActionEntity(
    @PrimaryKey val actionUuid: String,
    val ownerRepId: Long,
    val action: String,
    val occurredAtIso: String,
    val occurredAtMillis: Long,
    val locationJson: String? = null,
    val biometricVerified: Boolean = true,
    val state: String = AttendanceActionState.QUEUED,
    val attempts: Int = 0,
    val nextAttemptAt: Long = 0,
    val lastError: String? = null,
    val createdAt: Long,
    val updatedAt: Long,
)

@Entity(tableName = "attendance_snapshots")
data class AttendanceSnapshotEntity(
    @PrimaryKey val ownerRepId: Long,
    val envelopeJson: String,
    val fetchedAt: Long,
)

@Entity(tableName = "map_packs")
data class MapPackEntity(
    @PrimaryKey val id: String,
    val name: String,
    val minZoom: Int = 0,
    val maxZoom: Int = 0,
    val boundsWest: Double? = null,
    val boundsSouth: Double? = null,
    val boundsEast: Double? = null,
    val boundsNorth: Double? = null,
    val attribution: String = "",
    val sourceName: String? = null,
    val license: String = "",
    val format: String = "",
    val path: String = "",
    val sizeBytes: Long = 0,
    val sha256: String = "",
    val tileCount: Int = 0,
    val downloadedTiles: Int = 0,
    val state: String = MapPackState.NOT_DOWNLOADED,
    val lastError: String? = null,
    val updatedAt: Long = 0,
)

@Entity(
    tableName = "legacy_imports",
    primaryKeys = ["source", "itemType", "itemId"],
)
data class LegacyImportEntity(
    val source: String,
    val itemType: String,
    val itemId: String,
    val identityHash: String,
    val importedAt: Long,
)

@Entity(
    tableName = "gps_points",
    indices = [
        Index("repId"),
        Index(value = ["repId", "state", "updatedAt"]),
        Index("ownerScopeId"),
        Index(value = ["ownerScopeId", "state", "updatedAt"]),
    ],
)
data class GpsPointEntity(
    @PrimaryKey val clientPointId: String,
    val repId: Long,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Double,
    val speed: Double = 0.0,
    val updatedAt: String,
    val state: String = GpsPointState.QUEUED,
    val contentHash: String,
    val attempts: Int = 0,
    val lastError: String? = null,
    val nextAttemptAt: Long = 0,
    val createdAt: Long = System.currentTimeMillis(),
    val ownerScopeId: Long = repId,
)
