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
        val directory = File(context.cacheDir, "camera-captures")
        directory.mkdirs()
        return File(directory, "${visitUuid}_${phase}_${UUID.randomUUID()}.jpg")
    }

    fun originalFile(visitUuid: String, phase: String, position: Int): File =
        File(visitDirectory(visitUuid, phase), originalName(position))

    fun processedFile(visitUuid: String, phase: String, position: Int): File =
        File(visitDirectory(visitUuid, phase), processedName(position))

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
        require(capturedFile.isFile && capturedFile.length() > 0) { "الصورة الملتقطة فارغة أو مفقودة" }
        val original = originalFile(visitUuid, phase, position)
        val processed = processedFile(visitUuid, phase, position)
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
            original.delete()
            throw IllegalStateException("تعذر حفظ الصورة المعالجة")
        }
        val hash = Hashing.sha256File(processed)
        val entity = PhotoEntity(
            id = UUID.randomUUID().toString(),
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
        capturedFile.delete()
        return entity
    }

    fun delete(photo: PhotoEntity) {
        runCatching { File(photo.originalPath).delete() }
        runCatching { File(photo.processedPath).delete() }
    }

    private fun copyDurably(source: File, destination: File) {
        val temporary = File(destination.parentFile, destination.name + ".part")
        try {
            source.inputStream().use { input ->
                FileOutputStream(temporary).use { output ->
                    input.copyTo(output, 128 * 1024)
                    output.flush()
                    output.fd.sync()
                }
            }
            if (temporary.length() != source.length()) throw IllegalStateException("نسخة الصورة غير مكتملة")
            if (!temporary.renameTo(destination)) {
                temporary.copyTo(destination, overwrite = true)
                temporary.delete()
            }
        } catch (error: Exception) {
            temporary.delete()
            destination.delete()
            throw error
        }
    }

    private fun visitDirectory(visitUuid: String, phase: String): File =
        File(File(context.filesDir, "visits"), "$visitUuid/${if (phase == "before") "before" else "after"}")

    private fun originalName(position: Int): String = "IMG_${"%04d".format(position + 1)}_original.jpg"

    private fun processedName(position: Int): String = "IMG_${"%04d".format(position + 1)}_processed.jpg"
}
