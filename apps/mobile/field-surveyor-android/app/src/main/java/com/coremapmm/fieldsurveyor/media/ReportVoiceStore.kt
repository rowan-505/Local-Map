package com.coremapmm.fieldsurveyor.media

import com.coremapmm.fieldsurveyor.data.LocalReportMediaDao
import com.coremapmm.fieldsurveyor.data.LocalReportMediaEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

class ReportVoiceStore(
    private val mediaDir: File,
    private val dao: LocalReportMediaDao,
    private val nowMs: () -> Long = { System.currentTimeMillis() },
    private val newId: () -> String = { UUID.randomUUID().toString() },
) {
    suspend fun count(reportClientPublicId: String): Int =
        dao.countForReportMime(reportClientPublicId, LocalReportMediaEntity.MIME_AAC)

    suspend fun list(reportClientPublicId: String): List<LocalReportMediaEntity> =
        dao.listForReport(reportClientPublicId).filter { it.mimeType == LocalReportMediaEntity.MIME_AAC }

    suspend fun addFromRecording(reportClientPublicId: String, source: File): LocalReportMediaEntity {
        return withContext(Dispatchers.IO) {
            val existing = dao.countForReportMime(reportClientPublicId, LocalReportMediaEntity.MIME_AAC)
            if (existing >= VoiceTarget.MAX_CLIPS_PER_REPORT) {
                error("This report already has a voice clip")
            }
            if (!source.isFile || source.length() <= 0L) {
                error("Recording was empty")
            }
            if (source.length() > VoiceTarget.MAX_BYTES) {
                error("Recording is too large")
            }
            val id = newId()
            mediaDir.mkdirs()
            val dest = File(mediaDir, "$id.m4a")
            source.copyTo(dest, overwrite = true)
            val now = nowMs()
            val row = LocalReportMediaEntity(
                mediaPublicId = id,
                reportClientPublicId = reportClientPublicId,
                localPath = dest.absolutePath,
                mimeType = LocalReportMediaEntity.MIME_AAC,
                byteSize = dest.length(),
                syncState = LocalReportMediaEntity.STATE_LOCAL,
                remoteAssetPublicId = null,
                createdAtEpochMs = now,
                updatedAtEpochMs = now,
            )
            dao.insert(row)
            row
        }
    }

    suspend fun remove(mediaPublicId: String): Boolean = withContext(Dispatchers.IO) {
        val row = dao.findById(mediaPublicId)
            ?.takeIf { it.mimeType == LocalReportMediaEntity.MIME_AAC }
            ?: return@withContext false
        if (dao.deleteRemovable(mediaPublicId) != 1) return@withContext false
        File(row.localPath).delete()
        true
    }
}
