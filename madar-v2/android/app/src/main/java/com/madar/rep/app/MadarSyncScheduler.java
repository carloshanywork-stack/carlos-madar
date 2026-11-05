package com.madar.rep.app;

import android.content.Context;

import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.concurrent.TimeUnit;

final class MadarSyncScheduler {
    private static final String PERIODIC_WORK = "madar-rep-periodic-sync";
    private static final String IMMEDIATE_WORK = "madar-rep-visit-sync";

    private MadarSyncScheduler() {}

    static Constraints networkConstraints() {
        return new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
    }

    static void ensurePeriodic(Context context) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
            MadarSyncWorker.class,
            15,
            TimeUnit.MINUTES
        ).setConstraints(networkConstraints()).build();
        WorkManager.getInstance(context.getApplicationContext()).enqueueUniquePeriodicWork(
            PERIODIC_WORK,
            ExistingPeriodicWorkPolicy.KEEP,
            request
        );
    }

    static void enqueueNow(Context context, boolean replace) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(MadarSyncWorker.class)
            .setConstraints(networkConstraints())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build();
        WorkManager.getInstance(context.getApplicationContext()).enqueueUniqueWork(
            IMMEDIATE_WORK,
            replace ? ExistingWorkPolicy.REPLACE : ExistingWorkPolicy.KEEP,
            request
        );
    }

    static void cancelImmediate(Context context) {
        WorkManager.getInstance(context.getApplicationContext()).cancelUniqueWork(IMMEDIATE_WORK);
    }
}
