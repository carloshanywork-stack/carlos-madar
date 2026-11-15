package com.madar.rep.app.data.api

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.madar.rep.app.BuildConfig
import com.madar.rep.app.core.Hashing
import java.io.File
import java.security.MessageDigest

object ApkUpdateChecks {
    const val PACKAGE_NAME = "com.madar.rep.app"
    const val TRUSTED_SIGNER_SHA256 = "f4c8bffc9f852ea6056e350b65156eb880d05629991682492159b9e3937c02a1"

    fun isNewer(candidateVersionCode: Int, installedVersionCode: Int): Boolean = candidateVersionCode > installedVersionCode

    fun hashMatches(expected: String, actual: String): Boolean =
        expected.matches(Regex("^[0-9a-fA-F]{64}$")) && expected.equals(actual, ignoreCase = true)

    fun signerMatches(actual: String, trusted: String = TRUSTED_SIGNER_SHA256): Boolean =
        actual.matches(Regex("^[0-9a-fA-F]{64}$")) && trusted.matches(Regex("^[0-9a-fA-F]{64}$")) &&
            actual.equals(trusted, ignoreCase = true)
}

enum class ApkUpdateFailure(val userMessage: String) {
    NOT_CONFIGURED("لا يوجد إصدار APK موقّع ومتاح للتحديث."),
    NOT_NEWER("التطبيق مثبت على أحدث إصدار متاح."),
    HASH_MISMATCH("فشل التحقق من APK: الهاش لا يطابق بيانات الإصدار."),
    SIGNER_MISMATCH("فشل التحقق من APK: بصمة الموقّع غير معتمدة."),
    PACKAGE_MISMATCH("ملف التحديث ليس تطبيق MADAR للمندوبين."),
    DOWNLOAD_FAILED("تعذر تنزيل التحديث. تحقق من الاتصال ثم أعد المحاولة."),
}

class ApkUpdateException(val failure: ApkUpdateFailure, cause: Throwable? = null) :
    Exception(failure.userMessage, cause)

data class DownloadedApk(val file: File, val metadata: ApkReleaseMetadata)

class ApkUpdateManager(private val context: android.content.Context) {
    fun download(api: MadarApi, token: String): DownloadedApk {
        val status = try {
            api.getApkStatus(token)
        } catch (error: Exception) {
            throw ApkUpdateException(ApkUpdateFailure.DOWNLOAD_FAILED, error)
        }
        val metadata = status.releaseMetadata
        if (!status.available || status.artifactType != "release" || metadata == null ||
            metadata.buildType != "release" || metadata.sourceTreeDirty ||
            !metadata.apkSha256.matches(Regex("^[0-9a-fA-F]{64}$")) ||
            !ApkUpdateChecks.signerMatches(metadata.signerCertificateSha256)
        ) throw ApkUpdateException(ApkUpdateFailure.NOT_CONFIGURED)
        if (!ApkUpdateChecks.isNewer(metadata.versionCode, BuildConfig.VERSION_CODE)) {
            throw ApkUpdateException(ApkUpdateFailure.NOT_NEWER)
        }

        val directory = File(context.cacheDir, "updates")
        if (!directory.exists() && !directory.mkdirs()) throw ApkUpdateException(ApkUpdateFailure.DOWNLOAD_FAILED)
        val destination = File(directory, "madar-${metadata.versionCode}.apk")
        try {
            api.downloadApk(token, destination)
            val actualHash = Hashing.sha256File(destination)
            if (!ApkUpdateChecks.hashMatches(metadata.apkSha256, actualHash)) {
                throw ApkUpdateException(ApkUpdateFailure.HASH_MISMATCH)
            }
            val packageInfo = packageInfo(destination)
                ?: throw ApkUpdateException(ApkUpdateFailure.PACKAGE_MISMATCH)
            if (packageInfo.packageName != ApkUpdateChecks.PACKAGE_NAME || packageInfo.packageName != BuildConfig.APPLICATION_ID) {
                throw ApkUpdateException(ApkUpdateFailure.PACKAGE_MISMATCH)
            }
            val downloadedVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                packageInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                packageInfo.versionCode.toLong()
            }
            if (downloadedVersionCode != metadata.versionCode.toLong()) {
                throw ApkUpdateException(ApkUpdateFailure.PACKAGE_MISMATCH)
            }
            val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                packageInfo.signingInfo?.apkContentsSigners?.toList().orEmpty()
            } else {
                @Suppress("DEPRECATION")
                packageInfo.signatures?.toList().orEmpty()
            }
            val matches = signatures.any { signature ->
                val fingerprint = MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())
                    .joinToString("") { "%02x".format(it) }
                ApkUpdateChecks.signerMatches(fingerprint) &&
                    ApkUpdateChecks.signerMatches(fingerprint, metadata.signerCertificateSha256)
            }
            if (!matches) throw ApkUpdateException(ApkUpdateFailure.SIGNER_MISMATCH)
            return DownloadedApk(destination, metadata)
        } catch (error: ApkUpdateException) {
            destination.delete()
            throw error
        } catch (error: Exception) {
            destination.delete()
            throw ApkUpdateException(ApkUpdateFailure.DOWNLOAD_FAILED, error)
        }
    }

    private fun packageInfo(file: File) = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        context.packageManager.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES)
    } else {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageArchiveInfo(file.absolutePath, PackageManager.GET_SIGNATURES)
    }

    fun install(activity: Activity, file: File): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            return false
        }
        val uri: Uri = FileProvider.getUriForFile(activity, "${BuildConfig.APPLICATION_ID}.fileprovider", file)
        activity.startActivity(Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        })
        return true
    }
}
