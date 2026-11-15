package com.madar.rep.app.data.api

import com.madar.rep.app.core.MadarError
import java.io.File
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody

data class HttpResult(val status: Int, val body: String)

data class VisitSyncOutcome(
    val httpStatus: Int,
    val success: Boolean?,
    val status: String?,
    val message: String?,
    val retryAfterMs: Long?,
)

data class VisitPhotoFile(
    val phase: String,
    val file: File,
    val mimeType: String = "image/jpeg",
)

class MadarApi(
    serverUrl: String,
    private val client: OkHttpClient = defaultClient(),
) {
    private val baseUrl = normalizeServerUrl(serverUrl)
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = false }

    fun login(username: String, password: String): HttpResult {
        val payload = json.encodeToString(LoginRequest.serializer(), LoginRequest(username.trim(), password))
        return execute(
            Request.Builder()
                .url("$baseUrl/api/rep/login")
                .header("x-madar-native-client", "android")
                .post(payload.toRequestBody(JSON_MEDIA))
                .build()
        )
    }

    fun getRoute(token: String, username: String): RouteResponse {
        val encoded = URLEncoder.encode(username, Charsets.UTF_8.name())
        val result = authorizedGet("/api/rep/today-route?username=$encoded", token)
        if (result.status !in 200..299) throw mapReadError(result)
        return parse(result.body, RouteResponse.serializer())
    }

    fun startWork(token: String, cardId: Long, visitUuid: String, location: ApiLocation): StartWorkResponse {
        val body = json.encodeToString(StartWorkRequest.serializer(), StartWorkRequest(visitUuid, location))
        val result = execute(
            Request.Builder()
                .url("$baseUrl/api/rep/machines/$cardId/start-work")
                .header("Authorization", "Bearer $token")
                .post(body.toRequestBody(JSON_MEDIA))
                .build()
        )
        if (result.status == 401) throw MadarError.SessionExpired()
        if (result.status == 403) throw MadarError.AccountDisabled(errorText(result))
        if (result.status == 409) throw MadarError.Conflict(errorText(result))
        if (result.status !in 200..299) throw mapReadError(result)
        return parse(result.body, StartWorkResponse.serializer())
    }

    fun stopWork(token: String, cardId: Long, visitUuid: String) {
        val body = json.encodeToString(StopWorkRequest.serializer(), StopWorkRequest(visitUuid))
        val result = execute(
            Request.Builder()
                .url("$baseUrl/api/rep/machines/$cardId/stop-work")
                .header("Authorization", "Bearer $token")
                .post(body.toRequestBody(JSON_MEDIA))
                .build()
        )
        if (result.status == 401) throw MadarError.SessionExpired()
        if (result.status !in 200..299) throw mapReadError(result)
    }

    fun getFaultReasons(token: String): List<FaultReason> {
        val result = authorizedGet("/api/rep/fault-reasons", token)
        if (result.status !in 200..299) throw mapReadError(result)
        return parse(result.body, FaultReasonsResponse.serializer()).reasons
    }

    fun syncVisit(token: String, visit: VisitUpload, photos: List<VisitPhotoFile>): VisitSyncOutcome {
        val visitJson = json.encodeToString(VisitUpload.serializer(), visit)
        val builder = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("visit", visitJson)
        photos.forEach { photo ->
            val field = if (photo.phase == "before") "beforePhoto" else "afterPhoto"
            builder.addFormDataPart(
                field,
                photo.file.name,
                photo.file.asRequestBody(photo.mimeType.toMediaType())
            )
        }
        val result = execute(
            Request.Builder()
                .url("$baseUrl/api/rep/sync-visit")
                .header("Authorization", "Bearer $token")
                .post(builder.build())
                .build()
        )
        val parsed = runCatching {
            json.decodeFromString(VisitSyncEnvelope.serializer(), result.body)
        }.getOrDefault(VisitSyncEnvelope())
        return VisitSyncOutcome(
            httpStatus = result.status,
            success = parsed.success,
            status = parsed.status,
            message = parsed.error ?: parsed.message,
            retryAfterMs = parsed.retryAfterMs,
        )
    }

    fun getTodayAttendance(token: String): AttendanceEnvelope {
        val result = authorizedGet("/api/rep/attendance/today", token)
        if (result.status == 401) throw MadarError.SessionExpired()
        if (result.status !in 200..299) throw mapReadError(result)
        return parse(result.body, AttendanceEnvelope.serializer())
    }

    fun clockIn(token: String, location: ApiLocation): AttendanceClockEnvelope {
        val body = json.encodeToString(
            AttendanceClockRequest.serializer(),
            AttendanceClockRequest(location = location, biometricVerified = true)
        )
        return clockRequest("/api/rep/attendance/clock-in", token, body)
    }

    fun clockOut(token: String, location: ApiLocation?): AttendanceClockEnvelope {
        val body = json.encodeToString(
            AttendanceClockRequest.serializer(),
            AttendanceClockRequest(location = location, biometricVerified = true)
        )
        return clockRequest("/api/rep/attendance/clock-out", token, body)
    }

    fun syncAttendance(token: String, action: AttendanceActionRequest): AttendanceEnvelope {
        val body = json.encodeToString(AttendanceActionRequest.serializer(), action)
        val result = execute(
            Request.Builder()
                .url("$baseUrl/api/rep/attendance/sync")
                .header("Authorization", "Bearer $token")
                .post(body.toRequestBody(JSON_MEDIA))
                .build()
        )
        if (result.status == 401) throw MadarError.SessionExpired()
        if (result.status == 403) throw MadarError.AccountDisabled(errorText(result))
        if (result.status !in 200..299) throw mapReadError(result)
        return parse(result.body, AttendanceEnvelope.serializer())
    }

    fun confirmMachineLocation(token: String, machineId: Long, payloadJson: String): MachineActionResponse {
        val result = execute(
            Request.Builder()
                .url("$baseUrl/api/rep/machines/$machineId/confirm-location")
                .header("Authorization", "Bearer $token")
                .post(payloadJson.toRequestBody(JSON_MEDIA))
                .build()
        )
        if (result.status == 401) throw MadarError.SessionExpired()
        if (result.status in 200..299) return parse(result.body, MachineActionResponse.serializer())
        if (result.status == 403 || result.status == 409) {
            val parsed = runCatching { parse(result.body, MachineActionResponse.serializer()) }.getOrNull()
            throw MadarError.Conflict(parsed?.message ?: parsed?.error ?: errorText(result))
        }
        throw mapReadError(result)
    }

    fun submitMachineCorrection(
        token: String,
        machineId: Long,
        payloadJson: String,
        evidence: File?,
        evidenceMime: String?,
    ): MachineActionResponse {
        val builder = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("correction", null, payloadJson.toRequestBody(JSON_MEDIA))
        if (evidence != null) {
            builder.addFormDataPart(
                "evidence",
                evidence.name,
                evidence.asRequestBody((evidenceMime ?: "image/jpeg").toMediaType())
            )
        }
        val result = execute(
            Request.Builder()
                .url("$baseUrl/api/rep/machines/$machineId/corrections")
                .header("Authorization", "Bearer $token")
                .post(builder.build())
                .build()
        )
        if (result.status == 401) throw MadarError.SessionExpired()
        if (result.status in 200..299) return parse(result.body, MachineActionResponse.serializer())
        throw mapReadError(result)
    }

    fun getMapPacks(token: String): List<MapPack> {
        val result = authorizedGet("/api/rep/map/packs", token)
        if (result.status !in 200..299) throw mapReadError(result)
        return parse(result.body, MapPacksResponse.serializer()).packs
    }

    fun getMapManifest(token: String, packId: String): MapManifest? {
        val result = authorizedGet("/api/rep/map/packs/$packId/manifest", token)
        if (result.status == 404) return null
        if (result.status !in 200..299) throw mapReadError(result)
        return parse(result.body, MapManifestResponse.serializer()).pack
    }

    /** Returns false for a legitimate out-of-coverage 204 response. */
    fun downloadTile(token: String, packId: String, z: Int, x: Int, y: Int, destination: File): Boolean {
        val request = Request.Builder()
            .url("$baseUrl/api/rep/map/tiles/$packId/$z/$x/$y")
            .header("Authorization", "Bearer $token")
            .get()
            .build()
        try {
            client.newCall(request).execute().use { response ->
                if (response.code == 204) return false
                if (response.code == 401) throw MadarError.SessionExpired()
                if (response.code !in 200..299) throw mapReadError(HttpResult(response.code, ""))
                val body = response.body ?: throw MadarError.Protocol("Empty tile response")
                if (body.contentLength() == 0L) throw MadarError.Protocol("Empty tile")
                destination.parentFile?.mkdirs()
                val temporary = File(destination.parentFile, destination.name + ".part")
                body.byteStream().use { input ->
                    temporary.outputStream().use { output -> input.copyTo(output) }
                }
                if (temporary.length() == 0L) {
                    temporary.delete()
                    throw MadarError.Protocol("Empty tile file")
                }
                if (!temporary.renameTo(destination)) {
                    temporary.copyTo(destination, overwrite = true)
                    temporary.delete()
                }
                return true
            }
        } catch (error: MadarError) {
            throw error
        } catch (error: IOException) {
            throw MadarError.Network("Tile download failed", error)
        }
    }

    /** Downloads one raster tile into memory; null means the server has no tile there. */
    fun downloadTileBytes(token: String, packId: String, z: Int, x: Int, y: Int): ByteArray? {
        val request = Request.Builder()
            .url("$baseUrl/api/rep/map/tiles/$packId/$z/$x/$y")
            .header("Authorization", "Bearer $token")
            .get()
            .build()
        try {
            client.newCall(request).execute().use { response ->
                if (response.code == 204) return null
                if (response.code == 401) throw MadarError.SessionExpired()
                if (response.code !in 200..299) throw mapReadError(HttpResult(response.code, ""))
                val body = response.body ?: throw MadarError.Protocol("Empty tile response")
                val bytes = body.bytes()
                if (bytes.isEmpty()) throw MadarError.Protocol("Empty tile")
                return bytes
            }
        } catch (error: MadarError) {
            throw error
        } catch (error: IOException) {
            throw MadarError.Network("Tile download failed", error)
        }
    }

    fun getNotifications(token: String): NotificationsResponse {
        val result = authorizedGet("/api/notifications", token)
        if (result.status !in 200..299) throw mapReadError(result)
        return parse(result.body, NotificationsResponse.serializer())
    }

    fun markNotificationRead(token: String, id: Long) {
        val result = execute(
            Request.Builder()
                .url("$baseUrl/api/notifications/$id/read")
                .header("Authorization", "Bearer $token")
                .post(ByteArray(0).toRequestBody(null))
                .build()
        )
        if (result.status == 401) throw MadarError.SessionExpired()
        if (result.status !in 200..299) throw mapReadError(result)
    }

    fun markAllNotificationsRead(token: String) {
        val result = execute(
            Request.Builder()
                .url("$baseUrl/api/notifications/read-all")
                .header("Authorization", "Bearer $token")
                .post(ByteArray(0).toRequestBody(null))
                .build()
        )
        if (result.status == 401) throw MadarError.SessionExpired()
        if (result.status !in 200..299) throw mapReadError(result)
    }

    fun dismissNotification(token: String, id: Long) {
        val result = execute(
            Request.Builder()
                .url("$baseUrl/api/notifications/$id")
                .header("Authorization", "Bearer $token")
                .delete()
                .build()
        )
        if (result.status == 401) throw MadarError.SessionExpired()
        if (result.status !in 200..299) throw mapReadError(result)
    }

    private fun authorizedGet(path: String, token: String): HttpResult = execute(
        Request.Builder()
            .url("$baseUrl$path")
            .header("Authorization", "Bearer $token")
            .get()
            .build()
    )

    private fun clockRequest(path: String, token: String, body: String): AttendanceClockEnvelope {
        val result = execute(
            Request.Builder()
                .url("$baseUrl$path")
                .header("Authorization", "Bearer $token")
                .post(body.toRequestBody(JSON_MEDIA))
                .build()
        )
        if (result.status == 401) throw MadarError.SessionExpired()
        if (result.status == 403) throw MadarError.AccountDisabled(errorText(result))
        if (result.status in 200..299) return parse(result.body, AttendanceClockEnvelope.serializer())
        if (result.status == 409) throw MadarError.Conflict(errorText(result))
        throw mapReadError(result)
    }

    private fun execute(request: Request): HttpResult {
        try {
            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                return HttpResult(response.code, body)
            }
        } catch (error: IOException) {
            throw MadarError.Network("Network request failed", error)
        }
    }

    private fun mapReadError(result: HttpResult): MadarError = when (result.status) {
        401 -> MadarError.SessionExpired()
        403 -> {
            val text = errorText(result)
            if (text.contains("معطل") || text.contains("disabled", true)) MadarError.AccountDisabled(text)
            else MadarError.Validation(text)
        }
        400, 409, 410, 422 -> MadarError.Validation(errorText(result))
        in 500..599 -> MadarError.Server(errorText(result))
        else -> MadarError.Protocol(errorText(result))
    }

    private fun errorText(result: HttpResult): String {
        val parsed = runCatching { json.decodeFromString(ApiErrorBody.serializer(), result.body) }.getOrNull()
        return parsed?.error ?: parsed?.message ?: "HTTP ${result.status}"
    }

    private fun <T> parse(body: String, serializer: kotlinx.serialization.KSerializer<T>): T =
        runCatching { json.decodeFromString(serializer, body) }
            .getOrElse { throw MadarError.Protocol("Unable to parse server response") }

    companion object {
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()

        fun normalizeServerUrl(
            value: String,
            allowLocalCleartext: Boolean = com.madar.rep.app.BuildConfig.DEBUG,
        ): String {
            val trimmed = value.trim().trimEnd('/')
            val parsed = trimmed.toHttpUrlOrNull() ?: throw MadarError.Validation("Invalid server URL")
            if (!parsed.isHttps) {
                val local = parsed.host in setOf("10.0.2.2", "127.0.0.1", "localhost")
                if (!allowLocalCleartext || !local) {
                    throw MadarError.Validation("Server URL must use HTTPS")
                }
            }
            return parsed.toString().trimEnd('/')
        }
    }
}

@kotlinx.serialization.Serializable
private data class VisitSyncEnvelope(
    val success: Boolean? = null,
    val status: String? = null,
    val error: String? = null,
    val message: String? = null,
    val retryAfterMs: Long? = null,
)
