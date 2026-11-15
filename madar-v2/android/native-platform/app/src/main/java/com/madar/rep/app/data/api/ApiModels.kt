package com.madar.rep.app.data.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class LoginRequest(val username: String, val password: String)

@Serializable
data class RepIdentity(
    val id: Long,
    val username: String,
    val fullName: String? = null,
    val role: String? = null,
    val assignedRegions: List<String> = emptyList(),
)

@Serializable
data class LoginResponse(
    val success: Boolean = false,
    val token: String? = null,
    val rep: RepIdentity? = null,
    val message: String? = null,
    val error: String? = null,
)

@Serializable
data class RouteSummary(
    val totalMachines: Int = 0,
    val completed: Int = 0,
    val pending: Int = 0,
    val pendingReview: Int = 0,
    val progress: Int = 0,
)

@Serializable
data class RouteMachine(
    val machineCode: String,
    val machineId: Long,
    val arabicName: String? = null,
    val workOrderId: Long,
    val workOrderCode: String,
    val clientName: String? = null,
    val address: String = "",
    val areaName: String = "",
    val isCompleted: Boolean = false,
    val isSubmitted: Boolean = false,
    val workStatus: String = "available",
    val workOwnerId: Long? = null,
    val reviewStatus: String? = null,
    val reviewNote: String? = null,
    val correctionPending: Boolean = false,
    val cardId: Long,
    val canVisit: Boolean = false,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val isLocationLocked: Boolean = false,
    val geofenceRadiusMeters: Double = 50.0,
    val approvedLocation: ApprovedLocation? = null,
)

@Serializable
data class ApprovedLocation(val latitude: Double, val longitude: Double)

@Serializable
data class RouteRegion(
    val regionName: String,
    val machines: List<RouteMachine> = emptyList(),
)

@Serializable
data class RouteResponse(
    val success: Boolean = false,
    val summary: RouteSummary = RouteSummary(),
    val regions: List<RouteRegion> = emptyList(),
)

@Serializable
data class ApiLocation(
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float,
    val updatedAt: String,
    val isMock: Boolean? = null,
)

@Serializable
data class StartWorkRequest(val visitUuid: String, val location: ApiLocation)

@Serializable
data class StopWorkRequest(val visitUuid: String)

@Serializable
data class StartWorkResponse(
    val success: Boolean = false,
    val status: String? = null,
    val cardId: Long? = null,
    val visitUuid: String? = null,
    val expiresAt: String? = null,
    val idempotent: Boolean = false,
    val error: String? = null,
)

@Serializable
data class FaultReason(
    val id: Long,
    val name: String,
    val category: String? = null,
    val actionMeaning: String? = null,
    val countable: Int = 0,
    val unit: String? = null,
)

@Serializable
data class FaultReasonsResponse(val success: Boolean = false, val reasons: List<FaultReason> = emptyList())

@Serializable
data class RepSupportReport(
    val id: Long,
    val reportUuid: String,
    val category: String,
    val severity: String,
    val description: String,
    val status: String,
    val createdAt: String,
)

@Serializable
data class RepSupportReportEnvelope(
    val success: Boolean = false,
    val report: RepSupportReport? = null,
)

@Serializable
data class MaintenanceLine(val reasonId: Long, val quantity: Int)

@Serializable
data class VisitUpload(
    val visitUuid: String,
    val cardId: Long,
    val machineCode: String,
    val regionName: String,
    val machineCondition: String,
    val reasonIds: List<Long> = emptyList(),
    val maintenanceLines: List<MaintenanceLine> = emptyList(),
    val notes: String = "",
    val capturedAt: String,
    val beforeCapturedAt: List<String> = emptyList(),
    val afterCapturedAt: List<String> = emptyList(),
    val location: ApiLocation? = null,
    val photoPolicyVersion: Int = 2,
)

@Serializable
data class MapBounds(val west: Double, val south: Double, val east: Double, val north: Double)

@Serializable
data class MapPack(
    val id: String,
    val name: String,
    val minZoom: Int = 0,
    val maxZoom: Int = 0,
    val bounds: MapBounds? = null,
    val available: Boolean = false,
    val renderable: Boolean = false,
    val tileCount: Int = 0,
    val sizeBytes: Long = 0,
    val format: String? = null,
    val attribution: String = "",
    val license: String = "",
    val sourceName: String? = null,
    val reason: String? = null,
)

@Serializable
data class MapPacksResponse(val success: Boolean = false, val packs: List<MapPack> = emptyList())

@Serializable
data class MapTileRef(val z: Int, val x: Int, val y: Int, val sizeBytes: Long = 0)

@Serializable
data class MapManifest(
    val id: String,
    val name: String,
    val minZoom: Int = 0,
    val maxZoom: Int = 0,
    val bounds: MapBounds? = null,
    val available: Boolean = false,
    val renderable: Boolean = false,
    val tileCount: Int = 0,
    val sizeBytes: Long = 0,
    val format: String? = null,
    val attribution: String = "",
    val license: String = "",
    val sourceName: String? = null,
    val tiles: List<MapTileRef> = emptyList(),
)

@Serializable
data class MapManifestResponse(val success: Boolean = false, val pack: MapManifest? = null)

@Serializable
data class NotificationDto(
    val id: Long,
    val eventId: Long? = null,
    val type: String = "",
    val message: String = "",
    val href: String? = null,
    val occurredAt: String = "",
    val read: Boolean = false,
    val readAt: String? = null,
    val createdAt: String = "",
)

@Serializable
data class NotificationsResponse(
    val success: Boolean = false,
    val notifications: List<NotificationDto> = emptyList(),
    val unreadCount: Int = 0,
    val total: Int = 0,
    val timeZone: String? = null,
)

@Serializable
data class NotificationActionResponse(
    val success: Boolean = false,
    val unreadCount: Int = 0,
    val notification: NotificationDto? = null,
)

@Serializable
data class ApiErrorBody(val error: String? = null, val message: String? = null)

@Serializable
data class AttendanceRecord(
    val id: Long = 0,
    @SerialName("employee_id") val employeeId: Long = 0,
    @SerialName("work_date") val workDate: String = "",
    @SerialName("clock_in_time") val clockInTime: String? = null,
    @SerialName("clock_out_time") val clockOutTime: String? = null,
    @SerialName("last_clock_out_time") val lastClockOutTime: String? = null,
    @SerialName("total_hours") val totalHours: Double = 0.0,
    @SerialName("regular_hours") val regularHours: Double = 0.0,
    @SerialName("overtime_hours") val overtimeHours: Double = 0.0,
    @SerialName("overtime_status") val overtimeStatus: String = "none",
    @SerialName("overtime_session_status") val overtimeSessionStatus: String? = null,
    @SerialName("overtime_clock_in_time") val overtimeClockInTime: String? = null,
    @SerialName("overtime_clock_out_time") val overtimeClockOutTime: String? = null,
    @SerialName("overtime_request_status") val overtimeRequestStatus: String? = null,
    val status: String = "open",
    val name: String = "",
    val department: String? = null,
) {
    val hasOpenAttendance: Boolean get() = clockInTime != null && clockOutTime == null
    val overtimeIsOpen: Boolean get() = overtimeSessionStatus == "open"
}

@Serializable
data class AttendanceEnvelope(
    val success: Boolean = false,
    val date: String = "",
    val attendance: AttendanceRecord? = null,
    val overtimeRequest: OvertimeRequest? = null,
    val actionUuid: String? = null,
    val idempotent: Boolean = false,
    val error: String? = null,
    val message: String? = null,
)

@Serializable
data class OvertimeRequest(
    val id: Long = 0,
    @SerialName("work_date") val workDate: String = "",
    val status: String = "",
    val reason: String? = null,
)

@Serializable
data class AttendanceActionRequest(
    val actionUuid: String,
    val action: String,
    val occurredAt: String,
    val location: ApiLocation? = null,
    val biometricVerified: Boolean = true,
)

@Serializable
data class AttendanceClockRequest(
    val location: ApiLocation? = null,
    val biometricVerified: Boolean = true,
)

@Serializable
data class AttendanceClockEnvelope(
    val success: Boolean = false,
    val attendance: AttendanceRecord? = null,
    val error: String? = null,
    val message: String? = null,
)

@Serializable
data class MachineActionResponse(
    val success: Boolean = false,
    val idempotent: Boolean = false,
    val correctionId: Long? = null,
    val id: Long? = null,
    val status: String? = null,
    val error: String? = null,
    val message: String? = null,
)

@Serializable
data class TrackingPoint(
    val clientPointId: String,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Double,
    val speed: Double = 0.0,
    val updatedAt: String,
)

@Serializable
data class LocationPingRequest(
    val onDuty: Boolean = true,
    val trail: List<TrackingPoint> = emptyList(),
)

@Serializable
data class LocationPingAck(
    val clientPointId: String? = null,
    val status: String = "",
    val reason: String? = null,
)

@Serializable
data class LocationPingEnvelope(
    val success: Boolean = false,
    val onDuty: Boolean = false,
    val acceptedPoints: Int = 0,
    val duplicatePoints: Int = 0,
    val rejectedPoints: Int = 0,
    val points: List<LocationPingAck> = emptyList(),
    val error: String? = null,
    val message: String? = null,
)
