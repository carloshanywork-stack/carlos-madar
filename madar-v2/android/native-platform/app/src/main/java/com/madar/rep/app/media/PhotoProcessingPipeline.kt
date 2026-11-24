package com.madar.rep.app.media

import com.madar.rep.app.AppContainer
import com.madar.rep.app.core.SupportDiagnostics
import com.madar.rep.app.data.db.PhotoEntity
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Off-thread, bounded-concurrency processor for photo watermarking and gallery publication.
 *
 * Ensures the camera shutter can immediately accept consecutive shots after the fast
 * durable commit, while background workers handle heavy image rendering (scaling,
 * typography canvas, JPEG re-encoding, and SHA-256 calculation) with bounded concurrency (2 threads)
 * to prevent UI thread starvation or out-of-memory crashes on low-resource devices.
 */
object PhotoProcessingPipeline {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default.limitedParallelism(2))
    private val activeTasks = ConcurrentHashMap<String, Boolean>()

    fun isProcessing(photoId: String): Boolean = activeTasks[photoId] == true

    fun enqueue(
        photo: PhotoEntity,
        machineCode: String,
        container: AppContainer,
        onComplete: ((PhotoEntity) -> Unit)? = null,
        onGalleryError: ((Exception) -> Unit)? = null,
    ) {
        val photoId = photo.id
        if (activeTasks.putIfAbsent(photoId, true) != null) return

        scope.launch {
            try {
                // 1. Watermark rendering, JPEG compression, and SHA-256
                val processed = withContext(Dispatchers.IO) {
                    container.photoStore.renderWatermark(photo)
                }

                // 2. Persist processed metadata (size, hash, watermark text) to Room
                val saved = withContext(Dispatchers.IO) {
                    container.database.photos().updateProcessed(
                        processed.id, processed.processedPath, processed.watermarkText, processed.sha256, processed.sizeBytes,
                    )
                }
                if (saved == 0) return@launch

                // 3. Export original image copy to public Pictures/MADAR/
                val galleryResult = runCatching {
                    withContext(Dispatchers.IO) {
                        container.photoStore.publishOriginalToGallery(processed, machineCode)
                    }
                }
                if (galleryResult.isFailure) {
                    val ex = galleryResult.exceptionOrNull() as? Exception ?: Exception("فشل التصدير للمعرض")
                    SupportDiagnostics.record("gallery", "export_failed: ${ex.message}")
                    onGalleryError?.invoke(ex)
                }

                onComplete?.invoke(processed)
            } catch (error: Exception) {
                SupportDiagnostics.record("watermark", "render_failed: ${error.message}")
            } finally {
                activeTasks.remove(photoId)
            }
        }
    }
}
