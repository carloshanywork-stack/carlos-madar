package com.madar.rep.app.core

import java.io.File
import java.security.MessageDigest

object Hashing {
    fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    fun sha256File(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * Stable fingerprint for a visit across retries. It deliberately includes
     * the owner, the visit UUID, the canonical business fields, and each photo's
     * phase, size, and digest. Reordering fields in a DTO must not change it.
     */
    fun visitFingerprint(
        ownerRepId: Long,
        visitUuid: String,
        cardId: Long,
        machineCode: String,
        regionName: String,
        condition: String,
        reasonIds: List<Long>,
        lines: List<Pair<Long, Int>>,
        notes: String,
        capturedAtMillis: Long,
        before: List<PhotoFingerprint>,
        after: List<PhotoFingerprint>,
    ): String {
        val text = buildString {
            append("v2\n")
            append(ownerRepId).append('\n')
            append(visitUuid.lowercase()).append('\n')
            append(cardId).append('\n')
            append(machineCode).append('\n')
            append(regionName).append('\n')
            append(condition).append('\n')
            append(reasonIds.sorted().joinToString(",")).append('\n')
            append(lines.sortedBy { it.first }.joinToString(",") { "${it.first}:${it.second}" }).append('\n')
            append(notes).append('\n')
            append(capturedAtMillis).append('\n')
            for ((label, photos) in listOf("before" to before, "after" to after)) {
                append(label).append(':').append(photos.size).append('\n')
                photos.sortedBy { it.position }.forEach { photo ->
                    append(photo.position).append(':').append(photo.sizeBytes).append(':')
                        .append(photo.sha256).append('\n')
                }
            }
        }
        return sha256Hex(text.toByteArray(Charsets.UTF_8))
    }
}

data class PhotoFingerprint(
    val position: Int,
    val sizeBytes: Long,
    val sha256: String,
)
