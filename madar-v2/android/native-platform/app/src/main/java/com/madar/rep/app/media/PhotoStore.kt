package com.madar.rep.app.media

import android.content.Context
import com.madar.rep.app.core.GeoPoint
import com.madar.rep.app.core.GovernorateIndex
import com.madar.rep.app.core.Hashing
import com.madar.rep.app.data.db.PhotoEntity
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/**
 * A photo only becomes a PhotoEntity after both the untouched original and the
 * watermarked derivative are durable, non-empty, and hashed. Partial writes are
 * renamed or deleted; they never leave a reference in Room.
 */
class PhotoStore(
    private val context: Context,
    private val governorates: GovernorateIndex,
) {
    fun newCaptureFile(visitUuid: String, phase: String): File {
        require(visitUuid.matches(Regex("[A-Za-z0-9_-]{1,100}"))) { "Invalid visit identifier" }
        require(phase == "before" || phase == "after") { "Unsupported photo phase" }
        val directory = File(context.filesDir, "pending-camera-captures").apply { mkdirs() }
        return File(directory, "${visitUuid}_${phase}_${UUID.randomUUID()}.jpg")
    }

    fun originalFile(visitUuid: String, phase: String, evidenceId: String): File =
        File(evidenceDirectory(visitUuid, phase, evidenceId), "original.jpg")

    fun processedFile(visitUuid: String, phase: String, evidenceId: String): File =
        File(evidenceDirectory(visitUuid, phase, evidenceId), "processed.jpg")

    fun commit(
        visitUuid: String,
        phase: String,
        position: Int,
        capturedFile: File,
        capturedAtMillis: Long,
        location: GeoPoint?,
        machineCode: String,
        machineName: String,
        regionName: String,
        areaName: String,
    ): PhotoEntity {
        require(phase == "before" || phase == "after") { "Unsupported photo phase" }
        require(visitUuid.matches(Regex("[A-Za-z0-9_-]{1,100}"))) { "Invalid visit identifier" }
        require(position >= 0) { "Invalid photo position" }
        require(capturedFile.isFile && capturedFile.length() > 0) { "الصورة الملتقطة فارغة أو مفقودة" }
        val evidenceId = UUID.randomUUID().toString()
        val original = originalFile(visitUuid, phase, evidenceId)
        val processed = processedFile(visitUuid, phase, evidenceId)
        original.parentFile?.mkdirs()

        copyDurably(capturedFile, original)
        val governorate = location?.let { governorates.find(it.latitude, it.longitude)?.nameAr }
        val input = WatermarkInput(
            machineCode = machineCode,
            machineName = machineName,
            regionName = regionName,
            areaName = areaName,
            governorate = governorate,
            phase = phase,
            capturedAtMillis = capturedAtMillis,
            location = location,
        )
        val watermark = Watermarker.render(context, original, processed, input)
        if (!processed.isFile || processed.length() <= 0L) {
            throw IllegalStateException("تعذر حفظ الصورة المعالجة")
        }
        val hash = Hashing.sha256File(processed)
        val entity = PhotoEntity(
            id = evidenceId,
            visitUuid = visitUuid,
            phase = phase,
            position = position,
            originalPath = original.absolutePath,
            processedPath = processed.absolutePath,
            capturedAt = capturedAtMillis,
            latitude = location?.latitude,
            longitude = location?.longitude,
            accuracy = location?.accuracyMeters,
            provider = location?.provider,
            governorate = governorate,
            watermarkText = watermark.text,
            sha256 = hash,
            sizeBytes = processed.length(),
            mimeType = "image/jpeg",
            uploaded = false,
            createdAt = System.currentTimeMillis(),
        )
        return entity
    }

    /** A user may remove evidence from a draft, but original bytes are immutable. */
    fun delete(photo: PhotoEntity) = Unit

    private fun copyDurably(source: File, destination: File) {
        check(!destination.exists()) { "Evidence destination already exists" }
        val temporary = File(destination.parentFile, destination.name + ".${UUID.randomUUID()}.part")
        try {
            source.inputStream().use { input ->
                FileOutputStream(temporary).use { output ->
                    input.copyTo(output, 128 * 1024)
                    output.flush()
                    output.fd.sync()
                }
            }
            if (temporary.length() != source.length()) throw IllegalStateException("نسخة الصورة غير مكتملة")
            if (!temporary.renameTo(destination)) throw IllegalStateException("تعذر تثبيت ملف الدليل ذريًا")
        } catch (error: Exception) {
            temporary.delete()
            throw error
        }
    }

    private fun evidenceDirectory(visitUuid: String, phase: String, evidenceId: String): File {
        require(phase == "before" || phase == "after") { "Unsupported photo phase" }
        require(visitUuid.matches(Regex("[A-Za-z0-9_-]{1,100}"))) { "Invalid visit identifier" }
        require(evidenceId.matches(Regex("[A-Za-z0-9-]{1,64}"))) { "Invalid evidence identifier" }
        return File(File(context.filesDir, "visits/$visitUuid/$phase"), evidenceId)
    }
}
