package com.coremapmm.fieldsurveyor.work

import com.coremapmm.fieldsurveyor.auth.AuthException
import com.coremapmm.fieldsurveyor.data.LocalReportDao
import com.coremapmm.fieldsurveyor.data.LocalReportEntity
import com.coremapmm.fieldsurveyor.survey.AnomalyPayload

sealed class OutboxRunResult {
    data object Idle : OutboxRunResult()
    data object Processed : OutboxRunResult()
    data object RetryLater : OutboxRunResult()
}

/**
 * Syncs one outbox row per call via POST /field/reports.
 * The Room clientPublicId is sent on every retry.
 */
class OutboxSyncRunner(
    private val hasSession: () -> Boolean,
    private val accessToken: suspend () -> String,
    private val reports: LocalReportDao,
    private val post: (accessToken: String, jsonBody: String) -> OutboxHttpResult,
    private val nowMs: () -> Long = { System.currentTimeMillis() },
) {
    suspend fun syncOne(): OutboxRunResult {
        if (!hasSession()) {
            return OutboxRunResult.Idle
        }
        val row = reports.claimNext(nowMs()) ?: return OutboxRunResult.Idle
        val body = AnomalyPayload.toCreateBody(row.clientPublicId, row.payloadJson)
        val result = try {
            post(accessToken(), body)
        } catch (error: AuthException) {
            reports.updateStatus(
                clientPublicId = row.clientPublicId,
                status = LocalReportEntity.STATUS_RETRY,
                lastError = error.message,
                updatedAtEpochMs = nowMs(),
            )
            return if (error.statusCode == 401) OutboxRunResult.Idle else OutboxRunResult.RetryLater
        } catch (error: Exception) {
            OutboxSyncPolicy.classifyThrowable(error)
        }
        val status = OutboxSyncPolicy.nextStatus(result)
        val message = when (result) {
            is OutboxHttpResult.Success -> null
            is OutboxHttpResult.Permanent -> result.message
            is OutboxHttpResult.Transient -> result.message
        }
        reports.updateStatus(row.clientPublicId, status, message, nowMs())
        return when (result) {
            is OutboxHttpResult.Success -> OutboxRunResult.Processed
            is OutboxHttpResult.Permanent -> OutboxRunResult.Processed
            is OutboxHttpResult.Transient -> OutboxRunResult.RetryLater
        }
    }
}
