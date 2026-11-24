package com.madar.rep.app.data.api

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive

@Serializable
data class LoginRequest(
    val username: String,
    val password: String,
    val deviceId: String? = null,
    val deviceName: String? = null,
    val appVersion: String? = null,
)

@Serializable
data class SessionPolicy(
    val offlineLeaseDurationDays: Int = 14,
    val refreshTokenDurationDays: Int = 30,
    val tokenType: String = "Bearer",
)

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
    val refreshToken: String? = null,
    val offlineLease: String? = null,
    val deviceSessionId: String? = null,
    val policy: SessionPolicy? = null,
    val rep: RepIdentity? = null,
    val message: String? = null,
    val error: String? = null,
)

@Serializable
data class RefreshRequest(
    val deviceId: String,
    val refreshToken: String,
)

@Serializable
data class RefreshResponse(
    val success: Boolean = false,
    val token: String? = null,
    val refreshToken: String? = null,
    val offlineLease: String? = null,
    val deviceSessionId: String? = null,
    val policy: SessionPolicy? = null,
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
    val workOrderStatus: String? = null,
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
    val visitRegionName: String? = null,
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
data class ApkReleaseMetadata(
    val sourceRevision: String,
    val sourceTreeDirty: Boolean,
    val builtAt: String,
    val versionName: String,
    val versionCode: Int,
    val buildType: String,
    val apkSha256: String,
    val signerCertificateSha256: String,
)

@Serializable
data class ApkStatusResponse(
    val available: Boolean = false,
    val artifactType: String = "missing",
    val sizeBytes: Long? = null,
    val modifiedAt: String? = null,
    val releaseMetadata: ApkReleaseMetadata? = null,
)

@Serializable
data class AppVersionResponse(
    val success: Boolean = false,
    val latestVersionCode: Int = 0,
    val minSupportedVersionCode: Int = 0,
    val versionName: String? = null,
    val apkUrl: String? = null,
    val sha256: String? = null,
    val releaseNotes: String = "",
) {
    fun notesFor(release: ApkReleaseMetadata): String? = releaseNotes.trim().takeIf {
        success && latestVersionCode == release.versionCode &&
            sha256.equals(release.apkSha256, ignoreCase = true) && it.isNotEmpty()
    }
}

@Serializable
data class ServerMapPoint(
    val cardId: Long,
    val machineId: Long,
    val machineCode: String,
    val latitude: Double,
    val longitude: Double,
    val locationLocked: Boolean = false,
)

@Serializable
data class ServerMapPointsResponse(
    val success: Boolean = false,
    val points: List<ServerMapPoint> = emptyList(),
)

@Serializable
data class RepSupportReportsResponse(
    val success: Boolean = false,
    val reports: List<RepSupportReport> = emptyList(),
)

@Serializable
data class LocationChangeRequestView(
    val id: Long,
    val actionUuid: String,
    val machineId: Long,
    val machineCode: String,
    val machineName: String,
    val cardId: Long,
    val status: String,
    val proposedLocation: ProposedLocation,
    val note: String? = null,
    val reviewNote: String? = null,
    val createdAt: String,
    val reviewedAt: String? = null,
)

@Serializable
data class ProposedLocation(
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float = 0f,
)

@Serializable
data class LocationChangeRequestsResponse(
    val success: Boolean = false,
    val requests: List<LocationChangeRequestView> = emptyList(),
)

@Serializable
data class LocationChangeSubmitResponse(
    val success: Boolean = false,
    val idempotent: Boolean = false,
    val requestId: Long? = null,
    val status: String? = null,
    val error: String? = null,
    val message: String? = null,
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

object FlexibleMapBoundsSerializer : KSerializer<MapBounds> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("MapBounds") {
        element("west", PrimitiveSerialDescriptor("west", PrimitiveKind.DOUBLE))
        element("south", PrimitiveSerialDescriptor("south", PrimitiveKind.DOUBLE))
        element("east", PrimitiveSerialDescriptor("east", PrimitiveKind.DOUBLE))
        element("north", PrimitiveSerialDescriptor("north", PrimitiveKind.DOUBLE))
    }

    override fun serialize(encoder: Encoder, value: MapBounds) {
        MapBounds.Surrogate.serializer().serialize(
            encoder,
            MapBounds.Surrogate(value.west, value.south, value.east, value.north)
        )
    }

    override fun deserialize(decoder: Decoder): MapBounds {
        val jsonDecoder = decoder as? JsonDecoder
            ?: throw SerializationException("FlexibleMapBoundsSerializer requires JsonDecoder")
        val element = jsonDecoder.decodeJsonElement()
        return parseElement(element)
    }

    fun parseElement(element: JsonElement): MapBounds {
        return when (element) {
            is JsonObject -> {
                val west = element["west"]?.jsonPrimitive?.doubleOrNull
                    ?: throw SerializationException("Missing or invalid 'west' coordinate in bounds object")
                val south = element["south"]?.jsonPrimitive?.doubleOrNull
                    ?: throw SerializationException("Missing or invalid 'south' coordinate in bounds object")
                val east = element["east"]?.jsonPrimitive?.doubleOrNull
                    ?: throw SerializationException("Missing or invalid 'east' coordinate in bounds object")
                val north = element["north"]?.jsonPrimitive?.doubleOrNull
                    ?: throw SerializationException("Missing or invalid 'north' coordinate in bounds object")
                validateAndConstruct(west, south, east, north)
            }
            is JsonPrimitive -> {
                val text = element.content.trim()
                val parts = text.split(',').map { it.trim() }
                if (parts.size != 4) {
                    throw SerializationException("Bounds string must have 4 comma-separated values, got: '$text'")
                }
                val doubles = parts.mapIndexed { idx, part ->
                    part.toDoubleOrNull()
                        ?: throw SerializationException("Invalid double at index $idx in bounds string: '$part'")
                }
                validateAndConstruct(doubles[0], doubles[1], doubles[2], doubles[3])
            }
            is JsonArray -> {
                if (element.size != 4) {
                    throw SerializationException("Bounds array must have exactly 4 numbers, got ${element.size}")
                }
                val doubles = element.mapIndexed { idx, item ->
                    item.jsonPrimitive.doubleOrNull
                        ?: throw SerializationException("Invalid number at index $idx in bounds array: '$item'")
                }
                validateAndConstruct(doubles[0], doubles[1], doubles[2], doubles[3])
            }
            else -> throw SerializationException("Expected object, string, or array for bounds, but got: $element")
        }
    }

    private fun validateAndConstruct(west: Double, south: Double, east: Double, north: Double): MapBounds {
        if (!west.isFinite() || !south.isFinite() || !east.isFinite() || !north.isFinite()) {
            throw SerializationException("Bounds coordinates must be finite: west=$west, south=$south, east=$east, north=$north")
        }
        if (west > east) {
            throw SerializationException("Invalid bounds: west ($west) cannot be greater than east ($east)")
        }
        if (south > north) {
            throw SerializationException("Invalid bounds: south ($south) cannot be greater than north ($north)")
        }
        return MapBounds(west = west, south = south, east = east, north = north)
    }
}

@Serializable(with = FlexibleMapBoundsSerializer::class)
data class MapBounds(val west: Double, val south: Double, val east: Double, val north: Double) {
    @Serializable
    internal data class Surrogate(val west: Double, val south: Double, val east: Double, val north: Double)
}

@Serializable
data class MapPack(
    val id: String,
    val name: String,
    val minZoom: Int = 0,
    val maxZoom: Int = 0,
    val bounds: MapBounds? = null,
    val coverageBounds: MapBounds? = null,
    val available: Boolean = false,
    val renderable: Boolean = false,
    val tileCount: Int = 0,
    val sizeBytes: Long = 0,
    val format: String? = null,
    val attribution: String = "",
    val license: String = "",
    val sourceName: String? = null,
    val reason: String? = null,
) {
    val effectiveBounds: MapBounds? get() = coverageBounds ?: bounds
}

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
    val coverageBounds: MapBounds? = null,
    val available: Boolean = false,
    val renderable: Boolean = false,
    val tileCount: Int = 0,
    val sizeBytes: Long = 0,
    val format: String? = null,
    val attribution: String = "",
    val license: String = "",
    val sourceName: String? = null,
    val tiles: List<MapTileRef> = emptyList(),
) {
    val effectiveBounds: MapBounds? get() = coverageBounds ?: bounds
}

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
    val activeClockInTime: String? = null,
) {
    val hasOpenAttendance: Boolean get() = clockInTime != null && clockOutTime == null
    val overtimeIsOpen: Boolean get() = overtimeSessionStatus == "open"
}

@Serializable
data class AttendanceEnvelope(
    val success: Boolean = false,
    val date: String = "",
    val attendance: AttendanceRecord? = null,
    val openAttendance: AttendanceRecord? = null,
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

@Serializable
data class DeviceHeartbeatRequest(
    @SerialName("installation_id") val installationId: String,
    @SerialName("app_version_name") val appVersionName: String,
    @SerialName("app_version_code") val appVersionCode: Int,
    @SerialName("device_manufacturer") val deviceManufacturer: String,
    @SerialName("device_model") val deviceModel: String,
    @SerialName("os_version") val osVersion: String,
    @SerialName("api_level") val apiLevel: Int,
    @SerialName("location_provider") val locationProvider: String,
    @SerialName("has_fine_permission") val hasFinePermission: Boolean,
    @SerialName("has_coarse_permission") val hasCoarsePermission: Boolean,
    @SerialName("is_gps_enabled") val isGpsEnabled: Boolean,
    @SerialName("is_network_enabled") val isNetworkEnabled: Boolean,
    @SerialName("client_timestamp") val clientTimestamp: Long,
    @SerialName("last_location_error") val lastLocationError: String? = null,
)

@Serializable
data class DeviceHeartbeatResponse(
    val success: Boolean = true,
    @SerialName("server_time") val serverTime: Long = 0L,
    @SerialName("clock_offset_ms") val clockOffsetMs: Long = 0L,
    @SerialName("latest_apk_version_code") val latestApkVersionCode: Int? = null,
    val message: String? = null,
)
