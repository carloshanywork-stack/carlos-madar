package com.madar.rep.app.data.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class DiagnosticOperation {
    @SerialName("visit_sync") VISIT_SYNC,
    @SerialName("attendance_sync") ATTENDANCE_SYNC,
    @SerialName("machine_sync") MACHINE_SYNC,
    @SerialName("tracking_sync") TRACKING_SYNC,
    @SerialName("camera_capture") CAMERA_CAPTURE,
    @SerialName("photo_processing") PHOTO_PROCESSING,
    @SerialName("photo_gallery") PHOTO_GALLERY,
    @SerialName("route_refresh") ROUTE_REFRESH,
    @SerialName("visit_submit") VISIT_SUBMIT,
    @SerialName("app_crash") APP_CRASH,
}

@Serializable
enum class DiagnosticFailure {
    @SerialName("network") NETWORK,
    @SerialName("server") SERVER,
    @SerialName("protocol") PROTOCOL,
    @SerialName("unexpected") UNEXPECTED,
    @SerialName("capture_failed") CAPTURE_FAILED,
    @SerialName("render_failed") RENDER_FAILED,
    @SerialName("gallery_failed") GALLERY_FAILED,
    @SerialName("integrity_failed") INTEGRITY_FAILED,
    @SerialName("retry_exhausted") RETRY_EXHAUSTED,
    @SerialName("uncaught_exception") UNCAUGHT_EXCEPTION,
    @SerialName("rejected") REJECTED,
}

@Serializable
data class AutomaticDiagnostic(
    val reportUuid: String,
    val operation: DiagnosticOperation,
    val failureCode: DiagnosticFailure,
    val httpStatus: Int? = null,
    val occurredAt: String,
    val appVersion: String,
    val versionCode: Int,
    val androidVersion: Int,
)

@Serializable
internal data class AutomaticDiagnosticResponse(
    val success: Boolean = false,
    val report: AutomaticDiagnosticReceipt? = null,
)

@Serializable
internal data class AutomaticDiagnosticReceipt(val reportUuid: String, val status: String)
