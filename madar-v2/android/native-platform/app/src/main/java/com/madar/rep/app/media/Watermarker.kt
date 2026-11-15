package com.madar.rep.app.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Typeface
import androidx.core.content.ContextCompat
import androidx.exifinterface.media.ExifInterface
import com.madar.rep.app.R
import com.madar.rep.app.core.GeoPoint
import com.madar.rep.app.core.MadarTime
import java.io.File
import java.io.FileOutputStream

data class WatermarkInput(
    val machineCode: String,
    val machineName: String,
    val regionName: String,
    val areaName: String,
    val governorate: String?,
    val phase: String,
    val capturedAtMillis: Long,
    val location: GeoPoint?,
)

data class WatermarkOutput(val text: String, val width: Int, val height: Int)

/**
 * Burns the same six MADAR lines into the derived JPEG that the old WebView app
 * produced. The vector brand mark is rasterized from the app resources, not a
 * placeholder image, and Arabic text is drawn with the platform's shaping engine.
 */
object Watermarker {
    private const val MAX_DIMENSION = 1600
    private const val JPEG_QUALITY = 82

    fun render(context: Context, source: File, destination: File, input: WatermarkInput): WatermarkOutput {
        val bitmap = decodeScaled(source) ?: throw IllegalArgumentException("الصورة غير صالحة أو لا يمكن فتحها.")
        val oriented = orient(bitmap, source)
        try {
            val lines = buildLines(input)
            val layout = layout(oriented.width, oriented.height)
            val output = Bitmap.createBitmap(oriented.width, oriented.height, Bitmap.Config.ARGB_8888)
            try {
                val canvas = Canvas(output)
                canvas.drawColor(Color.BLACK)
                canvas.drawBitmap(oriented, 0f, 0f, null)
                val panel = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(210, 7, 19, 31) }
                canvas.drawRect(0f, layout.panelTop.toFloat(), layout.panelWidth.toFloat(), oriented.height.toFloat(), panel)

                val logo = ContextCompat.getDrawable(context, R.drawable.ic_madar_mark)
                if (logo != null) {
                    logo.setBounds(
                        layout.padding,
                        layout.panelTop + layout.padding,
                        layout.padding + layout.logoSize,
                        layout.panelTop + layout.padding + layout.logoSize,
                    )
                    logo.draw(canvas)
                }

                val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = Color.WHITE
                    textSize = layout.fontSize.toFloat()
                    typeface = Typeface.create("sans-serif", Typeface.BOLD)
                    textAlign = Paint.Align.RIGHT
                    isSubpixelText = true
                }
                lines.forEachIndexed { index, line ->
                    val y = (layout.panelTop + layout.padding + layout.lineHeight * index + layout.lineHeight / 2f).toFloat()
                    val maxWidth = if (index == 0) {
                        layout.panelWidth - layout.padding * 2 - layout.logoSize
                    } else {
                        layout.panelWidth - layout.padding * 2
                    }.coerceAtLeast(40)
                    canvas.drawText(fit(paint, line, maxWidth), (layout.panelWidth - layout.padding).toFloat(), y, paint)
                }

                destination.parentFile?.mkdirs()
                val temporary = File(destination.parentFile, destination.name + ".part")
                try {
                    FileOutputStream(temporary).use { stream ->
                        if (!output.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, stream)) {
                            throw IllegalStateException("تعذر ترميز الصورة")
                        }
                        stream.flush()
                        stream.fd.sync()
                    }
                    if (!temporary.renameTo(destination)) {
                        temporary.copyTo(destination, overwrite = true)
                        destination.setLastModified(System.currentTimeMillis())
                        temporary.delete()
                    }
                } catch (error: Exception) {
                    temporary.delete()
                    throw error
                }
                return WatermarkOutput(lines.joinToString("\n"), output.width, output.height)
            } finally {
                output.recycle()
            }
        } finally {
            oriented.recycle()
            if (oriented !== bitmap) bitmap.recycle()
        }
    }

    fun buildLines(input: WatermarkInput): List<String> {
        val time = MadarTime.watermark(input.capturedAtMillis)
        val location = input.location?.let {
            "%.5f, %.5f · ±%dم".format(it.latitude, it.longitude, Math.round(it.accuracyMeters))
        } ?: "الموقع غير متاح"
        val area = listOf(input.regionName, input.areaName)
            .filter { it.isNotBlank() }
            .distinct()
            .joinToString(" · ")
            .ifBlank { "غير متاحة" }
        return listOf(
            "مَــدَارْ · ${if (input.phase == "before") "قبل الصيانة" else "بعد الصيانة"}",
            "التاريخ: ${time.date} · ${time.weekday}",
            "الوقت: ${time.time}",
            "GPS: $location",
            "المحافظة: ${input.governorate ?: "غير متاحة"} · المنطقة المسجلة: $area",
            "الماكينة: ${input.machineCode} · ${input.machineName.ifBlank { "ماكينة ${input.machineCode}" }}",
        )
    }

    private fun decodeScaled(source: File): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(source.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (bounds.outWidth / sample > MAX_DIMENSION * 2 || bounds.outHeight / sample > MAX_DIMENSION * 2) {
            sample *= 2
        }
        val options = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val decoded = BitmapFactory.decodeFile(source.absolutePath, options) ?: return null
        val scale = minOf(1f, MAX_DIMENSION.toFloat() / maxOf(decoded.width, decoded.height))
        if (scale >= 1f) return decoded
        val scaled = Bitmap.createScaledBitmap(
            decoded,
            (decoded.width * scale).toInt().coerceAtLeast(1),
            (decoded.height * scale).toInt().coerceAtLeast(1),
            true
        )
        if (scaled !== decoded) decoded.recycle()
        return scaled
    }

    private fun orient(bitmap: Bitmap, source: File): Bitmap {
        val orientation = runCatching {
            ExifInterface(source.absolutePath).getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
            )
        }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.postRotate(90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.postRotate(270f)
                matrix.postScale(-1f, 1f)
            }
        }
        if (matrix.isIdentity) return bitmap
        val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        if (rotated !== bitmap) bitmap.recycle()
        return rotated
    }

    private fun fit(paint: Paint, value: String, maxWidth: Int): String {
        if (paint.measureText(value) <= maxWidth) return value
        var text = value
        while (text.length > 1 && paint.measureText("$text…") > maxWidth) {
            text = text.dropLast(1)
        }
        return "$text…"
    }

    private fun layout(width: Int, height: Int): Layout {
        val fontSize = maxOf(15, Math.round(width * 0.022f))
        val lineHeight = Math.round(fontSize * 1.38f)
        val padding = maxOf(12, Math.round(fontSize * 0.65f))
        val panelWidth = minOf(width, maxOf(Math.round(width * 0.62f), 300))
        val panelHeight = minOf(height, padding * 2 + lineHeight * 6)
        val logoSize = maxOf(30, minOf(Math.round(fontSize * 2f), Math.round(panelWidth * 0.14f)))
        return Layout(
            fontSize = fontSize,
            lineHeight = lineHeight,
            padding = padding,
            panelWidth = panelWidth,
            panelHeight = panelHeight,
            logoSize = logoSize,
            panelTop = maxOf(0, height - panelHeight),
        )
    }

    private data class Layout(
        val fontSize: Int,
        val lineHeight: Int,
        val padding: Int,
        val panelWidth: Int,
        val panelHeight: Int,
        val logoSize: Int,
        val panelTop: Int,
    )
}
