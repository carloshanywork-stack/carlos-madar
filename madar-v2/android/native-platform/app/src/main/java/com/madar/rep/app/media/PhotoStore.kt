package com.madar.rep.app.media

import android.content.Context
import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.media.MediaScannerConnection
import android.system.Os
import android.system.OsConstants
import com.madar.rep.app.core.*
import com.madar.rep.app.data.db.PhotoEntity
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import org.json.JSONObject

/** Durable, immutable evidence. Failed processing leaves originals and a recovery journal. */
class PhotoStore(private val context:Context,private val governorates:GovernorateIndex) {
    private val root=File(context.filesDir,"visits").apply { check(mkdirs()||isDirectory) }
    fun newCaptureFile(visitUuid:String,phase:String):File {
        UUID.fromString(visitUuid);require(phase in listOf("before","after"))
        val d=File(root,"$visitUuid/$phase/raw").apply { check(mkdirs()||isDirectory) }
        return File(d,"${UUID.randomUUID()}.capture.jpg")
    }

    /** Publishes an unchanged original to the public MADAR album while retaining the private evidence copy. */
    fun publishOriginalToGallery(photo: PhotoEntity) {
        val source = File(photo.originalPath)
        require(source.isFile && source.length() > 0L) { "الصورة الأصلية غير متاحة للتصدير" }
        val displayName = "MADAR_${photo.phase}_${photo.id}.jpg"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, displayName)
                put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/MADAR/")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
            val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                ?: throw java.io.IOException("تعذر إنشاء ملف الصورة في المعرض")
            try {
                context.contentResolver.openOutputStream(uri, "w")?.use { output ->
                    source.inputStream().use { it.copyTo(output) }
                } ?: throw java.io.IOException("تعذر فتح ملف الصورة في المعرض")
                val ready = ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }
                check(context.contentResolver.update(uri, ready, null, null) == 1) {
                    "تعذر إنهاء حفظ الصورة في المعرض"
                }
            } catch (error: Exception) {
                context.contentResolver.delete(uri, null, null)
                throw error
            }
        } else {
            @Suppress("DEPRECATION")
            val pictures = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
            val directory = File(pictures, "MADAR")
            if (!directory.exists() && !directory.mkdirs()) throw java.io.IOException("تعذر إنشاء مجلد Pictures/MADAR")
            val destination = File(directory, displayName)
            source.inputStream().use { input -> destination.outputStream().use(input::copyTo) }
            MediaScannerConnection.scanFile(context, arrayOf(destination.absolutePath), arrayOf("image/jpeg"), null)
        }
    }
    fun originalFile(visitUuid:String,phase:String,position:Int)=File(root,"$visitUuid/$phase/IMG_${position+1}_original.jpg")
    fun processedFile(visitUuid:String,phase:String,position:Int)=File(root,"$visitUuid/$phase/IMG_${position+1}_processed.jpg")
    @Synchronized fun commit(visitUuid:String,phase:String,position:Int,capturedFile:File,capturedAtMillis:Long,location:GeoPoint?,machineCode:String,machineName:String,regionName:String,areaName:String):PhotoEntity {
        UUID.fromString(visitUuid);require(phase in listOf("before","after") && position>=0)
        require(capturedFile.isFile && capturedFile.length()>0)
        val id=UUID.randomUUID().toString()
        val d=File(root,"$visitUuid/$phase/$id").apply { check(mkdirs()||isDirectory) }
        val j=JSONObject().put("id",id).put("visitUuid",visitUuid).put("phase",phase).put("position",position)
            .put("capturedAt",capturedAtMillis).put("capturePath",capturedFile.absolutePath)
            .put("machineCode",machineCode).put("machineName",machineName)
            .put("regionName",regionName).put("areaName",areaName)
        location?.let { j.put("latitude",it.latitude).put("longitude",it.longitude).put("accuracy",it.accuracyMeters).put("provider",it.provider) }
        write(File(d,"capture.json"),j.toString().toByteArray())
        copyDurably(capturedFile,File(d,"original.jpg"))
        val result=finish(d,j)
        // Removing the staging capture is safe only after the immutable pair and journal exist.
        if(capturedFile.canonicalPath.startsWith(root.canonicalPath+File.separator))capturedFile.delete()
        return result
    }
    private fun finish(d:File,j:JSONObject):PhotoEntity {
        val original=File(d,"original.jpg")
        if (!original.isFile) {
            val capturePath=j.optString("capturePath")
            val capture=File(capturePath)
            val isSymbolicLink = runCatching {
                (Os.lstat(capturePath).st_mode and OsConstants.S_IFMT) == OsConstants.S_IFLNK
            }.getOrDefault(true)
            require(capturePath.isNotBlank() && capture.canonicalPath.startsWith(root.canonicalPath+File.separator)
                && capture.isFile && !isSymbolicLink) {
                "ملف الالتقاط المؤقت غير متاح؛ بقي سجل الاستعادة محفوظًا"
            }
            copyDurably(capture,original)
        }
        require(original.length() in 1..12L*1024*1024)
        val total=File(root,j.getString("visitUuid")).walkTopDown().filter{it.isFile}.sumOf{it.length()}
        require(total<=240L*1024*1024){"حجم أدلة الزيارة تجاوز الحد الآمن؛ الصور محفوظة للاستعادة"}
        val location=if(j.has("latitude")) GeoPoint(j.getDouble("latitude"),j.getDouble("longitude"),j.getDouble("accuracy").toFloat(),j.getLong("capturedAt"),j.optString("provider")) else null
        val capturedAt=j.getLong("capturedAt")
        val input=WatermarkInput(j.getString("machineCode"),j.getString("machineName"),j.getString("regionName"),j.getString("areaName"),
            location?.let{governorates.find(it.latitude,it.longitude)?.nameAr},j.getString("phase"),capturedAt,location)
        val processed=File(d,"processed.jpg")
        val text=if(processed.isFile && File(d,"watermark.txt").isFile)File(d,"watermark.txt").readText() else {
            val candidate=File(d,"processed.part.jpg")
            val rendered=Watermarker.render(context,original,candidate,input)
            require(candidate.isFile && candidate.length() in 1..3L*1024*1024){"تعذر تجهيز الصورة؛ الأصل محفوظ"}
            FileOutputStream(candidate,true).use{it.fd.sync()};check(candidate.renameTo(processed))
            write(File(d,"watermark.txt"),rendered.text.toByteArray());rendered.text
        }
        return PhotoEntity(id=j.getString("id"),visitUuid=j.getString("visitUuid"),phase=j.getString("phase"),position=j.getInt("position"),
            originalPath=original.path,processedPath=processed.path,capturedAt=capturedAt,latitude=location?.latitude,longitude=location?.longitude,
            accuracy=location?.accuracyMeters,provider=location?.provider,governorate=input.governorate,watermarkText=text,
            sha256=Hashing.sha256File(processed),sizeBytes=processed.length(),mimeType="image/jpeg",uploaded=false,createdAt=capturedAt)
    }
    /** Returns only complete immutable pairs. The caller verifies the owning visit before Room registration. */
    @Synchronized fun recoverPending():List<PhotoEntity> = root.walkTopDown().filter{it.isFile && it.name=="capture.json"}.mapNotNull { journal ->
        val d=journal.parentFile!!
        if(File(d,"excluded").exists())null else runCatching{finish(d,JSONObject(journal.readText()))}.getOrNull()
    }.toList()
    fun delete(photo:PhotoEntity) {
        val d=File(photo.originalPath).parentFile?:return
        require(d.canonicalPath.startsWith(root.canonicalPath+File.separator))
        write(File(d,"excluded"),"excluded by owner; original retained".toByteArray())
    }
    private fun copyDurably(source:File,dest:File) { source.inputStream().use{input->val part=File(dest.parentFile,dest.name+".part");FileOutputStream(part).use{out->input.copyTo(out);out.fd.sync()};check(part.length()==source.length());check(part.renameTo(dest))} }
    private fun write(file:File,bytes:ByteArray) { val part=File(file.parentFile,file.name+".part");FileOutputStream(part).use{it.write(bytes);it.fd.sync()};check(part.renameTo(file)) }

    fun pruneOldPhotos(maxAgeDays: Int = 7) {
        val cutoff = System.currentTimeMillis() - (maxAgeDays.toLong() * 24 * 60 * 60 * 1000L)
        root.listFiles()?.forEach { visitDir ->
            if (visitDir.isDirectory && visitDir.lastModified() < cutoff) {
                visitDir.deleteRecursively()
            }
        }
    }

    fun clearOrphans() {
        root.listFiles()?.forEach { visitDir ->
            if (visitDir.isDirectory) {
                visitDir.walkBottomUp().forEach { file ->
                    if (file.isFile && file.name.endsWith(".capture.jpg") && (System.currentTimeMillis() - file.lastModified() > 24 * 60 * 60 * 1000L)) {
                        file.delete()
                    }
                }
                if (visitDir.listFiles()?.isEmpty() == true) {
                    visitDir.delete()
                }
            }
        }
    }
}
