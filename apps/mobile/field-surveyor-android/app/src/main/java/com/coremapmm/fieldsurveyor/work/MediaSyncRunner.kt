package com.coremapmm.fieldsurveyor.work

import com.coremapmm.fieldsurveyor.auth.AuthException
import com.coremapmm.fieldsurveyor.data.LocalReportMediaDao
import com.coremapmm.fieldsurveyor.data.LocalReportMediaEntity
import com.coremapmm.fieldsurveyor.data.MediaApiResult
import com.coremapmm.fieldsurveyor.data.MediaUploadIntent
import java.io.File

/**
 * Syncs one local JPEG or AAC clip: parent report must already be SYNCED.
 * Bytes go Android → R2. The API only sees JSON + HEAD.
 */
class MediaSyncRunner(
    private val hasSession: () -> Boolean,
    private val accessToken: suspend () -> String,
    private val media: LocalReportMediaDao,
    private val createUpload: (String, String, Long) -> MediaApiResult<MediaUploadIntent>,
    private val putObject: (MediaUploadIntent, File) -> OutboxHttpResult,
    private val complete: (String, String) -> MediaApiResult<Unit>,
    private val attach: (String, String, String) -> MediaApiResult<Unit>,
    private val nowMs: () -> Long = { System.currentTimeMillis() },
) {
    suspend fun syncOne(): OutboxRunResult {
        if (!hasSession()) {
            return OutboxRunResult.Idle
        }
        val row = media.claimNext(nowMs()) ?: return OutboxRunResult.Idle
        val file = File(row.localPath)
        if (!file.isFile || file.length() != row.byteSize) {
            media.updateState(
                row.mediaPublicId,
                LocalReportMediaEntity.STATE_PERMANENT_ERROR,
                "Local file missing",
                nowMs(),
            )
            return OutboxRunResult.Processed
        }
        return try {
            val token = accessToken()
            when (val step = ensureReadyAsset(token, row, file)) {
                is AssetStep.Stop -> return step.result
                is AssetStep.Ready -> {
                    when (val attached = attach(token, row.reportClientPublicId, step.assetId)) {
                        is MediaApiResult.Ok -> {
                            media.updateState(row.mediaPublicId, LocalReportMediaEntity.STATE_SYNCED, null, nowMs())
                            OutboxRunResult.Processed
                        }
                        is MediaApiResult.NeedNewUpload -> failTransient(row, attached.message)
                        is MediaApiResult.Http -> applyHttp(row, attached.result)
                    }
                }
            }
        } catch (error: AuthException) {
            media.updateState(
                row.mediaPublicId,
                LocalReportMediaEntity.STATE_RETRY,
                error.message,
                nowMs(),
            )
            if (error.statusCode == 401) OutboxRunResult.Idle else OutboxRunResult.RetryLater
        } catch (error: Exception) {
            applyHttp(row, OutboxSyncPolicy.classifyThrowable(error))
        }
    }

    private suspend fun ensureReadyAsset(
        token: String,
        row: LocalReportMediaEntity,
        file: File,
    ): AssetStep {
        val existing = row.remoteAssetPublicId
        if (existing != null) {
            when (val done = complete(token, existing)) {
                is MediaApiResult.Ok -> return AssetStep.Ready(existing)
                is MediaApiResult.NeedNewUpload -> media.clearRemoteAsset(row.mediaPublicId, nowMs())
                is MediaApiResult.Http -> return AssetStep.Stop(applyHttp(row, done.result))
            }
        }
        val intent = when (val created = createUpload(token, row.mimeType, file.length())) {
            is MediaApiResult.Ok -> created.value
            is MediaApiResult.NeedNewUpload -> return AssetStep.Stop(failTransient(row, created.message))
            is MediaApiResult.Http -> return AssetStep.Stop(applyHttp(row, created.result))
        }
        media.setRemoteAssetIfAbsent(row.mediaPublicId, intent.publicId, nowMs())
        val stored = media.findById(row.mediaPublicId)?.remoteAssetPublicId ?: intent.publicId
        if (stored != intent.publicId) {
            return when (val done = complete(token, stored)) {
                is MediaApiResult.Ok -> AssetStep.Ready(stored)
                is MediaApiResult.NeedNewUpload -> {
                    media.clearRemoteAsset(row.mediaPublicId, nowMs())
                    AssetStep.Stop(failTransient(row, done.message))
                }
                is MediaApiResult.Http -> AssetStep.Stop(applyHttp(row, done.result))
            }
        }
        when (val put = putObject(intent, file)) {
            is OutboxHttpResult.Success -> Unit
            else -> {
                media.clearRemoteAsset(row.mediaPublicId, nowMs())
                return AssetStep.Stop(applyHttp(row, put))
            }
        }
        return when (val done = complete(token, stored)) {
            is MediaApiResult.Ok -> AssetStep.Ready(stored)
            is MediaApiResult.NeedNewUpload -> {
                media.clearRemoteAsset(row.mediaPublicId, nowMs())
                AssetStep.Stop(failTransient(row, done.message))
            }
            is MediaApiResult.Http -> AssetStep.Stop(applyHttp(row, done.result))
        }
    }

    private suspend fun failTransient(row: LocalReportMediaEntity, message: String): OutboxRunResult {
        media.updateState(row.mediaPublicId, LocalReportMediaEntity.STATE_RETRY, message, nowMs())
        return OutboxRunResult.RetryLater
    }

    private suspend fun applyHttp(row: LocalReportMediaEntity, result: OutboxHttpResult): OutboxRunResult {
        val status = when (result) {
            is OutboxHttpResult.Success -> LocalReportMediaEntity.STATE_SYNCED
            is OutboxHttpResult.Permanent -> LocalReportMediaEntity.STATE_PERMANENT_ERROR
            is OutboxHttpResult.Transient -> LocalReportMediaEntity.STATE_RETRY
        }
        val message = when (result) {
            is OutboxHttpResult.Success -> null
            is OutboxHttpResult.Permanent -> result.message
            is OutboxHttpResult.Transient -> result.message
        }
        media.updateState(row.mediaPublicId, status, message, nowMs())
        return when (result) {
            is OutboxHttpResult.Success -> OutboxRunResult.Processed
            is OutboxHttpResult.Permanent -> OutboxRunResult.Processed
            is OutboxHttpResult.Transient -> OutboxRunResult.RetryLater
        }
    }
}

private sealed class AssetStep {
    data class Ready(val assetId: String) : AssetStep()
    data class Stop(val result: OutboxRunResult) : AssetStep()
}
