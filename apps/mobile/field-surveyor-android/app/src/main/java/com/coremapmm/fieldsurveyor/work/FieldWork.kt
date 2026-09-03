package com.coremapmm.fieldsurveyor.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.coremapmm.fieldsurveyor.FieldApp
import java.util.concurrent.TimeUnit

class OutboxSyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as? FieldApp ?: return Result.success()
        val graph = app.graph
        val reportsRunner = OutboxSyncRunner(
            hasSession = { graph.auth.currentSession() != null },
            accessToken = { graph.auth.validAccessToken() },
            reports = graph.reports,
            post = graph.fieldReportsApi::create,
        )
        val mediaRunner = MediaSyncRunner(
            hasSession = { graph.auth.currentSession() != null },
            accessToken = { graph.auth.validAccessToken() },
            media = graph.reportMedia,
            createUpload = { token, mimeType, byteSize ->
                graph.fieldMediaApi.createUpload(token, mimeType, byteSize)
            },
            putObject = graph.fieldMediaApi::putObject,
            complete = graph.fieldMediaApi::complete,
            attach = graph.fieldMediaApi::attach,
        )
        var retryLater = false
        var processed = 0
        while (processed < 20) {
            when (reportsRunner.syncOne()) {
                OutboxRunResult.Idle -> break
                OutboxRunResult.Processed -> processed += 1
                OutboxRunResult.RetryLater -> {
                    retryLater = true
                    break
                }
            }
        }
        var mediaProcessed = 0
        while (mediaProcessed < 20) {
            when (mediaRunner.syncOne()) {
                OutboxRunResult.Idle -> break
                OutboxRunResult.Processed -> mediaProcessed += 1
                OutboxRunResult.RetryLater -> {
                    retryLater = true
                    break
                }
            }
        }
        if (retryLater) {
            return Result.retry()
        }
        val moreReports = graph.reports.nextEligible() != null
        val moreMedia = graph.reportMedia.nextEligible() != null
        return if (moreReports || moreMedia) Result.retry() else Result.success()
    }
}

object FieldWork {
    const val UNIQUE_NAME = "field-outbox-sync"

    fun enqueue(context: Context) {
        val request = OneTimeWorkRequestBuilder<OutboxSyncWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            UNIQUE_NAME,
            ExistingWorkPolicy.KEEP,
            request,
        )
    }
}
