package com.madar.rep.app.data.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.madar.rep.app.MadarApplication
import java.util.concurrent.TimeUnit

/**
 * The only WorkManager worker that uploads field data. Every queue (visits,
 * attendance, machine actions) is drained by the single SyncEngine run, so two
 * workers can never race the same UUID.
 */
class SyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as MadarApplication).container
        return try {
            val result = container.syncEngine.run()
            if (result.needsLogin) {
                container.sessions.expire()
                Result.success()
            } else if (result.shouldRetry) {
                Result.retry()
            } else {
                Result.success()
            }
        } catch (error: Exception) {
            if (runAttemptCount >= 20) Result.success() else Result.retry()
        }
    }

    companion object {
        internal val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
    }
}

class SyncScheduler(private val context: Context) {
    fun ensureScheduled() {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(SyncWorker.constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    fun enqueueNow() {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(SyncWorker.constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork(IMMEDIATE, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
    }

    companion object {
        private const val PERIODIC = "madar-sync-periodic"
        private const val IMMEDIATE = "madar-sync-now"
    }
}
